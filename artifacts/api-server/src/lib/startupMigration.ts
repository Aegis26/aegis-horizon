import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

/**
 * Startup migrations run on every API replica. Keep each migration on one
 * checked-out client and serialize replicas with a transaction-scoped
 * advisory lock; otherwise separate pool.query calls can interleave DDL and
 * leave a partially upgraded catalog visible to another replica.
 */
export async function withStartupMigrationLock(
  lockName: string,
  migration: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [lockName],
    );
    await migration(client);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    throw error;
  }
  client.release();
}