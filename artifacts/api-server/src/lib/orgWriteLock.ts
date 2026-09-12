import type { PoolClient } from "pg";
import pg from "pg";

const { Pool } = pg;
const LOCK_TIMEOUT_MS = 15_000;

// Keep advisory-lock sessions off the application query pool. A request holds
// one lock session until its response completes while its handlers still need
// ordinary DB connections; sharing the pools would deadlock at pool capacity.
const lockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 16,
  idleTimeoutMillis: 30_000,
});

export type OrganizationLock = {
  orgId: string;
  exclusive: boolean;
  release: () => Promise<void>;
};

async function connectWithTimeout(): Promise<PoolClient> {
  return new Promise<PoolClient>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("Organization lock pool is exhausted"));
    }, LOCK_TIMEOUT_MS);
    void lockPool.connect().then(
      (client) => {
        if (settled) {
          client.release();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(client);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function acquire(
  orgId: string,
  exclusive: boolean,
): Promise<OrganizationLock> {
  const client = await connectWithTimeout();
  let acquired = false;
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.query(
      `SELECT pg_advisory_lock${exclusive ? "" : "_shared"}(hashtextextended($1, 0))`,
      [orgId],
    );
    acquired = true;
  } catch (error) {
    client.release();
    throw error;
  }

  let released = false;
  return {
    orgId,
    exclusive,
    release: async () => {
      if (released) return;
      released = true;
      let destroy = false;
      try {
        if (acquired) {
          await client.query(
            `SELECT pg_advisory_unlock${exclusive ? "" : "_shared"}(hashtextextended($1, 0))`,
            [orgId],
          );
          await client.query("RESET lock_timeout");
        }
      } catch (error) {
        destroy = true;
        throw error;
      } finally {
        client.release(destroy);
      }
    },
  };
}

export function acquireOrganizationSharedLock(
  orgId: string,
): Promise<OrganizationLock> {
  return acquire(orgId, false);
}

export function acquireOrganizationExclusiveLock(
  orgId: string,
): Promise<OrganizationLock> {
  return acquire(orgId, true);
}

export async function withOrganizationSharedLock<T>(
  orgId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireOrganizationSharedLock(orgId);
  try {
    return await operation();
  } finally {
    try {
      await lock.release();
    } catch {
      // A failed unlock destroys the dedicated session, which releases the
      // PostgreSQL advisory lock without masking the operation's result.
    }
  }
}