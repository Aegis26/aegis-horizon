import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

/**
 * This suite is intentionally opt-in.  It uses only randomly generated
 * development rows and must never point at a production database:
 *
 *   NODE_ENV=test ORG_DELETION_INTEGRATION=1 <test command>
 *
 * The normal unit-test command therefore remains safe when a database is not
 * provisioned.  The suite calls the same narrow ledger-schema initializer as
 * the API startup rather than applying a broad schema migration.
 */
const integrationEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.ORG_DELETION_INTEGRATION === "1";

type DbModule = typeof import("@workspace/db");

let dbModule: DbModule | undefined;
let deletionModule: typeof import("./orgDeletion") | undefined;
let authModule: typeof import("../middlewares/auth") | undefined;
let syntheticOrganizationIds: string[] = [];
let syntheticUserIds: string[] = [];
let storageDeletedPaths: string[] = [];

async function query(text: string, values: unknown[] = []) {
  assert.ok(dbModule, "database module was not initialized");
  return dbModule.pool.query(text, values);
}

function requireDeletionModule(): NonNullable<typeof deletionModule> {
  assert.ok(deletionModule, "deletion module was not initialized");
  return deletionModule;
}

function requireAuthModule(): NonNullable<typeof authModule> {
  assert.ok(authModule, "auth module was not initialized");
  return authModule;
}

function createSyntheticStorage(
  orgId: string,
): Parameters<NonNullable<typeof deletionModule>["deleteOrganization"]>[2] {
  return {
    async listObjectEntitiesForOrganization(storageOrgId: string): Promise<string[]> {
      assert.equal(storageOrgId, orgId);
      return [];
    },
    async listOrganizationObjectPaths(storageOrgId: string): Promise<string[]> {
      assert.equal(storageOrgId, orgId);
      return [];
    },
    hasPrivateObjectDir(): boolean {
      return true;
    },
    normalizeObjectEntityPath(rawPath: string): string {
      return rawPath;
    },
    async deleteObjectEntityForOrganization(
      objectPath: string,
      storageOrgId: string,
    ): Promise<void> {
      assert.equal(storageOrgId, orgId);
      storageDeletedPaths.push(objectPath);
    },
  } as unknown as Parameters<
    NonNullable<typeof deletionModule>["deleteOrganization"]
  >[2];
}

async function countRows(
  table: string,
  organizationId: string,
  organizationColumn = "org_id",
): Promise<number> {
  const result = await query(
    `SELECT count(*)::int AS count FROM ${table} WHERE ${organizationColumn} = $1`,
    [organizationId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function cleanupSyntheticRows(): Promise<void> {
  if (!dbModule || syntheticOrganizationIds.length === 0) return;

  const orgIds = syntheticOrganizationIds;
  const userIds = syntheticUserIds;

  // Delete the known restrict children first.  The remaining synthetic rows
  // are cascade children of organizations and are removed by the final
  // organization delete.  Every predicate is limited to generated IDs.
  await query("BEGIN");
  try {
    await query(
      "DELETE FROM signature_audit_events WHERE org_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query(
      "DELETE FROM signature_signers WHERE org_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query(
      "DELETE FROM signature_requests WHERE org_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query(
      "DELETE FROM document_versions WHERE org_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query("DELETE FROM documents WHERE org_id = ANY($1::uuid[])", [
      orgIds,
    ]);
    await query("DELETE FROM cases WHERE org_id = ANY($1::uuid[])", [orgIds]);
    await query("DELETE FROM contracts WHERE org_id = ANY($1::uuid[])", [
      orgIds,
    ]);
    await query("DELETE FROM ai_predictions WHERE org_id = ANY($1::uuid[])", [
      orgIds,
    ]);
    await query(
      "DELETE FROM recommendations WHERE org_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query("DELETE FROM integrations WHERE org_id = ANY($1::uuid[])", [
      orgIds,
    ]);
    await query(
      "DELETE FROM organization_object_bindings WHERE organization_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query(
      "DELETE FROM organization_deletion_ledger WHERE organization_id = ANY($1::uuid[])",
      [orgIds],
    );
    await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      orgIds,
    ]);
    await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
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
  const schema = await import("../lib/organizationDeletionSchema");
  await schema.ensureOrganizationDeletionLedgerSchema();
  deletionModule = await import("./orgDeletion");

  const targetOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const blockedOrgId = randomUUID();
  syntheticOrganizationIds = [targetOrgId, otherOrgId, blockedOrgId];

  const targetOwnerId = randomUUID();
  const adminId = randomUUID();
  const managerId = randomUUID();
  const userId = randomUUID();
  const viewerId = randomUUID();
  const otherOrgOwnerId = randomUUID();
  const otherOrgMemberId = randomUUID();
  const blockedOrgOwnerId = randomUUID();
  syntheticUserIds = [
    targetOwnerId,
    adminId,
    managerId,
    userId,
    viewerId,
    otherOrgOwnerId,
    otherOrgMemberId,
    blockedOrgOwnerId,
  ];

  await query("BEGIN");
  try {
    await query(
      `INSERT INTO organizations
        (id, name, slug, stripe_customer_id, stripe_subscription_id)
       VALUES
        ($1, $2, $3, NULL, NULL),
         ($4, $5, $6, NULL, NULL),
         ($7, $8, $9, NULL, NULL)`,
      [
        targetOrgId,
        "Synthetic deletion target",
        `synthetic-deletion-target-${targetOrgId}`,
        otherOrgId,
        "Synthetic surviving organization",
        `synthetic-deletion-survivor-${otherOrgId}`,
        blockedOrgId,
        "Synthetic lock target",
        `synthetic-deletion-lock-target-${blockedOrgId}`,
      ],
    );

    await query(
      `INSERT INTO users (id, clerk_id, email, full_name)
       VALUES
        ($1, $2, $3, $4),
        ($5, $6, $7, $8),
        ($9, $10, $11, $12),
        ($13, $14, $15, $16),
        ($17, $18, $19, $20),
        ($21, $22, $23, $24),
         ($25, $26, $27, $28),
         ($29, $30, $31, $32)`,
      [
        targetOwnerId,
        `synthetic:${targetOwnerId}`,
        `${targetOwnerId}@synthetic.invalid`,
        "Synthetic owner",
        adminId,
        `synthetic:${adminId}`,
        `${adminId}@synthetic.invalid`,
        "Synthetic admin",
        managerId,
        `synthetic:${managerId}`,
        `${managerId}@synthetic.invalid`,
        "Synthetic manager",
        userId,
        `synthetic:${userId}`,
        `${userId}@synthetic.invalid`,
        "Synthetic user",
        viewerId,
        `synthetic:${viewerId}`,
        `${viewerId}@synthetic.invalid`,
        "Synthetic viewer",
        otherOrgOwnerId,
        `synthetic:${otherOrgOwnerId}`,
        `${otherOrgOwnerId}@synthetic.invalid`,
        "Surviving organization owner",
        otherOrgMemberId,
        `synthetic:${otherOrgMemberId}`,
        `${otherOrgMemberId}@synthetic.invalid`,
        "Surviving organization member",
        blockedOrgOwnerId,
        `synthetic:${blockedOrgOwnerId}`,
        `${blockedOrgOwnerId}@synthetic.invalid`,
        "Synthetic lock target owner",
      ],
    );

    await query(
      `INSERT INTO org_users (org_id, user_id, role)
       VALUES
        ($1, $2, 'owner'),
        ($1, $3, 'admin'),
        ($1, $4, 'manager'),
        ($1, $5, 'user'),
        ($1, $6, 'viewer'),
        ($7, $8, 'owner'),
         ($7, $9, 'user'),
         ($10, $11, 'owner')`,
      [
        targetOrgId,
        targetOwnerId,
        adminId,
        managerId,
        userId,
        viewerId,
        otherOrgId,
        otherOrgOwnerId,
        otherOrgMemberId,
        blockedOrgId,
        blockedOrgOwnerId,
      ],
    );

    const targetAccountId = randomUUID();
    const otherAccountId = randomUUID();
    const targetActivityId = randomUUID();
    const otherCaseId = randomUUID();
    const targetCaseId = randomUUID();
    const targetContractId = randomUUID();
    const targetPredictionId = randomUUID();
    const targetRecommendationId = randomUUID();
    const targetIntegrationId = randomUUID();
    const targetDocumentId = randomUUID();
    const targetDocumentVersionId = randomUUID();
    const targetSignatureRequestId = randomUUID();
    const targetSignerId = randomUUID();
    const targetSignatureAuditId = randomUUID();
    const targetReportExportId = randomUUID();
    const targetCallRecordingId = randomUUID();
    const targetAuditId = randomUUID();
    const otherAuditId = randomUUID();
    const targetBindingId = randomUUID();
    const otherBindingId = randomUUID();

    await query(
      `INSERT INTO accounts (id, org_id, name, files)
       VALUES
        ($1, $2, 'Synthetic account', $3::jsonb),
        ($4, $5, 'Surviving account', '[]'::jsonb)`,
      [
        targetAccountId,
        targetOrgId,
        JSON.stringify([
          "/objects/synthetic-deletion/account-file",
          "https://example.invalid/public-not-owned",
        ]),
        otherAccountId,
        otherOrgId,
      ],
    );

    await query(
      `INSERT INTO activities (id, org_id, account_id, type, attachments)
       VALUES ($1, $2, $3, 'note', $4::jsonb)`,
      [
        targetActivityId,
        targetOrgId,
        targetAccountId,
        JSON.stringify(["/objects/synthetic-deletion/activity-file"]),
      ],
    );

    // These five rows exercise the current schema's stub/restrict exceptions.
    await query("INSERT INTO cases (id, org_id) VALUES ($1, $2)", [
      targetCaseId,
      targetOrgId,
    ]);
    await query("INSERT INTO contracts (id, org_id) VALUES ($1, $2)", [
      targetContractId,
      targetOrgId,
    ]);
    await query("INSERT INTO ai_predictions (id, org_id) VALUES ($1, $2)", [
      targetPredictionId,
      targetOrgId,
    ]);
    await query(
      "INSERT INTO recommendations (id, org_id) VALUES ($1, $2)",
      [targetRecommendationId, targetOrgId],
    );
    await query("INSERT INTO integrations (id, org_id) VALUES ($1, $2)", [
      targetIntegrationId,
      targetOrgId,
    ]);

    await query(
      `INSERT INTO cases (id, org_id)
       VALUES ($1, $2)`,
      [otherCaseId, otherOrgId],
    );

    // Signature rows deliberately use the restrict-linked version and are
    // removed by the service's explicit pre-cascade deletes.
    await query(
      `INSERT INTO documents (id, org_id, name)
       VALUES ($1, $2, 'Synthetic signed document')`,
      [targetDocumentId, targetOrgId],
    );
    await query(
      `INSERT INTO document_versions
        (id, org_id, document_id, version, object_path, file_name,
         content_type, size_bytes)
       VALUES
        ($1, $2, $3, 1, '/objects/synthetic-deletion/document-file',
         'synthetic.txt', 'text/plain', 12)`,
      [targetDocumentVersionId, targetOrgId, targetDocumentId],
    );
    await query(
      `INSERT INTO signature_requests
        (id, org_id, document_id, document_version_id)
       VALUES ($1, $2, $3, $4)`,
      [
        targetSignatureRequestId,
        targetOrgId,
        targetDocumentId,
        targetDocumentVersionId,
      ],
    );
    await query(
      `INSERT INTO signature_signers
        (id, org_id, signature_request_id, name, email, token_hash)
       VALUES ($1, $2, $3, 'Synthetic signer', $4, $5)`,
      [
        targetSignerId,
        targetOrgId,
        targetSignatureRequestId,
        `${targetSignerId}@synthetic.invalid`,
        `synthetic-token-${targetSignerId}`,
      ],
    );
    await query(
      `INSERT INTO signature_audit_events
        (id, org_id, signature_request_id, event_type)
       VALUES ($1, $2, $3, 'created')`,
      [targetSignatureAuditId, targetOrgId, targetSignatureRequestId],
    );

    await query(
      `INSERT INTO report_exports (id, org_id, format, object_path)
       VALUES ($1, $2, 'txt', '/objects/synthetic-deletion/report-file')`,
      [targetReportExportId, targetOrgId],
    );
    await query(
      `INSERT INTO call_recordings
        (id, org_id, account_id, call_sid, to_number, correlation_token_hash,
         recording_object_path)
       VALUES
        ($1, $2, $3, $4, '+15555550100', $5,
         '/objects/synthetic-deletion/recording-file')`,
      [
        targetCallRecordingId,
        targetOrgId,
        targetAccountId,
        `synthetic-call-${targetCallRecordingId}`,
        `synthetic-correlation-${targetCallRecordingId}`,
      ],
    );

    await query(
      `INSERT INTO audit_events
        (id, org_id, actor_user_id, action, entity_type, entity_id)
       VALUES
        ($1, $2, $3, 'synthetic.seeded', 'synthetic', $4),
        ($5, $6, $7, 'synthetic.survivor', 'synthetic', $8)`,
      [
        targetAuditId,
        targetOrgId,
        targetOwnerId,
        targetOrgId,
        otherAuditId,
        otherOrgId,
        otherOrgOwnerId,
        otherOrgId,
      ],
    );

    await query(
      `INSERT INTO organization_object_bindings
        (id, object_path, organization_id, owner_user_id)
       VALUES
        ($1, '/objects/synthetic-deletion/authoritative-file', $2, $3),
        ($4, '/objects/synthetic-survivor/authoritative-file', $5, $6)`,
      [
        targetBindingId,
        targetOrgId,
        targetOwnerId,
        otherBindingId,
        otherOrgId,
        otherOrgOwnerId,
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
    if (dbModule) await dbModule.pool.end();
  }
});

test(
  "synthetic integration: only the owner can delete, and a foreign-org user is forbidden",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const deletion = requireDeletionModule();
    assert.equal(syntheticOrganizationIds.length, 3);

    const targetOrgId = syntheticOrganizationIds[0];
    const otherOrgId = syntheticOrganizationIds[1];
    const actorByRole: Record<string, string> = {
      admin: syntheticUserIds[1],
      manager: syntheticUserIds[2],
      user: syntheticUserIds[3],
      viewer: syntheticUserIds[4],
    };

    for (const [role, actorUserId] of Object.entries(actorByRole)) {
      await assert.rejects(
        deletion.deleteOrganization(targetOrgId, actorUserId),
        (error: unknown) =>
          error instanceof deletion.OrganizationDeletionError &&
          error.code === "forbidden",
        `${role} membership must be forbidden`,
      );
    }

    await assert.rejects(
      deletion.deleteOrganization(targetOrgId, syntheticUserIds[5]),
      (error: unknown) =>
        error instanceof deletion.OrganizationDeletionError &&
        error.code === "forbidden",
      "an owner of another organization must be forbidden",
    );

    const ledger = await query(
      "SELECT count(*)::int AS count FROM organization_deletion_ledger WHERE organization_id = $1",
      [targetOrgId],
    );
    assert.equal(
      Number(ledger.rows[0]?.count ?? 0),
      0,
      "forbidden actors must not claim a deletion ledger",
    );
    assert.equal(await countRows("organizations", targetOrgId, "id"), 1);
    assert.equal(await countRows("organizations", otherOrgId, "id"), 1);
  },
);

test(
  "synthetic integration: owner deletion purges relational data without Stripe or real storage",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const deletion = requireDeletionModule();
    const targetOrgId = syntheticOrganizationIds[0];
    const targetOwnerId = syntheticUserIds[0];

    storageDeletedPaths = [];
    const storage = createSyntheticStorage(targetOrgId);

    // Both Stripe identifiers are NULL in the fixture.  The billing stage
    // therefore makes no external call; every storage operation is the fake
    // above, and all rows are scoped to generated organization IDs.
    await deletion.deleteOrganization(targetOrgId, targetOwnerId, storage);

    assert.deepEqual(
      new Set(storageDeletedPaths),
      new Set([
        "/objects/synthetic-deletion/account-file",
        "/objects/synthetic-deletion/activity-file",
        "/objects/synthetic-deletion/document-file",
        "/objects/synthetic-deletion/report-file",
        "/objects/synthetic-deletion/recording-file",
        "/objects/synthetic-deletion/authoritative-file",
      ]),
      "all modeled private references are handed to the injected storage seam",
    );

    assert.equal(await countRows("organizations", targetOrgId, "id"), 0);
    assert.equal(await countRows("org_users", targetOrgId), 0);
    assert.equal(await countRows("accounts", targetOrgId), 0);
    assert.equal(await countRows("activities", targetOrgId), 0);
    assert.equal(await countRows("cases", targetOrgId), 0);
    assert.equal(await countRows("contracts", targetOrgId), 0);
    assert.equal(await countRows("ai_predictions", targetOrgId), 0);
    assert.equal(await countRows("recommendations", targetOrgId), 0);
    assert.equal(await countRows("integrations", targetOrgId), 0);
    assert.equal(await countRows("documents", targetOrgId), 0);
    assert.equal(await countRows("document_versions", targetOrgId), 0);
    assert.equal(await countRows("signature_requests", targetOrgId), 0);
    assert.equal(await countRows("signature_signers", targetOrgId), 0);
    assert.equal(await countRows("signature_audit_events", targetOrgId), 0);
    assert.equal(await countRows("report_exports", targetOrgId), 0);
    assert.equal(await countRows("call_recordings", targetOrgId), 0);
    assert.equal(await countRows("audit_events", targetOrgId), 0);
    assert.equal(
      await countRows(
        "organization_object_bindings",
        targetOrgId,
        "organization_id",
      ),
      0,
    );
  },
);

test(
  "synthetic integration: a concurrent shared writer lock blocks exclusive deletion",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const deletion = requireDeletionModule();
    const locks = await import("../lib/orgWriteLock");
    const blockedOrgId = syntheticOrganizationIds[2];
    const blockedOwnerId = syntheticUserIds[7];
    const writerLock = await locks.acquireOrganizationSharedLock(blockedOrgId);

    let settled = false;
    let operationError: unknown;
    const deletionOperation = deletion
      .deleteOrganization(
        blockedOrgId,
        blockedOwnerId,
        createSyntheticStorage(blockedOrgId),
      )
      .then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          operationError = error;
        },
      );

    // The deletion must wait on the shared writer lock. Release it only after
    // observing that the operation is still pending, then let cleanup finish.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const wasBlocked = !settled;
    await writerLock.release();
    await deletionOperation;

    assert.equal(wasBlocked, true);
    assert.equal(operationError, undefined);
    assert.equal(await countRows("organizations", blockedOrgId, "id"), 0);
  },
);

test(
  "synthetic integration: completed ledger and unrelated organization/users survive the purge",
  { skip: !integrationEnabled, timeout: 120_000 },
  async () => {
    const targetOrgId = syntheticOrganizationIds[0];
    const otherOrgId = syntheticOrganizationIds[1];
    const targetUserIds = syntheticUserIds.slice(0, 5);
    const otherOrgUserIds = syntheticUserIds.slice(5);

    const completed = await query(
      `SELECT organization_id, requested_by_user_id, status, phase,
              completed_at
         FROM organization_deletion_ledger
        WHERE organization_id = $1`,
      [targetOrgId],
    );
    assert.equal(completed.rows.length, 1);
    assert.equal(completed.rows[0].organization_id, targetOrgId);
    assert.equal(completed.rows[0].requested_by_user_id, targetUserIds[0]);
    assert.equal(completed.rows[0].status, "completed");
    assert.equal(completed.rows[0].phase, "relational");
    assert.ok(completed.rows[0].completed_at);

    // The target audit row is cascade-owned and was removed, while the
    // org-independent completion ledger remains durable.
    assert.equal(await countRows("audit_events", otherOrgId), 1);
    assert.equal(await countRows("cases", otherOrgId), 1);
    assert.equal(await countRows("accounts", otherOrgId), 1);
    assert.equal(await countRows("organizations", otherOrgId, "id"), 1);
    assert.equal(await countRows("org_users", otherOrgId), 2);
    assert.equal(
      await countRows(
        "organization_object_bindings",
        otherOrgId,
        "organization_id",
      ),
      1,
    );

    const users = await query(
      "SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[...targetUserIds, ...otherOrgUserIds]],
    );
    assert.equal(
      users.rows.length,
      targetUserIds.length + otherOrgUserIds.length,
      "users survive organization deletion, including users formerly in the deleted org",
    );

    authModule = await import("../middlewares/auth");
    const auth = requireAuthModule();
    let statusCode: number | undefined;
    let responseBody: unknown;
    let nextCalled = false;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        responseBody = body;
        return this;
      },
      once() {
        return this;
      },
    };
    const request = {
      method: "POST",
      currentOrg: { id: targetOrgId },
      log: { warn() {} },
    };

    await auth.rejectOrganizationDeletionWrite(
      request as unknown as Parameters<
        typeof auth.rejectOrganizationDeletionWrite
      >[0],
      response as unknown as Parameters<
        typeof auth.rejectOrganizationDeletionWrite
      >[1],
      () => {
        nextCalled = true;
      },
    );
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 409);
    assert.deepEqual(responseBody, {
      error: "Organization deletion is in progress; retry after it completes",
    });
  },
);