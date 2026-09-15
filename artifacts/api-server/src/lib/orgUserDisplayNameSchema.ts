import { withStartupMigrationLock } from "./startupMigration";

/**
 * Railway starts the API without running drizzle-kit. Keep this migration
 * narrow and idempotent so existing org_users rows remain valid while the
 * workspace-scoped member name override is introduced.
 */
export async function ensureOrgUserDisplayNameSchema(): Promise<void> {
  await withStartupMigrationLock("workspace:org-user-display-name-schema", async (client) => {
    await client.query(`
      ALTER TABLE org_users
        ADD COLUMN IF NOT EXISTS display_name text
    `);
  });
}