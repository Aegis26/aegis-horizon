import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";

/**
 * This is deliberately opt-in and uses one generated organization, users,
 * account, opportunities, settings, and ledger. It must only be run against
 * a synthetic test database:
 *
 * NODE_ENV=test COMMISSION_INTEGRATION=1 pnpm --filter @workspace/api-server test
 */
const integrationEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.COMMISSION_INTEGRATION === "1";

type DbModule = typeof import("@workspace/db");
type CommissionModule = typeof import("./commissions");
type MigrationModule = typeof import("../lib/commissionSchema");

let dbModule: DbModule | undefined;
let commissionsModule: CommissionModule | undefined;
let migrationModule: MigrationModule | undefined;
let organizationId = "";
let ownerId = "";
let teammateId = "";
let accountId = "";
let teammateMembershipId = "";

function requireDb(): DbModule {
  assert.ok(dbModule, "database module was not initialized");
  return dbModule;
}

function requireCommissionService(): CommissionModule {
  assert.ok(commissionsModule, "commission service was not initialized");
  return commissionsModule;
}

async function query(text: string, values: unknown[] = []) {
  return requireDb().pool.query(text, values);
}

async function createOpportunity(
  name: string,
  value: string | null,
  userId = ownerId,
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO opportunities (
       id, org_id, account_id, name, stage, probability, value,
       forecast_category, owner_user_id, created_by_user_id
     ) VALUES ($1, $2, $3, $4, 'prospecting', 10, $5, 'pipeline', $6, $6)`,
    [id, organizationId, accountId, name, value, userId],
  );
  return id;
}

async function closeOpportunity(
  opportunityId: string,
  earnedDate = new Date("2025-01-15T12:00:00.000Z"),
): Promise<void> {
  await requireDb().db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(requireDb().opportunities)
      .where(
        and(
          eq(requireDb().opportunities.id, opportunityId),
          eq(requireDb().opportunities.orgId, organizationId),
        ),
      )
      .for("update");
    assert.ok(before, "synthetic opportunity must exist");
    const [next] = await tx
      .update(requireDb().opportunities)
      .set({ stage: "closed_won", forecastCategory: "closed_won" })
      .where(eq(requireDb().opportunities.id, opportunityId))
      .returning();
    assert.ok(next, "synthetic opportunity close must update a row");
    await requireCommissionService().recordCommissionForClosedWon(
      tx,
      before,
      next,
      earnedDate,
    );
  });
}

async function commissionRows(opportunityId: string) {
  return query(
    `SELECT user_id, employee_name, opportunity_name, opportunity_value,
            commission_percentage, commission_amount
       FROM commissions
      WHERE org_id = $1 AND opportunity_id = $2`,
    [organizationId, opportunityId],
  );
}

before(async () => {
  if (!integrationEnabled) return;

  dbModule = await import("@workspace/db");
  migrationModule = await import("../lib/commissionSchema");
  commissionsModule = await import("./commissions");

  // Migration idempotence is part of this isolated regression suite. Running
  // it before fixtures also means the test works on a database without the
  // commission tables yet.
  await migrationModule.ensureCommissionSchema();
  await migrationModule.ensureCommissionSchema();

  organizationId = randomUUID();
  ownerId = randomUUID();
  teammateId = randomUUID();
  accountId = randomUUID();
  await query(
    `INSERT INTO organizations (id, name, slug)
     VALUES ($1, 'Synthetic Commission Regression', $2)`,
    [organizationId, `synthetic-commission-${organizationId}`],
  );
  await query(
    `INSERT INTO users (id, clerk_id, email, full_name)
     VALUES
       ($1, $2, $3, 'Synthetic Owner'),
       ($4, $5, $6, 'Synthetic Teammate')`,
    [
      ownerId,
      `synthetic-commission-owner:${ownerId}`,
      `${ownerId}@synthetic.invalid`,
      teammateId,
      `synthetic-commission-teammate:${teammateId}`,
      `${teammateId}@synthetic.invalid`,
    ],
  );
  await query(
    `INSERT INTO org_users (org_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'user')`,
    [organizationId, ownerId, teammateId],
  );
  // Resolve the generated member id used by the membership regression below.
  const teammateMembership = await query(
    `SELECT id FROM org_users WHERE org_id = $1 AND user_id = $2`,
    [organizationId, teammateId],
  );
  teammateMembershipId = teammateMembership.rows[0]!.id;
  await query(
    `INSERT INTO accounts (id, org_id, name, owner_user_id, created_by_user_id)
     VALUES ($1, $2, 'Synthetic Commission Account', $3, $3)`,
    [accountId, organizationId, ownerId],
  );
  await query(
    `INSERT INTO employee_commissions
       (org_id, user_id, commission_percentage, is_active)
     VALUES ($1, $2, '10.50', true)`,
    [organizationId, ownerId],
  );

});

after(async () => {
  if (!dbModule) return;
  try {
    if (organizationId) {
      // All fixture children use organization cascade. User deletion is
      // constrained to the two generated UUIDs and occurs after membership
      // cascade, so this cannot affect application data.
      await query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    }
    if (ownerId || teammateId) {
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
        [ownerId, teammateId].filter(Boolean),
      ]);
    }
  } finally {
    await dbModule.pool.end();
  }
});

test(
  "commission transactions: rollback, snapshots, exact cents, inactive rates, concurrency, and migration idempotence",
  { skip: !integrationEnabled },
  async () => {
    assert.ok(dbModule);
    assert.ok(commissionsModule);

    const indexes = await query(
      `SELECT indexname
         FROM pg_indexes
        WHERE tablename IN ('employee_commissions', 'commissions')
          AND indexname IN (
            'employee_commissions_org_user_uq',
            'commissions_org_opportunity_uq'
          )
        ORDER BY indexname`,
    );
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      "commissions_org_opportunity_uq",
      "employee_commissions_org_user_uq",
    ]);

    const rollbackId = await createOpportunity("Rollback Deal", null);
    await assert.rejects(
      closeOpportunity(rollbackId),
      /opportunity value must be a non-negative decimal/,
    );
    const rollbackOpportunity = await query(
      `SELECT stage, forecast_category
         FROM opportunities
        WHERE id = $1 AND org_id = $2`,
      [rollbackId, organizationId],
    );
    assert.deepEqual(rollbackOpportunity.rows, [{
      stage: "prospecting",
      forecast_category: "pipeline",
    }]);
    assert.equal((await commissionRows(rollbackId)).rowCount, 0);

    const frozenId = await createOpportunity("Frozen Rate Deal", "10000.00");
    await closeOpportunity(frozenId);
    await query(
      `UPDATE employee_commissions
          SET commission_percentage = '20.00'
        WHERE org_id = $1 AND user_id = $2`,
      [organizationId, ownerId],
    );
    const frozenRows = await commissionRows(frozenId);
    assert.deepEqual(frozenRows.rows, [{
      user_id: ownerId,
      employee_name: "Synthetic Owner",
      opportunity_name: "Frozen Rate Deal",
      opportunity_value: "10000.00",
      commission_percentage: "10.50",
      commission_amount: "1050.00",
    }]);

    // Reopen and close again after changing the rate. The unique ledger key
    // and first-transition check must preserve the original snapshot.
    await query(
      `UPDATE opportunities
          SET stage = 'prospecting', forecast_category = 'pipeline'
        WHERE id = $1`,
      [frozenId],
    );
    await closeOpportunity(frozenId);
    assert.equal((await commissionRows(frozenId)).rowCount, 1);

    const exactId = await createOpportunity("Exact Cents Deal", "1234.567");
    await closeOpportunity(exactId);
    const exactRows = await commissionRows(exactId);
    assert.deepEqual(exactRows.rows, [{
      user_id: ownerId,
      employee_name: "Synthetic Owner",
      opportunity_name: "Exact Cents Deal",
      opportunity_value: "1234.57",
      commission_percentage: "20.00",
      commission_amount: "246.91",
    }]);

    // PUT replacement deactivates an omitted member instead of leaving their
    // old rate payable. This calls the same transaction helper used by the
    // owner route, avoiding an app/server dependency in this DB suite.
    await dbModule.db.transaction(async (tx) => {
      await commissionsModule!.replaceCommissionSettings(tx, organizationId, [
        { userId: ownerId, commissionPercentage: "11.00", isActive: true },
        { userId: teammateId, commissionPercentage: "22.00", isActive: true },
      ]);
      await commissionsModule!.replaceCommissionSettings(tx, organizationId, [
        { userId: ownerId, commissionPercentage: "12.00", isActive: true },
      ]);
    });
    const omittedSetting = await query(
      `SELECT is_active FROM employee_commissions
        WHERE org_id = $1 AND user_id = $2`,
      [organizationId, teammateId],
    );
    assert.deepEqual(omittedSetting.rows, [{ is_active: false }]);

    // Removing and re-adding membership must delete the old setting rather
    // than revive it through the employee_commissions FK.
    await dbModule.db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(dbModule!.orgUsers)
        .where(eq(dbModule!.orgUsers.id, teammateMembershipId))
        .for("update");
      assert.ok(membership);
      await commissionsModule!.removeEmployeeCommissionForMembership(
        tx,
        organizationId,
        membership.userId,
      );
      await tx
        .delete(dbModule!.orgUsers)
        .where(eq(dbModule!.orgUsers.id, teammateMembershipId));
    });
    assert.equal(
      (
        await query(
          `SELECT count(*)::int AS count FROM employee_commissions
            WHERE org_id = $1 AND user_id = $2`,
          [organizationId, teammateId],
        )
      ).rows[0]!.count,
      0,
    );
    await query(
      `INSERT INTO org_users (org_id, user_id, role)
       VALUES ($1, $2, 'user')`,
      [organizationId, teammateId],
    );
    assert.equal(
      (
        await query(
          `SELECT count(*)::int AS count FROM employee_commissions
            WHERE org_id = $1 AND user_id = $2`,
          [organizationId, teammateId],
        )
      ).rows[0]!.count,
      0,
    );

    // A missing setting and a deactivated setting both close the deal but do
    // not create a ledger row.
    await query(
      `DELETE FROM employee_commissions
        WHERE org_id = $1 AND user_id = $2`,
      [organizationId, ownerId],
    );
    const noRateId = await createOpportunity("No Rate Deal", "100.00");
    await closeOpportunity(noRateId);
    assert.equal((await commissionRows(noRateId)).rowCount, 0);

    await query(
      `INSERT INTO employee_commissions
         (org_id, user_id, commission_percentage, is_active)
       VALUES ($1, $2, '10.50', false)`,
      [organizationId, ownerId],
    );
    const inactiveId = await createOpportunity("Inactive Rate Deal", "100.00");
    await closeOpportunity(inactiveId);
    assert.equal((await commissionRows(inactiveId)).rowCount, 0);

    // Restore the setting for the concurrent close fixture.
    await query(
      `UPDATE employee_commissions
          SET commission_percentage = '10.50', is_active = true
        WHERE org_id = $1 AND user_id = $2`,
      [organizationId, ownerId],
    );
    const concurrentId = await createOpportunity("Concurrent Close Deal", "200.00");
    let firstLocked!: () => void;
    const firstLockedPromise = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });
    let releaseFirst!: () => void;
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted!: () => void;
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });

    const first = dbModule.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(dbModule!.opportunities)
        .where(eq(dbModule!.opportunities.id, concurrentId))
        .for("update");
      assert.ok(before);
      firstLocked();
      await releaseFirstPromise;
      const [next] = await tx
        .update(dbModule!.opportunities)
        .set({ stage: "closed_won", forecastCategory: "closed_won" })
        .where(eq(dbModule!.opportunities.id, concurrentId))
        .returning();
      await commissionsModule!.recordCommissionForClosedWon(tx, before, next!);
    });
    await firstLockedPromise;

    const second = dbModule.db.transaction(async (tx) => {
      secondStarted();
      const [before] = await tx
        .select()
        .from(dbModule!.opportunities)
        .where(eq(dbModule!.opportunities.id, concurrentId))
        .for("update");
      assert.ok(before);
      const [next] = await tx
        .update(dbModule!.opportunities)
        .set({ stage: "closed_won", forecastCategory: "closed_won" })
        .where(eq(dbModule!.opportunities.id, concurrentId))
        .returning();
      await commissionsModule!.recordCommissionForClosedWon(tx, before, next!);
    });
    await secondStartedPromise;
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal((await commissionRows(concurrentId)).rowCount, 1);
  },
);
