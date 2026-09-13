import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

/**
 * This suite is deliberately opt-in. It creates only generated development
 * rows, uses a Clerk deleteUser double, and never talks to Stripe or object
 * storage. Run it only against a synthetic test database:
 *
 *   NODE_ENV=test ACCOUNT_DELETION_INTEGRATION=1 <test command>
 *
 * The account-delete-backend injection seam is explicit:
 *
 *   deleteAccount(userId, { deleteClerkUser, deleteOrganization, storage })
 *
 * No Clerk singleton is patched by this suite. A missing injection seam is a
 * test failure rather than a reason to risk a real Clerk request.
 */
const integrationEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.ACCOUNT_DELETION_INTEGRATION === "1";

type DbModule = typeof import("@workspace/db");
type DeletionModule = typeof import("./accountDeletion");
type AccountDeletionDependencies =
  import("./accountDeletion").AccountDeletionDependencies;
type ClerkDeleteUser = (clerkId: string) => Promise<void>;

type SyntheticStorage = {
  listObjectEntitiesForOrganization: (
    organizationId: string,
  ) => Promise<string[]>;
  listOrganizationObjectPaths?: (organizationId: string) => Promise<string[]>;
  hasPrivateObjectDir: () => boolean;
  getPrivateObjectDir?: () => string;
  normalizeObjectEntityPath: (rawPath: string) => string;
  deleteObjectEntityForOrganization: (
    objectPath: string,
    organizationId: string,
  ) => Promise<void>;
};

let dbModule: DbModule | undefined;
let deletionModule: DeletionModule | undefined;
let syntheticOrganizationIds: string[] = [];
let syntheticUserIds: string[] = [];
let targetUserId = "";
let targetClerkId = "";
let teammateUserId = "";
let teammateClerkId = "";
let survivorOwnerId = "";
let clerkFailureUserId = "";
let clerkFailureClerkId = "";
let recoveryUserId = "";
let recoveryClerkId = "";
let ownedOrganizationAId = "";
let ownedOrganizationBId = "";
let survivorOrganizationId = "";
let recoveryOrganizationId = "";
let lateOwnedOrganizationId = "";
let survivorAccountId = "";
let recoveryAccountId = "";
let survivorActivityId = "";
let survivorNoteId = "";
let survivorBindingId = "";
let survivorSyncStateId = "";
let survivorUsageLogId = "";
let survivorCommandId = "";
let privateObjectDirBeforeTest: string | undefined;
let injectRecoveryOwnedMembership = false;
const storageDeletedPaths: string[] = [];
const storageCalls: string[] = [];
const storageAnonymizedClerkIds: string[] = [];

function requireDb(): DbModule {
  assert.ok(dbModule, "database module was not initialized");
  return dbModule;
}

function requireDeletion(): DeletionModule {
  assert.ok(deletionModule, "account deletion module was not initialized");
  return deletionModule;
}

async function query(text: string, values: unknown[] = []) {
  return requireDb().pool.query(text, values);
}

async function countRows(
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const result = await query(
    `SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1`,
    [value],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function createSyntheticStorage(): SyntheticStorage {
  return {
    async listObjectEntitiesForOrganization(organizationId) {
      storageCalls.push(`list-entities:${organizationId}`);
      return [];
    },
    async listOrganizationObjectPaths(organizationId) {
      storageCalls.push(`list-paths:${organizationId}`);
      return [];
    },
    hasPrivateObjectDir() {
      return true;
    },
    getPrivateObjectDir() {
      return "/synthetic-account-deletion";
    },
    normalizeObjectEntityPath(rawPath) {
      return rawPath;
    },
    async deleteObjectEntityForOrganization(objectPath, organizationId) {
      storageCalls.push(`delete:${organizationId}`);
      storageDeletedPaths.push(objectPath);
    },
  };
}

const syntheticStorage = createSyntheticStorage();

async function syntheticDeleteOrganization(
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  // This is the real organization deletion implementation, but its storage
  // side effects are always routed to the in-memory double above.
  await requireDeletion().deleteOrganization(
    organizationId,
    actorUserId,
    syntheticStorage as never,
  );

  // Force a failure in the final relational phase, after the Clerk mock has
  // succeeded. The backend must rewind to organizations; the retry then
  // discovers and deletes this generated late-owned organization itself.
  if (
    injectRecoveryOwnedMembership &&
    organizationId === recoveryOrganizationId
  ) {
    await query(
      `INSERT INTO org_users (org_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [lateOwnedOrganizationId, recoveryUserId],
    );
  }
}

function createAccountDeleteDependencies(
  deleteUser: ClerkDeleteUser,
): AccountDeletionDependencies {
  return {
    deleteClerkUser: deleteUser,
    storage: {
      async anonymizeObjectOwners(clerkId) {
        storageAnonymizedClerkIds.push(clerkId);
      },
    },
    deleteOrganization: syntheticDeleteOrganization,
  };
}

async function deleteAccountWithClerkMock(
  userId: string,
  deleteUser: ClerkDeleteUser,
): Promise<void> {
  const deletion = requireDeletion();
  await deletion.deleteAccount(
    userId,
    createAccountDeleteDependencies(deleteUser),
  );
}

async function cleanupSyntheticRows(): Promise<void> {
  if (!dbModule) return;

  const organizationIds = [...syntheticOrganizationIds];
  const userIds = [...syntheticUserIds];
  if (organizationIds.length === 0 && userIds.length === 0) return;

  await query("BEGIN");
  try {
    // These are the known restrict-linked organization children. Every
    // predicate is constrained to generated fixture IDs.
    if (organizationIds.length > 0) {
      await query(
        "DELETE FROM signature_audit_events WHERE org_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query(
        "DELETE FROM signature_signers WHERE org_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query(
        "DELETE FROM signature_requests WHERE org_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query(
        "DELETE FROM document_versions WHERE org_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query("DELETE FROM documents WHERE org_id = ANY($1::uuid[])", [
        organizationIds,
      ]);
      await query("DELETE FROM cases WHERE org_id = ANY($1::uuid[])", [
        organizationIds,
      ]);
      await query("DELETE FROM contracts WHERE org_id = ANY($1::uuid[])", [
        organizationIds,
      ]);
      await query(
        "DELETE FROM ai_predictions WHERE org_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query(
        "DELETE FROM recommendations WHERE org_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query("DELETE FROM integrations WHERE org_id = ANY($1::uuid[])", [
        organizationIds,
      ]);
      await query(
        "DELETE FROM organization_object_bindings WHERE organization_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query(
        "DELETE FROM organization_deletion_ledger WHERE organization_id = ANY($1::uuid[])",
        [organizationIds],
      );
      await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
        organizationIds,
      ]);
    }
    if (userIds.length > 0) {
      await query(
        "DELETE FROM account_deletion_ledger WHERE user_id = ANY($1::uuid[])",
        [userIds],
      );
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    }
    const syntheticClerkIds = [
      targetClerkId,
      teammateClerkId,
      `synthetic-clerk:${survivorOwnerId}`,
      clerkFailureClerkId,
      recoveryClerkId,
    ].filter(Boolean);
    if (syntheticClerkIds.length > 0) {
      const syntheticHashes = syntheticClerkIds.map((clerkId) =>
        createHash("sha256").update(clerkId).digest("hex"),
      );
      await query(
        "DELETE FROM account_deletion_ledger WHERE user_opaque_hash = ANY($1::text[])",
        [syntheticHashes],
      );
    }
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  } finally {
    syntheticOrganizationIds = [];
    syntheticUserIds = [];
  }
}

before(async () => {
  if (!integrationEnabled) return;

  dbModule = await import("@workspace/db");
  const organizationSchema = await import("../lib/organizationDeletionSchema");
  const accountSchema = await import("../lib/accountDeletionSchema");
  await organizationSchema.ensureOrganizationDeletionLedgerSchema();
  await accountSchema.ensureAccountDeletionSchema();
  // pino-pretty starts a worker when NODE_ENV is non-production. This suite
  // must remain NODE_ENV=test for its opt-in gate, so load the service with a
  // production logger configuration and restore the test environment
  // immediately afterward. No application behavior depends on logger mode.
  const nodeEnvBeforeServiceImport = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    deletionModule = await import("./accountDeletion");
  } finally {
    if (nodeEnvBeforeServiceImport === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = nodeEnvBeforeServiceImport;
    }
  }

  ownedOrganizationAId = randomUUID();
  ownedOrganizationBId = randomUUID();
  survivorOrganizationId = randomUUID();
  recoveryOrganizationId = randomUUID();
  lateOwnedOrganizationId = randomUUID();
  syntheticOrganizationIds = [
    ownedOrganizationAId,
    ownedOrganizationBId,
    survivorOrganizationId,
    recoveryOrganizationId,
    lateOwnedOrganizationId,
  ];

  targetUserId = randomUUID();
  targetClerkId = `synthetic-clerk:${targetUserId}`;
  teammateUserId = randomUUID();
  teammateClerkId = `synthetic-clerk:${teammateUserId}`;
  survivorOwnerId = randomUUID();
  clerkFailureUserId = randomUUID();
  clerkFailureClerkId = `synthetic-clerk:${clerkFailureUserId}`;
  recoveryUserId = randomUUID();
  recoveryClerkId = `synthetic-clerk:${recoveryUserId}`;
  syntheticUserIds = [
    targetUserId,
    teammateUserId,
    survivorOwnerId,
    clerkFailureUserId,
    recoveryUserId,
  ];

  survivorAccountId = randomUUID();
  recoveryAccountId = randomUUID();
  survivorActivityId = randomUUID();
  survivorNoteId = randomUUID();
  survivorBindingId = randomUUID();
  survivorSyncStateId = randomUUID();
  survivorUsageLogId = randomUUID();
  survivorCommandId = randomUUID();

  // Defense in depth: even an accidental future storage fallback must not
  // discover or contact a real private bucket during this synthetic suite.
  privateObjectDirBeforeTest = process.env.PRIVATE_OBJECT_DIR;
  delete process.env.PRIVATE_OBJECT_DIR;

  await query("BEGIN");
  try {
    await query(
      `INSERT INTO organizations
        (id, name, slug, stripe_customer_id, stripe_subscription_id)
       VALUES
        ($1, 'Synthetic account owned A', $2, NULL, NULL),
        ($3, 'Synthetic account owned B', $4, NULL, NULL),
        ($5, 'Synthetic account survivor', $6, NULL, NULL),
        ($7, 'Synthetic account recovery', $8, NULL, NULL),
        ($9, 'Synthetic account late-owned', $10, NULL, NULL)`,
      [
        ownedOrganizationAId,
        `synthetic-account-owned-a-${ownedOrganizationAId}`,
        ownedOrganizationBId,
        `synthetic-account-owned-b-${ownedOrganizationBId}`,
        survivorOrganizationId,
        `synthetic-account-survivor-${survivorOrganizationId}`,
        recoveryOrganizationId,
        `synthetic-account-recovery-${recoveryOrganizationId}`,
        lateOwnedOrganizationId,
        `synthetic-account-late-owned-${lateOwnedOrganizationId}`,
      ],
    );

    await query(
      `INSERT INTO users (id, clerk_id, email, full_name)
       VALUES
        ($1, $2, $3, 'Synthetic account target'),
        ($4, $5, $6, 'Synthetic teammate'),
        ($7, $8, $9, 'Synthetic survivor owner'),
        ($10, $11, $12, 'Synthetic Clerk failure'),
        ($13, $14, $15, 'Synthetic recovery target')`,
      [
        targetUserId,
        targetClerkId,
        `${targetUserId}@synthetic.invalid`,
        teammateUserId,
        teammateClerkId,
        `${teammateUserId}@synthetic.invalid`,
        survivorOwnerId,
        `synthetic-clerk:${survivorOwnerId}`,
        `${survivorOwnerId}@synthetic.invalid`,
        clerkFailureUserId,
        clerkFailureClerkId,
        `${clerkFailureUserId}@synthetic.invalid`,
        recoveryUserId,
        recoveryClerkId,
        `${recoveryUserId}@synthetic.invalid`,
      ],
    );
    await query(
      `INSERT INTO window_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [
        clerkFailureUserId,
        createHash("sha256").update(`synthetic-window:${clerkFailureUserId}`).digest("hex"),
      ],
    );

    await query(
      `INSERT INTO org_users (org_id, user_id, role)
       VALUES
        ($1, $5, 'owner'),
        ($2, $5, 'owner'),
        ($1, $6, 'user'),
        ($2, $6, 'user'),
        ($3, $5, 'admin'),
        ($3, $6, 'user'),
        ($3, $7, 'owner'),
        ($4, $8, 'owner')`,
      [
        ownedOrganizationAId,
        ownedOrganizationBId,
        survivorOrganizationId,
        recoveryOrganizationId,
        targetUserId,
        teammateUserId,
        survivorOwnerId,
        recoveryUserId,
      ],
    );

    await query(
      `INSERT INTO accounts
        (id, org_id, name, owner_user_id, created_by_user_id, files, metadata)
       VALUES
        ($1, $2, 'Surviving synthetic account', $3, $3, '[]'::jsonb,
         jsonb_build_object('createdBy', $3::uuid::text)),
        ($4, $5, 'Recovery synthetic account', $6, $6,
         jsonb_build_array('/objects/synthetic-account-recovery/file'),
         '{}'::jsonb)`,
      [
        survivorAccountId,
        survivorOrganizationId,
        targetUserId,
        recoveryAccountId,
        recoveryOrganizationId,
        recoveryUserId,
      ],
    );

    await query(
      `INSERT INTO activities
        (id, org_id, account_id, type, body, participants, attachments,
         created_by_user_id)
       VALUES
        ($1, $2, $3, 'note', 'Surviving activity body',
         jsonb_build_array($4::uuid::text, $5::uuid::text),
         jsonb_build_array('surviving-attachment'), $4)`,
      [
        survivorActivityId,
        survivorOrganizationId,
        survivorAccountId,
        targetUserId,
        teammateUserId,
      ],
    );

    await query(
      `INSERT INTO internal_notes
        (id, org_id, account_id, author_user_id, body, mentioned_user_ids)
       VALUES ($1, $2, $3, $4, 'Surviving business note', $5::uuid[])`,
      [
        survivorNoteId,
        survivorOrganizationId,
        survivorAccountId,
        targetUserId,
        [targetUserId, teammateUserId],
      ],
    );

    await query(
      `INSERT INTO provider_bindings
        (id, org_id, provider, bound_by_user_id, provider_account_id,
         provider_account_email)
       VALUES ($1, $2, 'synthetic-account-calendar', $3, 'synthetic-account',
               'provider@synthetic.invalid')`,
      [survivorBindingId, survivorOrganizationId, targetUserId],
    );

    await query(
      `INSERT INTO provider_sync_states
        (id, org_id, user_id, provider, provider_account_id)
       VALUES ($1, $2, $3, 'synthetic-account-mail', 'sync-account')`,
      [survivorSyncStateId, survivorOrganizationId, targetUserId],
    );

    await query(
      `INSERT INTO usage_logs
        (id, org_id, user_id, feature_key, action, metadata)
       VALUES ($1, $2, $3, 'synthetic-account', 'created',
               jsonb_build_object('actor', $3::uuid::text))`,
      [survivorUsageLogId, survivorOrganizationId, targetUserId],
    );

    await query(
      `INSERT INTO command_history
        (id, org_id, user_id, transcript, status)
       VALUES ($1, $2, $3, 'private synthetic transcript', 'completed')`,
      [survivorCommandId, survivorOrganizationId, targetUserId],
    );

    await query(
      `INSERT INTO employee_commissions
         (org_id, user_id, commission_percentage, is_active)
       VALUES ($1, $2, 12.50, true)`,
      [survivorOrganizationId, targetUserId],
    );

    await query(
      `INSERT INTO commissions
         (org_id, user_id, employee_name, opportunity_id, opportunity_name,
          opportunity_value, commission_percentage, commission_amount,
          earned_date)
       VALUES ($1, $2, $3, $4, 'Synthetic surviving opportunity',
               1000.00, 12.50, 125.00, now())`,
      [
        survivorOrganizationId,
        targetUserId,
        `${targetUserId}@synthetic.invalid`,
        randomUUID(),
      ],
    );

    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
});

after(async () => {
  try {
    await cleanupSyntheticRows();
  } finally {
    if (privateObjectDirBeforeTest === undefined) {
      delete process.env.PRIVATE_OBJECT_DIR;
    } else {
      process.env.PRIVATE_OBJECT_DIR = privateObjectDirBeforeTest;
    }
    if (dbModule) await dbModule.pool.end();
  }
});

test(
  "synthetic account deletion: Clerk failure is an error and retries safely",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const clerkCalls: string[] = [];
    const failingDeleteUser: ClerkDeleteUser = async (clerkId) => {
      clerkCalls.push(clerkId);
      throw new Error("synthetic Clerk outage");
    };

    await assert.rejects(
      deleteAccountWithClerkMock(clerkFailureUserId, failingDeleteUser),
      (error: unknown) =>
        error instanceof requireDeletion().AccountDeletionError &&
        error.code === "clerk_delete_failed",
      "Clerk failure must not be reported as deletion success",
    );
    assert.deepEqual(clerkCalls, [clerkFailureClerkId]);
    assert.equal(
      await countRows("users", "id", clerkFailureUserId),
      1,
      "local user remains available for an explicit retry",
    );

    const failedLedger = await query(
      `SELECT status, phase, last_error_code, completed_at
         FROM account_deletion_ledger
        WHERE user_id = $1`,
      [clerkFailureUserId],
    );
    assert.deepEqual(failedLedger.rows, [
      {
        status: "failed",
        phase: "clerk",
        last_error_code: "clerk_delete_failed",
        completed_at: null,
      },
    ]);
    const revokedSessions = await query(
      `SELECT count(*)::integer AS count
         FROM window_sessions
        WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [clerkFailureUserId],
    );
    assert.equal(
      revokedSessions.rows[0]?.count,
      1,
      "all app window sessions are revoked at the durable deletion claim",
    );

    const successfulDeleteUser: ClerkDeleteUser = async (clerkId) => {
      clerkCalls.push(clerkId);
    };
    await deleteAccountWithClerkMock(
      clerkFailureUserId,
      successfulDeleteUser,
    );

    assert.deepEqual(clerkCalls, [clerkFailureClerkId, clerkFailureClerkId]);
    assert.equal(
      await countRows("users", "id", clerkFailureUserId),
      0,
      "the explicit retry completes local deletion",
    );
    const completedLedger = await query(
      `SELECT status, phase, last_error_code, lease_token, lease_until,
              completed_at
         FROM account_deletion_ledger
        WHERE user_opaque_hash = $1`,
      [createHash("sha256").update(clerkFailureClerkId).digest("hex")],
    );
    assert.equal(completedLedger.rows.length, 1);
    assert.equal(completedLedger.rows[0].status, "completed");
    assert.equal(completedLedger.rows[0].phase, "relational");
    assert.equal(completedLedger.rows[0].last_error_code, null);
    assert.equal(completedLedger.rows[0].lease_token, null);
    assert.equal(completedLedger.rows[0].lease_until, null);
    assert.ok(completedLedger.rows[0].completed_at);
  },
);

test(
  "synthetic account deletion: Clerk receives clerkId and all owned orgs are purged",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const clerkCalls: string[] = [];
    await deleteAccountWithClerkMock(targetUserId, async (clerkId) => {
      clerkCalls.push(clerkId);
    });

    assert.deepEqual(
      clerkCalls,
      [targetClerkId],
      "Clerk must receive the Clerk identity, never the local UUID",
    );
    assert.ok(
      storageAnonymizedClerkIds.includes(targetClerkId),
      "storage anonymization is routed through the injected fake",
    );
    assert.ok(
      storageCalls.includes(`list-entities:${ownedOrganizationAId}`) &&
        storageCalls.includes(`list-entities:${ownedOrganizationBId}`),
      "owned organization cleanup uses the injected fake storage",
    );
    assert.notEqual(targetClerkId, targetUserId);

    assert.equal(
      await countRows("organizations", "id", ownedOrganizationAId),
      0,
    );
    assert.equal(
      await countRows("organizations", "id", ownedOrganizationBId),
      0,
      "every organization owned by the deleting user is removed",
    );
    assert.equal(
      await countRows("org_users", "org_id", ownedOrganizationAId),
      0,
    );
    assert.equal(
      await countRows("org_users", "org_id", ownedOrganizationBId),
      0,
    );

    assert.equal(
      await countRows("users", "id", targetUserId),
      0,
      "the local user row is deleted",
    );
    assert.equal(
      await countRows("users", "id", teammateUserId),
      1,
      "teammates remain global users",
    );
    assert.equal(
      await countRows("org_users", "org_id", survivorOrganizationId),
      2,
      "the surviving organization keeps its other members",
    );
    assert.equal(
      await countRows("org_users", "user_id", targetUserId),
      0,
      "the deleting user's nonowned membership is removed",
    );
    assert.equal(
      await countRows("org_users", "user_id", teammateUserId),
      1,
      "the teammate's surviving membership remains",
    );

    const survivorRows = await query(
      `SELECT
         a.name AS account_name,
         a.owner_user_id,
         a.created_by_user_id,
         act.body AS activity_body,
         act.created_by_user_id AS activity_creator,
         act.participants,
         n.body AS note_body,
         n.author_user_id AS note_author,
         n.mentioned_user_ids,
         b.bound_by_user_id,
         s.user_id AS sync_user_id,
         u.user_id AS usage_user_id
       FROM accounts a
       JOIN activities act ON act.account_id = a.id
       JOIN internal_notes n ON n.account_id = a.id
       JOIN provider_bindings b ON b.id = $3
       JOIN provider_sync_states s ON s.id = $4
       JOIN usage_logs u ON u.id = $5
      WHERE a.id = $1
        AND a.org_id = $2
        AND act.id = $6
        AND n.id = $7`,
      [
        survivorAccountId,
        survivorOrganizationId,
        survivorBindingId,
        survivorSyncStateId,
        survivorUsageLogId,
        survivorActivityId,
        survivorNoteId,
      ],
    );
    assert.equal(survivorRows.rows.length, 1);
    assert.equal(survivorRows.rows[0].account_name, "Surviving synthetic account");
    assert.equal(survivorRows.rows[0].owner_user_id, null);
    assert.equal(survivorRows.rows[0].created_by_user_id, null);
    assert.equal(survivorRows.rows[0].activity_body, "Surviving activity body");
    assert.equal(survivorRows.rows[0].activity_creator, null);
    assert.deepEqual(survivorRows.rows[0].participants, [
      "[deleted-user]",
      teammateUserId,
    ]);
    assert.equal(survivorRows.rows[0].note_body, "Surviving business note");
    assert.equal(survivorRows.rows[0].note_author, null);
    assert.deepEqual(survivorRows.rows[0].mentioned_user_ids, [teammateUserId]);
    assert.equal(survivorRows.rows[0].bound_by_user_id, null);
    assert.equal(survivorRows.rows[0].sync_user_id, null);
    assert.equal(survivorRows.rows[0].usage_user_id, null);
    assert.equal(
      await countRows("command_history", "user_id", targetUserId),
      0,
      "private command history is deleted",
    );
    assert.equal(
      await countRows("employee_commissions", "user_id", targetUserId),
      0,
      "commission settings are deleted across surviving organizations",
    );
    const survivingCommissionRows = await query(
      `SELECT user_id, employee_name
         FROM commissions
        WHERE org_id = $1
          AND (user_id = $2 OR employee_name = $3)`,
      [
        survivorOrganizationId,
        targetUserId,
        `${targetUserId}@synthetic.invalid`,
      ],
    );
    assert.deepEqual(
      survivingCommissionRows.rows,
      [],
      "surviving organizations retain no deleted user's commission snapshot",
    );

    const ledger = await query(
      `SELECT user_id, user_opaque_hash, status, phase,
              current_organization_id, attempts, lease_token, lease_until,
              last_error_code, completed_at
         FROM account_deletion_ledger
        WHERE user_opaque_hash = $1`,
      [createHash("sha256").update(targetClerkId).digest("hex")],
    );
    assert.equal(ledger.rows.length, 1);
    assert.deepEqual(
      {
        user_id: ledger.rows[0].user_id,
        status: ledger.rows[0].status,
        phase: ledger.rows[0].phase,
        current_organization_id: ledger.rows[0].current_organization_id,
        lease_token: ledger.rows[0].lease_token,
        lease_until: ledger.rows[0].lease_until,
        last_error_code: ledger.rows[0].last_error_code,
      },
      {
         user_id: null,
        status: "completed",
        phase: "relational",
        current_organization_id: null,
        lease_token: null,
        lease_until: null,
        last_error_code: null,
      },
    );
    assert.equal(
      ledger.rows[0].user_opaque_hash,
      createHash("sha256").update(targetClerkId).digest("hex"),
    );
    assert.notEqual(ledger.rows[0].user_opaque_hash, targetUserId);
    assert.ok(ledger.rows[0].attempts >= 1);
    assert.ok(ledger.rows[0].completed_at);
  },
);

test(
  "synthetic account deletion: Clerk success followed by local failure resumes without reprovisioning",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const clerkCalls: string[] = [];
    injectRecoveryOwnedMembership = true;

    await assert.rejects(
      deleteAccountWithClerkMock(recoveryUserId, async (clerkId) => {
        clerkCalls.push(clerkId);
      }),
      (error: unknown) =>
        error instanceof requireDeletion().AccountDeletionError &&
        error.code === "organization_delete_failed",
      "a local relational failure must not become success after Clerk succeeds",
    );
    assert.deepEqual(
      clerkCalls,
      [recoveryClerkId],
      "the Clerk mock succeeds before the injected local relational failure",
    );
    assert.equal(await countRows("users", "id", recoveryUserId), 1);
    assert.equal(
      await countRows("organizations", "id", recoveryOrganizationId),
      0,
      "the owned organization is gone even though relational cleanup is pending",
    );
    assert.equal(
      await countRows("organizations", "id", lateOwnedOrganizationId),
      1,
      "the late-owned organization is still present for the recovery pass",
    );

    const failedLedger = await query(
      `SELECT status, phase, last_error_code, completed_at
         FROM account_deletion_ledger
        WHERE user_id = $1`,
      [recoveryUserId],
    );
    assert.deepEqual(failedLedger.rows, [
      {
        status: "failed",
        phase: "organizations",
        last_error_code: "organization_delete_failed",
        completed_at: null,
      },
    ]);

    injectRecoveryOwnedMembership = false;
    await deleteAccountWithClerkMock(recoveryUserId, async (clerkId) => {
      clerkCalls.push(clerkId);
    });

    assert.deepEqual(
      clerkCalls,
      [recoveryClerkId, recoveryClerkId],
      "rewind retry uses an idempotent Clerk delete and never reprovisions",
    );
    assert.equal(await countRows("users", "id", recoveryUserId), 0);
    assert.equal(
      await countRows("organizations", "id", recoveryOrganizationId),
      0,
    );
    assert.equal(
      await countRows("organizations", "id", lateOwnedOrganizationId),
      0,
      "the retry discovers and deletes the late-owned organization",
    );
    assert.equal(
      await countRows("command_history", "user_id", recoveryUserId),
      0,
    );
    assert.ok(
      storageAnonymizedClerkIds.includes(recoveryClerkId),
      "storage anonymization is routed through the injected fake",
    );
  },
);