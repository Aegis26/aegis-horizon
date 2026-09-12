import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

/**
 * Opt-in because it writes only UUID-tagged synthetic rows to the configured
 * test database, then removes them. It never calls Clerk.
 *
 * NODE_ENV=test WINDOW_SESSIONS_INTEGRATION=1 pnpm --filter @workspace/api-server test
 */
const integrationEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.WINDOW_SESSIONS_INTEGRATION === "1";

type DbModule = typeof import("@workspace/db");
type SessionModule = typeof import("./windowSessions");
type SchemaModule = typeof import("../lib/windowSessionSchema");
let dbModule: DbModule | undefined;
let sessions: SessionModule | undefined;
let schema: SchemaModule | undefined;
let userId = "";
let tokenA = "";
let tokenB = "";
let expiredToken = "";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

before(async () => {
  if (!integrationEnabled) return;
  dbModule = await import("@workspace/db");
  schema = await import("../lib/windowSessionSchema");
  await schema.ensureWindowSessionSchema();
  sessions = await import("./windowSessions");
  userId = randomUUID();
  tokenA = `aws_${"A".repeat(43)}`;
  tokenB = `aws_${"B".repeat(43)}`;
  expiredToken = `aws_${"C".repeat(43)}`;
  await dbModule.pool.query(
    `INSERT INTO users (id, clerk_id, email, full_name)
     VALUES ($1, $2, $3, 'Synthetic window session user')`,
    [userId, `synthetic-window:${userId}`, `${userId}@synthetic.invalid`],
  );
  await dbModule.pool.query(
    `INSERT INTO window_sessions (user_id, token_hash, expires_at)
     VALUES
       ($1, $2, now() + interval '1 hour'),
       ($1, $3, now() + interval '1 hour'),
       ($1, $4, now() - interval '1 second')`,
    [userId, hash(tokenA), hash(tokenB), hash(expiredToken)],
  );
});

after(async () => {
  if (!dbModule || !userId) return;
  try {
    await dbModule.pool.query("DELETE FROM users WHERE id = $1", [userId]);
  } finally {
    await dbModule.pool.end();
  }
});

test(
  "synthetic window sessions: A/B isolation, revocation, expiry, and unknown tokens fail closed",
  { skip: !integrationEnabled },
  async () => {
    assert.ok(sessions);
    assert.equal((await sessions.authenticateWindowSession(tokenA))?.id, userId);
    assert.equal((await sessions.authenticateWindowSession(tokenB))?.id, userId);
    assert.equal(await sessions.authenticateWindowSession(expiredToken), null);
    assert.equal(await sessions.authenticateWindowSession(`aws_${"D".repeat(43)}`), null);

    await sessions.revokeWindowSession(tokenA);
    assert.equal(await sessions.authenticateWindowSession(tokenA), null);
    assert.equal(
      (await sessions.authenticateWindowSession(tokenB))?.id,
      userId,
      "revoking window A must never revoke independent window B",
    );
  },
);