import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";

// Opt-in synthetic integration against the local development database only.
const enabled = process.env.NODE_ENV === "test" &&
  process.env.OPPORTUNITY_DELETE_INTEGRATION === "1";
type DbModule = typeof import("@workspace/db");
let database: DbModule | undefined;
let server: Server | undefined;
let baseUrl = "";
let token = "";
const orgId = randomUUID();
const otherOrgId = randomUUID();
const userId = randomUUID();
const otherUserId = randomUUID();
const accountId = randomUUID();

before(async () => {
  if (!enabled) return;
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "helium", "Only the local development database is allowed");
  assert.equal(url.pathname, "/heliumdb", "Only the local development database is allowed");
  database = await import("@workspace/db");
  const { pool } = database;
  for (const id of [userId, otherUserId]) {
    await pool.query(
      "INSERT INTO users (id, clerk_id, email, full_name) VALUES ($1, $2, $3, 'Synthetic deal deletion user')",
      [id, `synthetic-opportunity-delete:${id}`, `${id}@synthetic.invalid`],
    );
  }
  for (const id of [orgId, otherOrgId]) {
    await pool.query(
      "INSERT INTO organizations (id, name, slug, plan, enabled_features) VALUES ($1, 'Synthetic deletion org', $2, 'professional', ARRAY['crm', 'sales'])",
      [id, `synthetic-opportunity-delete-${id}`],
    );
    await pool.query("INSERT INTO org_users (org_id, user_id, role) VALUES ($1, $2, 'owner')", [id, userId]);
  }
  await pool.query("INSERT INTO org_users (org_id, user_id, role) VALUES ($1, $2, 'user')", [orgId, otherUserId]);
  await pool.query(
    "INSERT INTO accounts (id, org_id, name, owner_user_id, created_by_user_id) VALUES ($1, $2, 'Retained customer', $3, $3)",
    [accountId, orgId, userId],
  );
  const sessions = await import("../services/windowSessions");
  const schema = await import("../lib/windowSessionSchema");
  await schema.ensureWindowSessionSchema();
  token = (await sessions.createWindowSession(userId)).token;
  const { default: app } = await import("../app");
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api/orgs`;
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close((error) => error ? reject(error) : resolve()));
  } finally {
    if (database) {
      try {
        for (const id of [orgId, otherOrgId]) {
          await database.pool.query("DELETE FROM organizations WHERE id = $1", [id]);
        }
        for (const id of [userId, otherUserId]) {
          await database.pool.query("DELETE FROM users WHERE id = $1", [id]);
        }
      } finally {
        await database.pool.end();
      }
    }
  }
});

async function deal(name: string, owner = userId) {
  const id = randomUUID();
  await database!.pool.query(
    `INSERT INTO opportunities (id, org_id, account_id, name, stage, forecast_category, owner_user_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, 'prospecting', 'pipeline', $5, $5)`,
    [id, orgId, accountId, name, owner],
  );
  await database!.pool.query(
    "INSERT INTO opportunity_stage_history (org_id, opportunity_id, to_stage, changed_by_user_id) VALUES ($1, $2, 'prospecting', $3)",
    [orgId, id, userId],
  );
  return id;
}

async function remove(id: string, org = orgId) {
  const response = await fetch(`${baseUrl}/${org}/opportunities/${id}`, {
    method: "DELETE", headers: { "x-aegis-window-session": token },
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : await response.json() as { error: string },
  };
}

test("duplicate deletion preserves its account and removes only deal/stage history", { skip: !enabled }, async () => {
  const original = await deal("Original");
  const duplicate = await deal("Duplicate");
  assert.equal((await remove(duplicate)).status, 204);
  assert.equal((await remove(duplicate)).status, 404);
  const { rows: remaining } = await database!.pool.query(
    "SELECT id FROM opportunities WHERE id = ANY($1::uuid[])", [[original, duplicate]],
  );
  assert.deepEqual(remaining.map((row) => row.id), [original]);
  assert.equal((await database!.pool.query("SELECT id FROM accounts WHERE id = $1", [accountId])).rowCount, 1);
  assert.equal((await database!.pool.query("SELECT id FROM opportunity_stage_history WHERE opportunity_id = $1", [duplicate])).rowCount, 0);
});

test("linked quotes of any status block deletion without losing quote documents", { skip: !enabled }, async () => {
  for (const status of ["draft", "sent", "accepted", "rejected", "expired"]) {
    const id = await deal(`Quoted ${status}`);
    const quoteId = randomUUID();
    await database!.pool.query(
      `INSERT INTO quotes (id, org_id, opportunity_id, account_id, quote_number, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quoteId, orgId, id, accountId, `SYN-${quoteId}`, status],
    );
    const response = await remove(id);
    assert.equal(response.status, 409);
    assert.match(response.data!.error, /linked quote/i);
    assert.equal((await database!.pool.query("SELECT id FROM quotes WHERE id = $1", [quoteId])).rowCount, 1);
    assert.equal((await database!.pool.query("SELECT id FROM opportunities WHERE id = $1", [id])).rowCount, 1);
  }
});

test("closed-won and reopened commission-backed deals stay protected", { skip: !enabled }, async () => {
  const won = await deal("Won");
  await database!.pool.query("UPDATE opportunities SET stage = 'Closed Won', forecast_category = 'pipeline' WHERE id = $1", [won]);
  assert.equal((await remove(won)).status, 409);
  const reopened = await deal("Reopened");
  await database!.pool.query(
    `INSERT INTO commissions (org_id, user_id, employee_name, opportunity_id, opportunity_name,
      opportunity_value, commission_percentage, commission_amount, earned_date)
     VALUES ($1, $2, 'Synthetic employee', $3, 'Reopened', 100, 10, 10, NOW())`,
    [orgId, userId, reopened],
  );
  const response = await remove(reopened);
  assert.equal(response.status, 409);
  assert.match(response.data!.error, /commission/i);
  assert.equal((await database!.pool.query("SELECT id FROM commissions WHERE opportunity_id = $1", [reopened])).rowCount, 1);
});

test("org, row and parent account scopes plus viewer read-only are enforced", { skip: !enabled }, async () => {
  const id = await deal("Scoped");
  assert.equal((await remove(id, otherOrgId)).status, 404);
  await database!.pool.query("UPDATE org_users SET role = 'user' WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  await database!.pool.query("UPDATE opportunities SET owner_user_id = $2, created_by_user_id = $2 WHERE id = $1", [id, otherUserId]);
  assert.equal((await remove(id)).status, 404);
  await database!.pool.query("UPDATE opportunities SET created_by_user_id = $2 WHERE id = $1", [id, userId]);
  assert.equal((await remove(id)).status, 204); // Creator access survives reassignment.
  const hiddenAccount = await deal("Hidden parent");
  await database!.pool.query("UPDATE accounts SET owner_user_id = $2, created_by_user_id = $2 WHERE id = $1", [accountId, otherUserId]);
  assert.equal((await remove(hiddenAccount)).status, 404);
  await database!.pool.query("UPDATE accounts SET owner_user_id = $2, created_by_user_id = $2 WHERE id = $1", [accountId, userId]);
  await database!.pool.query("UPDATE org_users SET role = 'viewer' WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  assert.equal((await remove(hiddenAccount)).status, 403);
  assert.equal((await database!.pool.query("SELECT id FROM opportunities WHERE id = $1", [hiddenAccount])).rowCount, 1);
});