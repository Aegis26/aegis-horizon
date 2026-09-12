import { withStartupMigrationLock } from "./startupMigration";

/**
 * Railway starts the API without running drizzle-kit.  This is intentionally
 * a narrowly scoped, idempotent migration for the independent deletion
 * ledger only; it never pushes or reconciles the rest of the application
 * schema at startup.
 */
export async function ensureOrganizationDeletionLedgerSchema(): Promise<void> {
  await withStartupMigrationLock("workspace:organization-deletion-schema", async (client) => {
   await client.query(`
    CREATE TABLE IF NOT EXISTS organization_deletion_ledger (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      requested_by_user_id uuid,
      requested_by_user_hash text,
      lease_owner_user_id uuid,
      status text NOT NULL DEFAULT 'pending',
      phase text NOT NULL DEFAULT 'stripe',
      attempts integer NOT NULL DEFAULT 0,
      lease_token text,
      lease_until timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    )
   `);
   await client.query(`
    ALTER TABLE organization_deletion_ledger
      ADD COLUMN IF NOT EXISTS lease_token text
   `);
   await client.query(`
    ALTER TABLE organization_deletion_ledger
      ADD COLUMN IF NOT EXISTS lease_owner_user_id uuid
   `);
   await client.query(`
    ALTER TABLE organization_deletion_ledger
      ADD COLUMN IF NOT EXISTS requested_by_user_hash text
   `);
   await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_deletion_ledger_org_uq
      ON organization_deletion_ledger (organization_id)
   `);
   await client.query(`
    UPDATE organization_deletion_ledger
       SET requested_by_user_id = NULL,
           lease_owner_user_id = NULL
     WHERE status = 'completed'
   `);
   await client.query(`
    CREATE TABLE IF NOT EXISTS organization_object_bindings (
      id uuid PRIMARY KEY,
      object_path text NOT NULL,
      organization_id uuid NOT NULL,
      owner_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
   await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_object_bindings_path_uq
      ON organization_object_bindings (object_path)
  `);
   await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS organization_object_bindings_org_path_uq
      ON organization_object_bindings (organization_id, object_path)
   `);
  });
}