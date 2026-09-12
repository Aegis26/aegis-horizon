import type { PoolClient } from "pg";
import pg from "pg";

const { Pool } = pg;
const LOCK_TIMEOUT_MS = 15_000;

// Keep advisory-lock sessions off the application query pool. A request holds
// one lock session until its response completes while its handlers still need
// ordinary DB connections; sharing the pools would deadlock at pool capacity.
const organizationLockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 16,
  idleTimeoutMillis: 30_000,
});
// User request locks and organization mutation locks can be held by the same
// request. Keep them on separate bounded pools so a full set of user locks
// cannot consume every connection needed to acquire/release org locks.
const userLockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 16,
  idleTimeoutMillis: 30_000,
});

export type OrganizationLock = {
  orgId: string;
  exclusive: boolean;
  release: () => Promise<void>;
};

export type UserLock = {
  userId: string;
  exclusive: boolean;
  release: () => Promise<void>;
};

async function connectWithTimeout(lockPool: pg.Pool): Promise<PoolClient> {
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
  const client = await connectWithTimeout(organizationLockPool);
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

async function acquireUser(
  userId: string,
  exclusive: boolean,
): Promise<UserLock> {
  const client = await connectWithTimeout(userLockPool);
  let acquired = false;
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.query(
      `SELECT pg_advisory_lock${exclusive ? "" : "_shared"}(hashtextextended($1, 1))`,
      [userId],
    );
    acquired = true;
  } catch (error) {
    client.release();
    throw error;
  }

  let released = false;
  return {
    userId,
    exclusive,
    release: async () => {
      if (released) return;
      released = true;
      let destroy = false;
      try {
        if (acquired) {
          await client.query(
            `SELECT pg_advisory_unlock${exclusive ? "" : "_shared"}(hashtextextended($1, 1))`,
            [userId],
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

/** User locks use a different advisory-lock namespace from organization locks. */
export function acquireUserSharedLock(userId: string): Promise<UserLock> {
  return acquireUser(userId, false);
}

export function acquireUserExclusiveLock(userId: string): Promise<UserLock> {
  return acquireUser(userId, true);
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