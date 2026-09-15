import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";

const integrationEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.ACCOUNT_FLOW_INTEGRATION === "1";

type DbModule = typeof import("@workspace/db");
type SessionModule = typeof import("../services/windowSessions");
type SchemaModule = typeof import("../lib/windowSessionSchema");

let dbModule: DbModule | undefined;
let sessions: SessionModule | undefined;
let schema: SchemaModule | undefined;
let app: (typeof import("../app"))["default"] | undefined;
let server: Server | undefined;
let baseUrl = "";
let userId = "";
let orgId = "";

before(async () => {
  if (!integrationEnabled) return;
  ({ default: app } = await import("../app"));
  dbModule = await import("@workspace/db");
  schema = await import("../lib/windowSessionSchema");
  sessions = await import("../services/windowSessions");
  await schema.ensureWindowSessionSchema();

  const { randomUUID } = await import("node:crypto");
  userId = randomUUID();
  orgId = randomUUID();
  await dbModule.pool.query(
    `INSERT INTO users (id, clerk_id, email, full_name)
     VALUES ($1, $2, $3, 'Synthetic account detail user')`,
    [userId, `synthetic-account-flow:${userId}`, `${userId}@synthetic.invalid`],
  );
  await dbModule.pool.query(
    `INSERT INTO organizations (id, name, slug, plan, enabled_features)
     VALUES ($1, 'Synthetic account detail org', $2, 'professional', ARRAY['crm'])`,
    [orgId, `synthetic-account-flow-${userId}`],
  );
  await dbModule.pool.query(
    `INSERT INTO org_users (org_id, user_id, role)
     VALUES ($1, $2, 'user')`,
    [orgId, userId],
  );

  assert.ok(app);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (dbModule && orgId) {
    await dbModule.pool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  }
  if (dbModule && userId) {
    await dbModule.pool.query("DELETE FROM users WHERE id = $1", [userId]);
    await dbModule.pool.end();
  }
});

test(
  "synthetic authenticated account create then detail retrieval",
  { skip: !integrationEnabled },
  async () => {
    assert.ok(dbModule);
    assert.ok(sessions);
    const session = await sessions.createWindowSession(userId);
    const headers = {
      "content-type": "application/json",
      "x-aegis-window-session": session.token,
    };

    const createResponse = await fetch(`${baseUrl}/api/orgs/${orgId}/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Synthetic detail account" }),
    });
    const createBody = await createResponse.json() as {
      id?: string;
      name?: string;
      [key: string]: unknown;
    };
    console.log("synthetic account create", createResponse.status, createBody);
    assert.equal(createResponse.status, 201);
    assert.equal(typeof createBody.id, "string");

    const dashboardBeforeDeleteResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/dashboard`,
      { headers: { "x-aegis-window-session": session.token } },
    );
    const dashboardBeforeDelete = await dashboardBeforeDeleteResponse.json() as {
      accountCount?: number;
      [key: string]: unknown;
    };
    assert.equal(dashboardBeforeDeleteResponse.status, 200);
    assert.equal(dashboardBeforeDelete.accountCount, 1);

    const listResponse = await fetch(`${baseUrl}/api/orgs/${orgId}/accounts`, {
      headers: { "x-aegis-window-session": session.token },
    });
    const listBody = await listResponse.json() as Array<{ id?: string }>;
    console.log("synthetic account list", listResponse.status, listBody);
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.some((account) => account.id === createBody.id), true);

    const detailResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/accounts/${createBody.id}`,
      { headers: { "x-aegis-window-session": session.token } },
    );
    const detailBody = await detailResponse.json() as {
      id?: string;
      name?: string;
      [key: string]: unknown;
    };
    console.log("synthetic account detail", detailResponse.status, detailBody);
    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.id, createBody.id);
    assert.equal(detailBody.name, "Synthetic detail account");

    const unauthenticatedDetailResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/accounts/${createBody.id}`,
    );
    const unauthenticatedDetailBody = await unauthenticatedDetailResponse.json();
    console.log(
      "synthetic account detail without window session",
      unauthenticatedDetailResponse.status,
      unauthenticatedDetailBody,
    );
    assert.equal(unauthenticatedDetailResponse.status, 401);

    const timelineResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/accounts/${createBody.id}/timeline`,
      { headers: { "x-aegis-window-session": session.token } },
    );
    const timelineBody = await timelineResponse.json();
    console.log("synthetic account timeline", timelineResponse.status, timelineBody);
    assert.equal(timelineResponse.status, 200);
    assert.deepEqual(timelineBody, []);

    const deleteResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/accounts/${createBody.id}`,
      {
        method: "DELETE",
        headers: { "x-aegis-window-session": session.token },
      },
    );
    assert.equal(deleteResponse.status, 204);

    const listAfterDeleteResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/accounts`,
      { headers: { "x-aegis-window-session": session.token } },
    );
    const listAfterDelete = await listAfterDeleteResponse.json() as Array<{ id?: string }>;
    assert.equal(listAfterDeleteResponse.status, 200);
    assert.equal(listAfterDelete.some((account) => account.id === createBody.id), false);

    const dashboardAfterDeleteResponse = await fetch(
      `${baseUrl}/api/orgs/${orgId}/dashboard`,
      { headers: { "x-aegis-window-session": session.token } },
    );
    const dashboardAfterDelete = await dashboardAfterDeleteResponse.json() as {
      accountCount?: number;
      [key: string]: unknown;
    };
    assert.equal(dashboardAfterDeleteResponse.status, 200);
    assert.equal(dashboardAfterDelete.accountCount, 0);
  },
);
