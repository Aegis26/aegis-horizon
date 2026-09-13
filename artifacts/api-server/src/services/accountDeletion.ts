import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  accountDeletionLedger,
  commandHistory,
  commissions,
  db,
  employeeCommissions,
  internalNotes,
  organizations,
  orgUsers,
  providerBindings,
  providerSyncStates,
  organizationObjectBindings,
  usageLogs,
  users,
  windowSessions,
} from "@workspace/db";
import {
  acquireUserExclusiveLock,
  type UserLock,
} from "../lib/orgWriteLock";
import {
  deleteOrganization,
  OrganizationDeletionError,
} from "./orgDeletion";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

const DELETION_LEASE_MS = 10 * 60 * 1000;
const RECOVERY_BATCH_SIZE = 5;
const RECOVERY_INTERVAL_MS = 60_000;
type AccountDeletionPhase =
  | "organizations"
  | "storage"
  | "clerk"
  | "relational";

export type AccountDeletionDependencies = {
  deleteClerkUser?: (clerkId: string) => Promise<void>;
  deleteOrganization?: (orgId: string, userId: string) => Promise<void>;
  anonymizeObjectOwners?: (clerkId: string) => Promise<void>;
  /** Test/deployment seam for storage side effects. */
  storage?: { anonymizeObjectOwners?: (clerkId: string) => Promise<void> };
  objectStorage?: { anonymizeObjectOwners?: (clerkId: string) => Promise<void> };
};

export class AccountDeletionError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "in_progress"
      | "clerk_delete_failed"
      | "organization_delete_failed"
      | "organization_in_progress"
      | "storage_anonymization_failed"
      | "relational_delete_failed",
  ) {
    super(code);
    this.name = "AccountDeletionError";
  }
}

type ClaimedAccountDeletion = {
  user: typeof users.$inferSelect;
  ledger: typeof accountDeletionLedger.$inferSelect;
};

function opaqueUserHash(clerkId: string): string {
  return createHash("sha256").update(clerkId).digest("hex");
}

export function isClerkNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    errors?: Array<{ code?: unknown }>;
  };
  if (candidate.status === 404 || candidate.statusCode === 404) return true;
  return Boolean(
    candidate.errors?.some(
      (entry) =>
        typeof entry.code === "string" &&
        /not[_-]?found|resource_missing/i.test(entry.code),
    ),
  );
}

async function claimAccountDeletion(userId: string): Promise<ClaimedAccountDeletion> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new AccountDeletionError("not_found");

    const [existing] = await tx
      .select()
      .from(accountDeletionLedger)
      .where(eq(accountDeletionLedger.userId, userId))
      .for("update");
    const now = new Date();
    let ledger = existing;
    if (!ledger) {
      [ledger] = await tx
        .insert(accountDeletionLedger)
        .values({
          id: randomUUID(),
          userId,
          userOpaqueHash: opaqueUserHash(user.clerkId),
          status: "pending",
          phase: "organizations",
        })
        .returning();
    }

    if (ledger.status === "completed") {
      throw new AccountDeletionError("not_found");
    }
    if (
      ledger.status === "processing" &&
      ledger.leaseUntil &&
      ledger.leaseUntil > now
    ) {
      throw new AccountDeletionError("in_progress");
    }

    // Fence every browser window at the durable deletion claim, before any
    // remote or storage side effect can run. The user row is intentionally
    // retained until relational cleanup, so recovery attempts preserve this
    // revocation fence as well.
    await tx
      .update(windowSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(windowSessions.userId, userId),
          isNull(windowSessions.revokedAt),
        ),
      );

    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(accountDeletionLedger)
      .set({
        status: "processing",
        attempts: sql`${accountDeletionLedger.attempts} + 1`,
        leaseToken,
        leaseUntil: new Date(now.getTime() + DELETION_LEASE_MS),
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(accountDeletionLedger.userId, userId),
          or(
            eq(accountDeletionLedger.status, "pending"),
            eq(accountDeletionLedger.status, "failed"),
            eq(accountDeletionLedger.status, "processing"),
          ),
          or(
            isNull(accountDeletionLedger.leaseUntil),
            lte(accountDeletionLedger.leaseUntil, now),
          ),
        ),
      )
      .returning();
    if (!claimed) throw new AccountDeletionError("in_progress");

    return { user, ledger: claimed };
  });
}

async function advanceAccountDeletion(
  userId: string,
  leaseToken: string,
  phase: AccountDeletionPhase,
  currentOrganizationId: string | null = null,
): Promise<void> {
  const [updated] = await db
    .update(accountDeletionLedger)
    .set({
      phase,
      currentOrganizationId,
      leaseUntil: new Date(Date.now() + DELETION_LEASE_MS),
      lastErrorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountDeletionLedger.userId, userId),
        eq(accountDeletionLedger.leaseToken, leaseToken),
        eq(accountDeletionLedger.status, "processing"),
      ),
    )
    .returning({ id: accountDeletionLedger.id });
  if (!updated) throw new AccountDeletionError("in_progress");
}

async function markAccountDeletionFailed(
  userId: string,
  leaseToken: string,
  code: Exclude<AccountDeletionError["code"], "not_found" | "in_progress">,
): Promise<void> {
  await db
    .update(accountDeletionLedger)
    .set({
      status: "failed",
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: code,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountDeletionLedger.userId, userId),
        eq(accountDeletionLedger.leaseToken, leaseToken),
      ),
    );
}

const JSONB_USER_REFERENCE_COLUMNS = [
  ["organizations", "features_config"],
  ["accounts", "files"],
  ["accounts", "metadata"],
  ["contacts", "metadata"],
  ["activities", "participants"],
  ["activities", "attachments"],
  ["email_threads", "participants"],
  ["email_messages", "recipients"],
  ["calendar_events", "attendees"],
  ["opportunities", "products"],
  ["leads", "metadata"],
  ["segments", "conditions"],
  ["pipelines", "stages"],
  ["lead_scoring_rules", "conditions"],
  ["quotes", "line_items"],
  ["conversion_predictions", "factors"],
  ["close_predictions", "adjustment_factors"],
  ["workflows", "trigger"],
  ["workflows", "conditions"],
  ["workflows", "actions"],
  ["workflow_executions", "trigger_data"],
  ["workflow_executions", "action_results"],
  ["automation_events", "payload"],
  ["ai_agents", "config"],
  ["agent_executions", "input"],
  ["agent_executions", "actions"],
  ["feature_entitlements", "feature_config"],
  ["usage_logs", "metadata"],
  ["custom_reports", "definition"],
  ["report_runs", "parameters"],
  ["signature_signers", "signature_data"],
  ["signature_audit_events", "metadata"],
  ["documents", "signature_fields"],
  ["webhook_deliveries", "payload"],
  ["audit_events", "metadata"],
  ["industry_template_applications", "result"],
  ["org_custom_fields", "config"],
] as const;

/**
 * JSON metadata has no FK for a database to maintain. Replace exact UUID
 * references with a non-identifying marker while retaining the surrounding
 * business payload. Identifiers are a static allowlist above, not client data.
 */
async function scrubJsonbUserReferences(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string): Promise<void> {
  for (const [table, column] of JSONB_USER_REFERENCE_COLUMNS) {
    const tableSql = sql.raw(`"${table}"`);
    const columnSql = sql.raw(`"${column}"`);
    await tx.execute(sql`
      UPDATE ${tableSql}
      SET ${columnSql} = replace(${columnSql}::text, ${userId}, '[deleted-user]')::jsonb
      WHERE ${columnSql}::text LIKE ${`%${userId}%`}
    `);
  }
}

async function purgeUserRelationalData(
  userId: string,
  clerkId: string,
  leaseToken: string,
): Promise<void> {
  let ownershipConflict = false;
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new AccountDeletionError("relational_delete_failed");

    const ownedMemberships = await tx
      .select({ id: orgUsers.id })
      .from(orgUsers)
      .where(and(eq(orgUsers.userId, userId), eq(orgUsers.role, "owner")));
    if (ownedMemberships.length > 0) {
      // No account transaction may remove an owned organization except through
      // deleteOrganization. Rewind the durable phase so recovery retries the
      // organization cleanup; do not silently remove this newly granted role.
      await tx
        .update(accountDeletionLedger)
        .set({
          status: "failed",
          phase: "organizations",
          currentOrganizationId: null,
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: "organization_delete_failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accountDeletionLedger.userId, userId),
            eq(accountDeletionLedger.leaseToken, leaseToken),
            eq(accountDeletionLedger.status, "processing"),
          ),
        );
      ownershipConflict = true;
      return;
    }

    // Personal command transcripts may contain private user content and are
    // deleted. Organization usage and business records are retained.
    await tx.delete(commandHistory).where(eq(commandHistory.userId, userId));
    await tx
      .update(providerBindings)
      .set({ boundByUserId: null })
      .where(eq(providerBindings.boundByUserId, userId));
    await tx
      .update(providerSyncStates)
      .set({ userId: null })
      .where(eq(providerSyncStates.userId, userId));
    await tx
      .update(usageLogs)
      .set({ userId: null })
      .where(eq(usageLogs.userId, userId));
    // Binding ownership is stored as a Clerk id (not a local FK). The
    // organization and object remain available to its other members.
    await tx
      .update(organizationObjectBindings)
      .set({ ownerUserId: "[deleted-user]" })
      .where(eq(organizationObjectBindings.ownerUserId, clerkId));
    await tx
      .update(internalNotes)
      .set({
        authorUserId: null,
        mentionedUserIds: sql`array_remove(${internalNotes.mentionedUserIds}, ${userId}::uuid)`,
      })
      .where(
        sql`${internalNotes.authorUserId} = ${userId}::uuid OR ${userId}::uuid = ANY(${internalNotes.mentionedUserIds})`,
      );

    await scrubJsonbUserReferences(tx, userId);

    // Commission settings and earned rows are user-scoped even when their
    // organization survives. Remove both under the same user deletion fence;
    // the ledger intentionally has no user FK because it normally preserves
    // snapshots after member removal.
    await tx
      .delete(employeeCommissions)
      .where(eq(employeeCommissions.userId, userId));
    await tx
      .delete(commissions)
      .where(eq(commissions.userId, userId));

    const [deleted] = await tx
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!deleted) throw new AccountDeletionError("relational_delete_failed");

    const [completed] = await tx
      .update(accountDeletionLedger)
      .set({
        status: "completed",
        phase: "relational",
        userId: null,
        currentOrganizationId: null,
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accountDeletionLedger.userId, userId),
          eq(accountDeletionLedger.leaseToken, leaseToken),
          eq(accountDeletionLedger.status, "processing"),
        ),
      )
      .returning({ id: accountDeletionLedger.id });
    if (!completed) throw new AccountDeletionError("relational_delete_failed");
  });
  if (ownershipConflict) {
    throw new AccountDeletionError("organization_delete_failed");
  }
}

async function executeAccountDeletion(
  claimed: ClaimedAccountDeletion,
  dependencies: AccountDeletionDependencies,
): Promise<void> {
  const userId = claimed.user.id;
  const leaseToken = claimed.ledger.leaseToken;
  if (!leaseToken) throw new AccountDeletionError("relational_delete_failed");
  let phase = claimed.ledger.phase;

  if (phase === "organizations") {
    const ownedOrganizations = await db
      .select({ orgId: orgUsers.orgId })
      .from(orgUsers)
      .innerJoin(organizations, eq(organizations.id, orgUsers.orgId))
      .where(and(eq(orgUsers.userId, userId), eq(orgUsers.role, "owner")))
      .orderBy(asc(orgUsers.orgId));

    for (const { orgId } of ownedOrganizations) {
      await advanceAccountDeletion(userId, leaseToken, "organizations", orgId);
      try {
        await (dependencies.deleteOrganization ?? deleteOrganization)(orgId, userId);
      } catch (error) {
        if (
          error instanceof OrganizationDeletionError &&
          error.code === "not_found"
        ) {
          continue;
        }
        const code =
          error instanceof OrganizationDeletionError &&
          error.code === "in_progress"
            ? "organization_in_progress"
            : "organization_delete_failed";
        await markAccountDeletionFailed(userId, leaseToken, code);
        throw new AccountDeletionError(code);
      }
    }
    phase = "storage";
    await advanceAccountDeletion(userId, leaseToken, "storage");
  }

  if (phase === "storage") {
    try {
      const anonymizeObjectOwners =
        dependencies.anonymizeObjectOwners ??
        dependencies.storage?.anonymizeObjectOwners ??
        dependencies.objectStorage?.anonymizeObjectOwners;
      if (anonymizeObjectOwners) {
        await anonymizeObjectOwners(claimed.user.clerkId);
      } else if (!dependencies.storage && !dependencies.objectStorage) {
        await new ObjectStorageService().anonymizeObjectOwners(
          claimed.user.clerkId,
        );
      }
    } catch {
      await markAccountDeletionFailed(
        userId,
        leaseToken,
        "storage_anonymization_failed",
      );
      throw new AccountDeletionError("storage_anonymization_failed");
    }
    phase = "clerk";
    await advanceAccountDeletion(userId, leaseToken, "clerk");
  }

  if (phase === "clerk") {
    try {
      // Clerk is authoritative. The local UUID is never sent to Clerk.
      await (
        dependencies.deleteClerkUser ??
        ((clerkId: string) => clerkClient.users.deleteUser(clerkId))
      )(claimed.user.clerkId);
    } catch (error) {
      // A previous crash may have completed Clerk deletion after the last
      // durable phase write. Deleting an already-absent Clerk user is success.
      if (!isClerkNotFound(error)) {
        await markAccountDeletionFailed(userId, leaseToken, "clerk_delete_failed");
        throw new AccountDeletionError("clerk_delete_failed");
      }
    }
    phase = "relational";
    await advanceAccountDeletion(userId, leaseToken, "relational");
  }

  if (phase === "relational") {
    await purgeUserRelationalData(userId, claimed.user.clerkId, leaseToken);
  }
}

/**
 * Claims the operation under a dedicated user lock, then releases that lock
 * before organization/storage side effects. The durable processing state
 * fences new requests, avoiding two dedicated advisory-lock sessions being
 * held at once while deleteOrganization acquires its organization lock.
 */
export async function deleteAccount(
  userId: string,
  dependencies: AccountDeletionDependencies = {},
): Promise<void> {
  const [user] = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new AccountDeletionError("not_found");

  let lock: UserLock | undefined;
  try {
    // attachUser uses the Clerk identity associated with the app-owned window
    // session for its shared lock; use the exact same key so they cannot pass
    // one another.
    lock = await acquireUserExclusiveLock(user.clerkId);
  } catch {
    throw new AccountDeletionError("in_progress");
  }
  try {
    const claimed = await claimAccountDeletion(userId);
    try {
      await lock.release();
    } catch {
      // Failed unlock destroys the dedicated session. The durable processing
      // state still fences writers, so continue the resumable operation.
    } finally {
      lock = undefined;
    }
    await executeAccountDeletion(claimed, dependencies);
  } finally {
    if (lock) {
      try {
        await lock.release();
      } catch {
        // A failed unlock destroys the dedicated lock session. Do not turn an
        // already committed deletion into a false HTTP failure.
      }
    }
  }
}

// Kept as a named export for synthetic account-deletion tests and callers that
// need to supply the organization storage dependency explicitly.
export { deleteOrganization };

/**
 * Recovery is intentionally bounded. It claims expired processing rows and
 * every failed row whose local user still exists, because Clerk may already
 * have succeeded and the browser session may no longer be able to retry.
 */
export async function recoverAccountDeletions(): Promise<void> {
  const now = new Date();
  const rows = await db
    .select({ userId: accountDeletionLedger.userId })
    .from(accountDeletionLedger)
    .where(
      and(
        or(
          and(
            eq(accountDeletionLedger.status, "processing"),
            or(
              isNull(accountDeletionLedger.leaseUntil),
              lte(accountDeletionLedger.leaseUntil, now),
            ),
          ),
          and(
            eq(accountDeletionLedger.status, "failed"),
            isNotNull(accountDeletionLedger.userId),
          ),
        ),
      ),
    )
    .limit(RECOVERY_BATCH_SIZE);

  for (const row of rows) {
    try {
      if (!row.userId) continue;
      await deleteAccount(row.userId);
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        logger.warn(
          { accountDeletionRecovery: "failed", code: error.code },
          "Account deletion recovery did not complete",
        );
      } else {
        logger.warn(
          { accountDeletionRecovery: "failed" },
          "Account deletion recovery did not complete",
        );
      }
    }
  }
}

/** Keep crash recovery live after startup without an unbounded work queue. */
export function startAccountDeletionRecovery(): void {
  const run = async (): Promise<void> => {
    try {
      await recoverAccountDeletions();
    } catch {
      logger.warn(
        { accountDeletionRecovery: "batch_failed" },
        "Account deletion recovery batch failed",
      );
    } finally {
      setTimeout(() => {
        void run();
      }, RECOVERY_INTERVAL_MS);
    }
  };
  void run();
}
