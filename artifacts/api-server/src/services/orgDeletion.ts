import { createHash, randomUUID } from "node:crypto";
import {
  and,
  eq,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  accounts,
  activities,
  callRecordings,
  cases,
  contracts,
  db,
  documentVersions,
  documents,
  integrations,
  organizationDeletionLedger,
  organizationObjectBindings,
  organizations,
  orgUsers,
  recommendations,
  reportExports,
  signatureAuditEvents,
  signatureRequests,
  signatureSigners,
  aiPredictions,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  acquireOrganizationExclusiveLock,
  type OrganizationLock,
} from "../lib/orgWriteLock";
import { cancelOrganizationBilling } from "./orgDeletionBilling";
import {
  runDeletionStages,
  type DeletionPhase,
} from "./orgDeletionStages";

const DELETION_LEASE_MS = 10 * 60 * 1000;

function localUserOpaqueHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

export class OrganizationDeletionError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "forbidden"
      | "in_progress"
      | "stripe_cancel_failed"
      | "storage_delete_failed"
      | "relational_delete_failed",
  ) {
    super(code);
    this.name = "OrganizationDeletionError";
  }
}

type ClaimedDeletion = {
  organization: typeof organizations.$inferSelect;
  ledger: typeof organizationDeletionLedger.$inferSelect;
};

async function claimDeletion(
  orgId: string,
  userId: string,
): Promise<ClaimedDeletion> {
  return db.transaction(async (tx) => {
    // Locking the org row serializes ownership changes and concurrent
    // deletion attempts at the point the request is authorized.
    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");
    if (!organization) {
      throw new OrganizationDeletionError("not_found");
    }

    const [membership] = await tx
      .select()
      .from(orgUsers)
      .where(
        and(
          eq(orgUsers.orgId, orgId),
          eq(orgUsers.userId, userId),
          eq(orgUsers.role, "owner"),
        ),
      )
      .for("update");
    if (!membership) {
      throw new OrganizationDeletionError("forbidden");
    }

    const now = new Date();
    let [ledger] = await tx
      .select()
      .from(organizationDeletionLedger)
      .where(eq(organizationDeletionLedger.organizationId, orgId))
      .for("update");

    if (!ledger) {
      [ledger] = await tx
        .insert(organizationDeletionLedger)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          requestedByUserId: userId,
          requestedByUserHash: localUserOpaqueHash(userId),
          status: "pending",
          phase: "stripe",
        })
        .returning();
    }

    if (ledger.status === "processing" && ledger.leaseUntil && ledger.leaseUntil > now) {
      throw new OrganizationDeletionError("in_progress");
    }
    if (ledger.status === "completed") {
      // A completed ledger and a live organization would indicate a broken
      // reconciliation state; do not claim or report destructive success.
      throw new OrganizationDeletionError("relational_delete_failed");
    }

    const leaseUntil = new Date(now.getTime() + DELETION_LEASE_MS);
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(organizationDeletionLedger)
      .set({
        leaseOwnerUserId: userId,
        requestedByUserHash: localUserOpaqueHash(userId),
        status: "processing",
        attempts: sql`${organizationDeletionLedger.attempts} + 1`,
        leaseToken,
        leaseUntil,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationDeletionLedger.organizationId, orgId),
          or(
            ne(organizationDeletionLedger.status, "processing"),
            isNull(organizationDeletionLedger.leaseUntil),
            lte(organizationDeletionLedger.leaseUntil, now),
          ),
        ),
      )
      .returning();

    if (!claimed) {
      throw new OrganizationDeletionError("in_progress");
    }
    return { organization, ledger: claimed };
  });
}

async function advancePhase(
  orgId: string,
  phase: DeletionPhase,
  leaseToken: string,
): Promise<void> {
  const [advanced] = await db
    .update(organizationDeletionLedger)
    .set({
      status: "processing",
      phase,
      leaseUntil: new Date(Date.now() + DELETION_LEASE_MS),
      lastErrorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizationDeletionLedger.organizationId, orgId),
        eq(organizationDeletionLedger.leaseToken, leaseToken),
        eq(organizationDeletionLedger.status, "processing"),
      ),
    )
    .returning({ id: organizationDeletionLedger.id });
  if (!advanced) throw new OrganizationDeletionError("in_progress");
}

async function markFailed(
  orgId: string,
  leaseToken: string,
  code: Exclude<
    OrganizationDeletionError["code"],
    "not_found" | "forbidden" | "in_progress"
  >,
): Promise<void> {
  await db
    .update(organizationDeletionLedger)
    .set({
      status: "failed",
      leaseOwnerUserId: null,
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: code,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizationDeletionLedger.organizationId, orgId),
        eq(organizationDeletionLedger.leaseToken, leaseToken),
      ),
    );
}

function collectObjectPaths(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    if (
      value.startsWith("/objects/") ||
      value.startsWith("https://storage.googleapis.com/")
    ) {
      output.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectObjectPaths(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectObjectPaths(item, output);
  }
}

/**
 * Collect every currently modeled organization-owned object reference before
 * relational rows are removed.  Unknown public URLs are intentionally not
 * interpreted as private object keys.
 */
export async function listOrganizationObjectPaths(
  orgId: string,
  storage = new ObjectStorageService(),
): Promise<string[]> {
  const [
    versions,
    exports,
    recordings,
    accountRows,
    activityRows,
    bindingRows,
  ] =
    await Promise.all([
      db
        .select({ objectPath: documentVersions.objectPath })
        .from(documentVersions)
        .where(eq(documentVersions.orgId, orgId)),
      db
        .select({ objectPath: reportExports.objectPath })
        .from(reportExports)
        .where(eq(reportExports.orgId, orgId)),
      db
        .select({ objectPath: callRecordings.recordingObjectPath })
        .from(callRecordings)
        .where(eq(callRecordings.orgId, orgId)),
      db.select({ files: accounts.files }).from(accounts).where(eq(accounts.orgId, orgId)),
      db
        .select({ attachments: activities.attachments })
        .from(activities)
        .where(eq(activities.orgId, orgId)),
      db
        .select({ objectPath: organizationObjectBindings.objectPath })
        .from(organizationObjectBindings)
        .where(eq(organizationObjectBindings.organizationId, orgId)),
    ]);

  const paths = new Set<string>();
  for (const row of versions) collectObjectPaths(row.objectPath, paths);
  for (const row of exports) collectObjectPaths(row.objectPath, paths);
  for (const row of recordings) collectObjectPaths(row.objectPath, paths);
  for (const row of accountRows) collectObjectPaths(row.files, paths);
  for (const row of activityRows) collectObjectPaths(row.attachments, paths);
  for (const row of bindingRows) paths.add(row.objectPath);
  if (!storage.hasPrivateObjectDir()) {
    const modeledPrivatePaths = [...paths].filter((path) =>
      path.startsWith("/objects/"),
    );
    if (modeledPrivatePaths.length > 0) {
      // A modeled private reference without a configured GCS sidecar path is
      // not safe to declare deleted. With no references, storage is optional
      // for deployments that never enabled uploads.
      storage.getPrivateObjectDir();
    }
    // Other URL forms may refer to public assets and are intentionally not
    // interpreted as private sidecar object keys without configuration.
    return [];
  }
  for (const path of await storage.listObjectEntitiesForOrganization(orgId)) {
    paths.add(path);
  }
  return [...paths];
}

async function purgeRelationalData(
  orgId: string,
  actorUserId: string,
  leaseToken: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");
    if (!organization) {
      throw new OrganizationDeletionError("relational_delete_failed");
    }

    // Recheck the actor immediately before the irreversible purge. Ownership
    // may have changed while Stripe/storage cleanup was running.
    const [ownerMembership] = await tx
      .select({ id: orgUsers.id })
      .from(orgUsers)
      .where(
        and(
          eq(orgUsers.orgId, orgId),
          eq(orgUsers.userId, actorUserId),
          eq(orgUsers.role, "owner"),
        ),
      )
      .for("update");
    if (!ownerMembership) {
      throw new OrganizationDeletionError("forbidden");
    }

    // These are the intentional non-cascade/restrict exceptions in the
    // current schema.  Everything else is then safely removed by the
    // organization's cascade in the same transaction.
    await tx.delete(signatureAuditEvents).where(eq(signatureAuditEvents.orgId, orgId));
    await tx.delete(signatureSigners).where(eq(signatureSigners.orgId, orgId));
    await tx.delete(signatureRequests).where(eq(signatureRequests.orgId, orgId));
    await tx.delete(documentVersions).where(eq(documentVersions.orgId, orgId));
    await tx.delete(documents).where(eq(documents.orgId, orgId));
    await tx.delete(cases).where(eq(cases.orgId, orgId));
    await tx.delete(contracts).where(eq(contracts.orgId, orgId));
    await tx.delete(aiPredictions).where(eq(aiPredictions.orgId, orgId));
    await tx.delete(recommendations).where(eq(recommendations.orgId, orgId));
    await tx.delete(integrations).where(eq(integrations.orgId, orgId));
    await tx
      .delete(organizationObjectBindings)
      .where(eq(organizationObjectBindings.organizationId, orgId));

    const [completed] = await tx
      .update(organizationDeletionLedger)
      .set({
        status: "completed",
        requestedByUserId: null,
        leaseOwnerUserId: null,
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationDeletionLedger.organizationId, orgId),
          eq(organizationDeletionLedger.leaseOwnerUserId, actorUserId),
          eq(organizationDeletionLedger.leaseToken, leaseToken),
          eq(organizationDeletionLedger.status, "processing"),
          eq(organizationDeletionLedger.phase, "relational"),
        ),
      )
      .returning();
    if (!completed) {
      throw new OrganizationDeletionError("relational_delete_failed");
    }

    // The organization row is the cascade root for all modeled tenant data.
    // org_users is also removed here; users intentionally are not.
    const [deleted] = await tx
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .returning({ id: organizations.id });
    if (!deleted) {
      throw new OrganizationDeletionError("relational_delete_failed");
    }
  });
}

async function sweepOrganizationObjects(
  orgId: string,
  storage: ObjectStorageService,
): Promise<void> {
  const paths = await listOrganizationObjectPaths(orgId, storage);
  for (const rawPath of paths) {
    const normalizedPath = storage.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/objects/")) continue;
    await storage.deleteObjectEntityForOrganization(normalizedPath, orgId);
  }
}

/**
 * Executes a deletion request. External side effects happen before the final
 * relational transaction; every completed side-effect phase is durable in the
 * independent ledger, so a retry can safely resume after process failure.
 */
async function deleteOrganizationWithExclusiveLock(
  orgId: string,
  actorUserId: string,
  storage = new ObjectStorageService(),
): Promise<void> {
  const claimed = await claimDeletion(orgId, actorUserId);
  const leaseToken = claimed.ledger.leaseToken;
  if (!leaseToken) {
    throw new OrganizationDeletionError("relational_delete_failed");
  }
  let currentPhase = claimed.ledger.phase as DeletionPhase;

  try {
    await runDeletionStages({
      phase: currentPhase,
      subscriptionId: claimed.organization.stripeSubscriptionId,
      billingRequired: Boolean(
        claimed.organization.stripeCustomerId ||
          claimed.organization.stripeSubscriptionId,
      ),
      cancelSubscription: () => cancelOrganizationBilling(claimed.organization),
      listObjectPaths: () => listOrganizationObjectPaths(orgId, storage),
      deleteObject: async (rawPath) => {
        const normalizedPath = storage.normalizeObjectEntityPath(rawPath);
        if (!normalizedPath.startsWith("/objects/")) return;
        await storage.deleteObjectEntityForOrganization(normalizedPath, orgId);
      },
      advance: (phase) => {
        currentPhase = phase;
        return advancePhase(orgId, phase, leaseToken);
      },
    });
  } catch (error) {
    if (
      error instanceof OrganizationDeletionError &&
      error.code === "in_progress"
    ) {
      throw error;
    }
    const code = currentPhase === "stripe"
      ? "stripe_cancel_failed"
      : "storage_delete_failed";
    await markFailed(orgId, leaseToken, code);
    throw new OrganizationDeletionError(code);
  }

  // The ledger is already in the relational phase here. Writes are fenced by
  // attachOrg/background guards, so this final sweep catches objects uploaded
  // or orphaned while earlier external work was in flight. Retries from the
  // relational phase deliberately repeat it.
  try {
    await sweepOrganizationObjects(orgId, storage);
  } catch (error) {
    await markFailed(orgId, leaseToken, "storage_delete_failed");
    throw new OrganizationDeletionError("storage_delete_failed");
  }

  try {
    await purgeRelationalData(orgId, actorUserId, leaseToken);
  } catch (error) {
    if (
      error instanceof OrganizationDeletionError &&
      error.code === "in_progress"
    ) {
      throw error;
    }
    await markFailed(orgId, leaseToken, "relational_delete_failed");
    if (
      error instanceof OrganizationDeletionError &&
      error.code === "forbidden"
    ) {
      throw error;
    }
    throw new OrganizationDeletionError("relational_delete_failed");
  }
}

export async function deleteOrganization(
  orgId: string,
  actorUserId: string,
  storage = new ObjectStorageService(),
): Promise<void> {
  let lock: OrganizationLock;
  try {
    lock = await acquireOrganizationExclusiveLock(orgId);
  } catch {
    throw new OrganizationDeletionError("in_progress");
  }
  try {
    await deleteOrganizationWithExclusiveLock(orgId, actorUserId, storage);
  } finally {
    try {
      await lock.release();
    } catch {
      // The lock client is destroyed by release() when unlock/reset fails.
      // The deletion result itself must not be changed into a false failure.
    }
  }
}