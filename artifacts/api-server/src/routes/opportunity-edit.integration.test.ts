import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";

// Opt-in synthetic integration against the local development database only.
const enabled = process.env.NODE_ENV === "test" &&
  process.env.OPPORTUNITY_EDIT_INTEGRATION === "1";
type DbModule = typeof import("@workspace/db");
let database: DbModule | undefined;
let server: Server | undefined;
let baseUrl = "";
let token = "";
let orgId = "";
let userId = "";
let accountId = "";
let opportunityId = "";

before(async () => {
  if (!enabled) return;
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "helium", "Only the local development database is allowed");
  assert.equal(url.pathname, "/heliumdb", "Only the local development database is allowed");
  database = await import("@workspace/db");
  orgId = randomUUID();
  userId = randomUUID();
  accountId = randomUUID();
  opportunityId = randomUUID();
  await database.pool.query(
    `INSERT INTO users (id, clerk_id, email, full_name)
     VALUES ($1, $2, $3, 'Synthetic opportunity editor')`,
    [userId, `synthetic-opportunity-edit:${userId}`, `${userId}@synthetic.invalid`],
  );
  await database.pool.query(
    `INSERT INTO organizations (id, name, slug, plan, enabled_features)
     VALUES ($1, 'Synthetic opportunity edit org', $2, 'professional', ARRAY['crm', 'sales'])`,
    [orgId, `synthetic-opportunity-edit-${orgId}`],
  );
  await database.pool.query(
    `INSERT INTO org_users (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [orgId, userId],
  );
  await database.pool.query(
    `INSERT INTO accounts (id, org_id, name, owner_user_id, created_by_user_id)
     VALUES ($1, $2, 'Synthetic edit account', $3, $3)`,
    [accountId, orgId, userId],
  );
  await database.pool.query(
    `INSERT INTO opportunities
       (id, org_id, account_id, name, stage, probability, forecast_category, owner_user_id, created_by_user_id)
     VALUES ($1, $2, $3, 'Original deal', 'prospecting', 10, 'pipeline', $4, $4)`,
    [opportunityId, orgId, accountId, userId],
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
  baseUrl = `http://127.0.0.1:${address.port}/api/orgs/${orgId}/opportunities/${opportunityId}`;
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close((error) => error ? reject(error) : resolve()));
  } finally {
    if (database) {
      try {
        if (orgId) await database.pool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
        if (userId) await database.pool.query("DELETE FROM users WHERE id = $1", [userId]);
      } finally {
        await database.pool.end();
      }
    }
  }
});

async function request(path: string, method = "GET", body?: object) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "x-aegis-window-session": token, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() as Record<string, unknown> };
}

test("PATCH persists edited fields, clear/null semantics and won-close safety", { skip: !enabled }, async () => {
  const initial = await request("");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.value, null);

  const missing = await request("/convert-to-customer", "POST");
  assert.equal(missing.status, 400);
  assert.match(String(missing.data.error), /value.*required/i);
  const afterMissing = await request("");
  assert.equal(afterMissing.data.stage, "prospecting");
  assert.equal(afterMissing.data.forecastCategory, "pipeline");
  const missingStage = await request("", "PATCH", { stage: "closed_won" });
  assert.equal(missingStage.status, 400);
  assert.equal((await request("")).data.stage, "prospecting");

  const edited = await request("", "PATCH", {
    name: "  Revised deal  ", value: "125.50", expectedCloseDate: "2026-12-01",
    probability: 70, nextAction: "Call customer",
  });
  assert.equal(edited.status, 200);
  const fetched = await request("");
  assert.equal(fetched.status, 200);
  for (const response of [edited.data, fetched.data]) {
    assert.equal(response.name, "Revised deal");
    assert.equal(response.value, "125.50");
    assert.equal(response.expectedCloseDate, "2026-12-01");
    assert.equal(response.probability, 70);
    assert.equal(response.nextAction, "Call customer");
  }

  const negative = await request("", "PATCH", { value: "-1" });
  assert.equal(negative.status, 400);
  assert.equal((await request("")).data.value, "125.50");

  const cleared = await request("", "PATCH", {
    value: null, expectedCloseDate: null, probability: null, nextAction: null,
  });
  assert.equal(cleared.status, 200);
  const afterClear = await request("");
  for (const field of ["value", "expectedCloseDate", "probability", "nextAction"]) {
    assert.equal(afterClear.data[field], null, field);
  }
  assert.equal((await request("/convert-to-customer", "POST")).status, 400);
  assert.equal((await request("")).data.stage, "prospecting");

  assert.equal((await request("", "PATCH", { value: "0" })).status, 200);
  const won = await request("/convert-to-customer", "POST");
  assert.equal(won.status, 200);
  assert.equal(won.data.forecastCategory, "closed_won");
  assert.equal(won.data.value, "0");
  assert.equal((await request("")).data.forecastCategory, "closed_won");
  const removeWonValue = await request("", "PATCH", { value: null });
  assert.equal(removeWonValue.status, 400);
  assert.equal((await request("")).data.value, "0");
});