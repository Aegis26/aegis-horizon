import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { websiteDomain, inboundLeadInput } from "../services/inboundLeads";

test("Radar validates URLs and non-coercing field types", () => {
  assert.equal(websiteDomain("https://www.Example.com/path"), "example.com");
  assert.equal(websiteDomain("example.com"), "example.com");
  const body = {
    external_id: "unit", lead_type: "cyber", company_name: "Example",
    source: "test", signal_summary: "An example signal.", score: 8,
    detected_at: "2026-11-16T14:00:00Z",
  };
  assert.ok(inboundLeadInput.safeParse(body).success);
  for (const patch of [{ score: "8" }, { score: 11 }, { company_name: " " },
    { org_id: randomUUID() }, { website: "javascript:alert(1)" },
    { source_url: "https://user:password@example.com" }, { detected_at: "yesterday" },
    { employee_estimate: 2.5 }, { contact_email: "not-email" }]) {
    assert.equal(inboundLeadInput.safeParse({ ...body, ...patch }).success, false);
  }
});

test("90-day retention removes only expired log entries", {
  skip: process.env.RUN_INBOUND_INTEGRATION !== "1",
}, async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Development DB only");
  const { pool } = await import("@workspace/db");
  const { cleanupInboundLeadLogs } = await import("../services/inboundLeadRetention");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A temp table shadows the real log table on this connection. No existing
    // logs or customer records are touched. now() is stable in the transaction.
    await client.query(`
      CREATE TEMP TABLE inbound_lead_log (
        id text PRIMARY KEY, timestamp timestamptz NOT NULL
      ) ON COMMIT DROP;
      INSERT INTO inbound_lead_log (id, timestamp) VALUES
        ('expired', now() - interval '90 days 1 second'),
        ('boundary', now() - interval '90 days'),
        ('recent', now() - interval '89 days'),
        ('new', now());
    `);
    assert.equal(await cleanupInboundLeadLogs(client), 1);
    const remaining = await client.query("SELECT id FROM inbound_lead_log ORDER BY id");
    assert.deepEqual(remaining.rows.map((r) => r.id), ["boundary", "new", "recent"]);
    assert.equal(await cleanupInboundLeadLogs(client), 0);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("Radar intake creates, matches, updates and protects tenant boundaries", {
  skip: process.env.RUN_INBOUND_INTEGRATION !== "1",
}, async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Development DB only");
  const { pool } = await import("@workspace/db");
  const { ensureInboundLeadSchema } = await import("../lib/inboundLeadSchema");
  const { ensureOrganizationDeletionLedgerSchema } = await import("../lib/organizationDeletionSchema");
  await ensureOrganizationDeletionLedgerSchema();
  await ensureInboundLeadSchema();
  await ensureInboundLeadSchema(); // Safe on subsequent replica/startup runs.
  const orgId = randomUUID(), otherOrg = randomUUID();
  const key = randomBytes(32).toString("hex");
  const originalKey = process.env.INBOUND_LEADS_API_KEY;
  const originalOrg = process.env.INBOUND_LEADS_ORG_ID;
  process.env.INBOUND_LEADS_API_KEY = key;
  process.env.INBOUND_LEADS_ORG_ID = orgId;
  const express = (await import("express")).default;
  const { default: router } = await import("./inboundLeads");
  const app = express();
  app.use("/api/v1/inbound", router);
  const server = createServer(app);
  try {
    for (const id of [orgId, otherOrg]) {
      await pool.query("INSERT INTO organizations (id, name, slug, plan) VALUES ($1, 'Synthetic Radar test', $2, 'professional')", [id, `radar-${id}`]);
    }
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/inbound`;
    const body = {
      external_id: `radar-${randomUUID()}`, lead_type: "both", company_name: "Synthetic Radar Company",
      website: "https://www.synthetic-radar.invalid/path", city: "Austin", state: "TX",
      contact_name: "Test Contact", contact_email: "radar@synthetic.invalid",
      source: "synthetic_test", source_url: "https://synthetic.invalid/signal",
      signal_summary: "Synthetic signal.", talking_points: ["Ask about security"],
      suggested_offer: "Assessment", score: 8, detected_at: "2026-11-16T14:00:00Z",
    };
    const post = (payload: unknown = body, apiKey: string | null = key, contentType = "application/json") =>
      fetch(`${base}/leads`, { method: "POST", headers: {
        ...(apiKey === null ? {} : { "X-API-Key": apiKey }), "Content-Type": contentType,
      }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
    const otherAccount = randomUUID();
    await pool.query("INSERT INTO accounts (id,org_id,name,website) VALUES ($1,$2,$3,$4)",
      [otherAccount, otherOrg, body.company_name, body.website]);
    assert.equal((await post(body, null)).status, 401);
    assert.equal((await post(body, "wrong")).status, 401);
    assert.equal((await post("{")).status, 400);
    assert.equal((await post(body, key, "text/plain")).status, 400);
    assert.equal((await post({ ...body, orgId: otherOrg })).status, 400);
    assert.equal((await post({ ...body, score: 12 })).status, 400);
    let response = await post();
    assert.equal(response.status, 201);
    const created = await response.json() as { lead_id: string; status: string };
    assert.deepEqual(Object.keys(created).sort(), ["lead_id", "status"]);
    assert.equal(created.status, "created");
    let row = (await pool.query("SELECT * FROM leads WHERE id=$1", [created.lead_id])).rows[0];
    assert.equal(row.org_id, orgId);
    assert.equal(row.assigned_to_user_id, null);
    assert.equal(row.created_by_user_id, null);
    assert.equal(row.status, "queued");
    assert.equal(row.source, "Lead Radar");
    assert.equal(row.metadata.leadRadar.account_id, undefined);
    assert.equal(row.metadata.leadQueue.existingAccountName, null);
    assert.ok(row.metadata.leadRadar.note.includes("Created by Lead Radar from synthetic_test"));
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1", [orgId])).rows[0].count), 0);
    assert.equal(Number((await pool.query("SELECT count(*) FROM contacts WHERE org_id=$1", [orgId])).rows[0].count), 0);
    response = await post({ ...body, company_name: "Do not rename", score: 10, signal_summary: "Updated signal.", talking_points: ["Updated point"] });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {status: "updated", lead_id: created.lead_id});
    row = (await pool.query("SELECT * FROM leads WHERE id=$1", [created.lead_id])).rows[0];
    assert.equal(row.company, body.company_name);
    assert.equal(row.score, 10);
    assert.equal(row.metadata.leadRadar.signal_summary, "Updated signal.");
    assert.deepEqual(row.metadata.leadRadar.talking_points, ["Updated point"]);
    // Only same-org domain matches are flagged, without entity creation.
    const accountId = randomUUID();
    await pool.query("INSERT INTO accounts (id,org_id,name,website) VALUES ($1,$2,$3,$4)",
      [accountId, orgId, "Current Client", body.website]);
    response = await post({ ...body, external_id: randomUUID(), company_name: "Another spelling", website: "https://synthetic-radar.invalid" });
    assert.equal(response.status, 201);
    const secondId = (await response.json() as { lead_id: string }).lead_id;
    row = (await pool.query("SELECT metadata FROM leads WHERE id=$1", [secondId])).rows[0];
    assert.equal(row.metadata.leadRadar.account_id, undefined);
    assert.equal(row.metadata.leadRadar.contact_id, undefined);
    assert.equal(row.metadata.leadQueue.existingAccountName, "Current Client");
    // Exact-name fallback when no website/contact is provided.
    assert.equal((await post({ ...body, external_id: randomUUID(), website: undefined, contact_name: undefined, contact_email: undefined })).status, 201);
    assert.equal(Number((await pool.query("SELECT count(*) FROM accounts WHERE org_id=$1", [orgId])).rows[0].count), 1);
    const duplicate = { ...body, external_id: randomUUID() };
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => post(duplicate)));
    assert.equal(concurrent.filter((r) => r.status === 201).length, 1);
    assert.equal(concurrent.filter((r) => r.status === 200).length, 4);
    await pool.query("UPDATE inbound_lead_rate SET count=119 WHERE org_id=$1", [orgId]);
    assert.equal((await fetch(`${base}/health`, { headers: { "X-API-Key": key } })).status, 200);
    response = await post();
    assert.equal(response.status, 429);
    assert.ok(response.headers.get("Retry-After"));
    await pool.query("UPDATE inbound_lead_rate SET window_start=now()-interval '61 seconds' WHERE org_id=$1", [orgId]);
    assert.equal((await fetch(`${base}/health`, { headers: { "X-API-Key": key } })).status, 200);
    const logs = (await pool.query("SELECT * FROM inbound_lead_log WHERE org_id=$1", [orgId])).rows;
    for (const result of ["created", "updated", "invalid_body", "healthy", "rate_limited"]) {
      assert.ok(logs.some((l) => l.result === result), `missing log result ${result}`);
    }
    assert.ok(!JSON.stringify(logs).includes(key));
    assert.ok(!JSON.stringify(logs).includes(body.contact_email));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await pool.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [[orgId, otherOrg]]);
    if (originalKey === undefined) delete process.env.INBOUND_LEADS_API_KEY; else process.env.INBOUND_LEADS_API_KEY = originalKey;
    if (originalOrg === undefined) delete process.env.INBOUND_LEADS_ORG_ID; else process.env.INBOUND_LEADS_ORG_ID = originalOrg;
  }
});
