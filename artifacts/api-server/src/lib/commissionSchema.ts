import { withStartupMigrationLock } from "./startupMigration";

/**
 * Railway starts the API without running drizzle-kit.  Commission tables are
 * therefore created by this narrow, idempotent migration and kept in lockstep
 * with lib/db/src/schema/crm.ts.
 */
export async function ensureCommissionSchema(): Promise<void> {
  await withStartupMigrationLock("workspace:commission-schema", async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_commissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        commission_percentage numeric(5,2) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      ALTER TABLE employee_commissions
        ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS org_id uuid,
        ADD COLUMN IF NOT EXISTS user_id uuid,
        ADD COLUMN IF NOT EXISTS commission_percentage numeric(5,2),
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
    `);
    await client.query(`
      UPDATE employee_commissions
         SET id = gen_random_uuid()
       WHERE id IS NULL
    `);
    await client.query(`
      ALTER TABLE employee_commissions
        ALTER COLUMN id SET DEFAULT gen_random_uuid(),
        ALTER COLUMN id SET NOT NULL,
        ALTER COLUMN org_id SET NOT NULL,
        ALTER COLUMN user_id SET NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_commissions_org_user_uq
        ON employee_commissions (org_id, user_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_commissions_id_uq
        ON employee_commissions (id)
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'employee_commissions_rate_range_chk'
        ) THEN
          ALTER TABLE employee_commissions
            ADD CONSTRAINT employee_commissions_rate_range_chk
            CHECK (
              commission_percentage >= 0
              AND commission_percentage <= 100
              AND commission_percentage = round(commission_percentage, 2)
            );
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS commissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        employee_name text NOT NULL,
        opportunity_id uuid NOT NULL,
        opportunity_name text NOT NULL,
        opportunity_value numeric(20,2) NOT NULL,
        commission_percentage numeric(5,2) NOT NULL,
        commission_amount numeric(20,2) NOT NULL,
        earned_date timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      ALTER TABLE commissions
        ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS org_id uuid,
        ADD COLUMN IF NOT EXISTS user_id uuid,
        ADD COLUMN IF NOT EXISTS employee_name text DEFAULT 'Unknown employee',
        ADD COLUMN IF NOT EXISTS opportunity_id uuid,
        ADD COLUMN IF NOT EXISTS opportunity_name text DEFAULT 'Deleted opportunity',
        ADD COLUMN IF NOT EXISTS opportunity_value numeric(20,2),
        ADD COLUMN IF NOT EXISTS commission_percentage numeric(5,2),
        ADD COLUMN IF NOT EXISTS commission_amount numeric(20,2),
        ADD COLUMN IF NOT EXISTS earned_date timestamptz,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
    `);
    await client.query(`
      UPDATE commissions
         SET id = gen_random_uuid()
       WHERE id IS NULL
    `);
    await client.query(`
      UPDATE commissions c
         SET employee_name = COALESCE(
           NULLIF(BTRIM(u.full_name), ''),
           NULLIF(BTRIM(u.email), ''),
           c.employee_name,
           'Unknown employee'
         )
        FROM users u, org_users m
       WHERE c.employee_name IS NULL
         AND u.id::text = c.user_id::text
         AND m.user_id = u.id
         AND m.org_id = c.org_id
    `);
    await client.query(`
      UPDATE commissions c
         SET opportunity_name = COALESCE(
           NULLIF(BTRIM(o.name), ''),
           c.opportunity_name,
           'Deleted opportunity'
         )
        FROM opportunities o
       WHERE c.opportunity_name IS NULL
         AND o.org_id = c.org_id
         AND o.id::text = c.opportunity_id::text
    `);
    await client.query(`
      UPDATE commissions
         SET employee_name = 'Unknown employee'
       WHERE employee_name IS NULL;
      UPDATE commissions
         SET opportunity_name = 'Deleted opportunity'
       WHERE opportunity_name IS NULL;
    `);
    const missingIdentity = await client.query(`
      SELECT org_id, opportunity_id
        FROM commissions
       WHERE org_id IS NULL OR opportunity_id IS NULL
       LIMIT 1
    `);
    if (missingIdentity.rowCount) {
      throw new Error(
        "Commission schema migration refused: legacy commission rows are missing org_id or opportunity_id; resolve those rows before retrying.",
      );
    }
    await client.query(`
      ALTER TABLE commissions
        ALTER COLUMN id SET DEFAULT gen_random_uuid(),
        ALTER COLUMN id SET NOT NULL,
        ALTER COLUMN org_id SET NOT NULL,
        ALTER COLUMN user_id SET NOT NULL,
        ALTER COLUMN opportunity_id SET NOT NULL,
        ALTER COLUMN employee_name SET DEFAULT 'Unknown employee',
        ALTER COLUMN employee_name SET NOT NULL,
        ALTER COLUMN opportunity_name SET DEFAULT 'Deleted opportunity',
        ALTER COLUMN opportunity_name SET NOT NULL
    `);

    const duplicateLedgerRows = await client.query<{
      org_id: string;
      opportunity_id: string;
      count: string;
    }>(`
      SELECT org_id::text, opportunity_id::text, count(*)::text
        FROM commissions
       GROUP BY org_id, opportunity_id
      HAVING count(*) > 1
       LIMIT 1
    `);
    if (duplicateLedgerRows.rowCount) {
      const duplicate = duplicateLedgerRows.rows[0]!;
      throw new Error(
        `Commission schema migration refused: duplicate legacy commission rows for org ${duplicate.org_id} and opportunity ${duplicate.opportunity_id} (${duplicate.count} rows); consolidate them explicitly before retrying.`,
      );
    }
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS commissions_id_uq
        ON commissions (id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS commissions_org_opportunity_uq
        ON commissions (org_id, opportunity_id)
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'commissions_rate_range_chk'
        ) THEN
          ALTER TABLE commissions
            ADD CONSTRAINT commissions_rate_range_chk
            CHECK (
              commission_percentage >= 0
              AND commission_percentage <= 100
              AND commission_percentage = round(commission_percentage, 2)
            );
        END IF;
      END $$;
    `);
  });
}
