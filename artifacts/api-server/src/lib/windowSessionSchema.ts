import { withStartupMigrationLock } from "./startupMigration";

/**
 * Narrow startup migration for app-owned browser sessions. It is deliberately
 * independent from Clerk and application data, so an existing pre-redesign
 * deployment upgrades safely before any auth route or deletion recovery runs.
 */
export async function ensureWindowSessionSchema(): Promise<void> {
  return withStartupMigrationLock(
    "workspace:window-session-schema",
    async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS window_sessions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          revoked_at timestamptz
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS window_sessions_user_active_idx
          ON window_sessions (user_id, revoked_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS window_sessions_expiry_idx
          ON window_sessions (expires_at)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS window_login_attempts (
          key_hash text PRIMARY KEY,
          failures integer NOT NULL DEFAULT 0,
          blocked_until timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    },
  );
}