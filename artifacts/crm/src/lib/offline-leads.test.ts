import assert from "node:assert/strict";
import test from "node:test";

import type { Lead, LeadCreate } from "@workspace/api-client-react";
import {
  createLeadRequestOptions,
  shouldDiscardQueuedLeadUpdate,
  shouldPurgeQueuedLead,
  syncLeadQueue,
  syncLeadQueueForUser,
  type LeadQueueSyncDependencies,
  type LeadSyncAuth,
  type QueuedLead,
} from "./offline-leads";

function queuedLead(id: string, clerkUserId: string): QueuedLead {
  return {
    id,
    idempotencyKey: `key-${id}`,
    orgId: "shared-org",
    clerkUserId,
    data: {} as LeadCreate,
    createdAt: id,
  };
}

const noOpUpdate = async (_record: QueuedLead) => undefined;
const tokenFor = (clerkUserId: string) =>
  `header.${Buffer.from(JSON.stringify({ sub: clerkUserId })).toString("base64url")}.signature`;

test("binds offline lead requests to bearer identity and omits cookies", () => {
  const options = createLeadRequestOptions(queuedLead("a-1", "clerk-a"), "token-a");
  const headers = new Headers(options.headers);
  assert.equal(options.credentials, "omit");
  assert.equal(headers.get("Authorization"), "Bearer token-a");
  assert.equal(headers.get("Idempotency-Key"), "key-a-1");
});

test("stops an A queue when Clerk switches during its loop", async () => {
  let liveUserId: string | null = "clerk-a";
  const queue = [queuedLead("a-1", "clerk-a"), queuedLead("a-2", "clerk-a")];
  const sentTokens: string[] = [];
  const removedIds: string[] = [];
  const auth: LeadSyncAuth = {
    getToken: async () => tokenFor("clerk-a"),
    getCurrentUserId: () => liveUserId,
  };
  const dependencies: LeadQueueSyncDependencies = {
    list: async (clerkUserId) =>
      queue.filter((record) => record.clerkUserId === clerkUserId),
    create: async (record, token) => {
      sentTokens.push(`${record.id}:${token}`);
      // Simulate the user switching while the first request is in flight.
      liveUserId = "clerk-b";
      return {} as Lead;
    },
    remove: async (record) => {
      removedIds.push(record.id);
      queue.splice(queue.indexOf(record), 1);
    },
    update: noOpUpdate,
    notify: () => undefined,
  };

  await syncLeadQueueForUser("clerk-a", auth, dependencies);

  assert.deepEqual(sentTokens, [`a-1:${tokenFor("clerk-a")}`]);
  assert.deepEqual(removedIds, ["a-1"]);
  assert.deepEqual(queue.map((record) => record.id), ["a-2"]);
});

test("does not send a B token returned during an A sync", async () => {
  let createCalls = 0;
  const record = queuedLead("a-race", "clerk-a");
  const auth: LeadSyncAuth = {
    // Simulate Clerk rotating getToken before the React identity render lands.
    getToken: async () => tokenFor("clerk-b"),
    getCurrentUserId: () => "clerk-a",
  };
  const dependencies: LeadQueueSyncDependencies = {
    list: async () => [record],
    create: async () => {
      createCalls += 1;
      return {} as Lead;
    },
    remove: async () => undefined,
    update: noOpUpdate,
    notify: () => undefined,
  };

  await syncLeadQueueForUser("clerk-a", auth, dependencies);

  assert.equal(createCalls, 0);
});

test("keeps sync promises separate for simultaneous Clerk identities", async () => {
  const queues = new Map([
    ["clerk-a", [queuedLead("a-1", "clerk-a")]],
    ["clerk-b", [queuedLead("b-1", "clerk-b")]],
  ]);
  const sentTokens: string[] = [];
  const dependencies: LeadQueueSyncDependencies = {
    list: async (clerkUserId) => queues.get(clerkUserId) ?? [],
    create: async (_record, token) => {
      sentTokens.push(token);
      return {} as Lead;
    },
    remove: async (record) => {
      queues.set(
        record.clerkUserId!,
        (queues.get(record.clerkUserId!) ?? []).filter((item) => item.id !== record.id),
      );
    },
    update: noOpUpdate,
    notify: () => undefined,
  };
  const authFor = (clerkUserId: string, token: string): LeadSyncAuth => ({
    getToken: async () => token,
    getCurrentUserId: () => clerkUserId,
  });

  const aPromise = syncLeadQueue(
    "clerk-a",
    authFor("clerk-a", tokenFor("clerk-a")),
    dependencies,
  );
  const bPromise = syncLeadQueue(
    "clerk-b",
    authFor("clerk-b", tokenFor("clerk-b")),
    dependencies,
  );

  assert.notEqual(aPromise, bPromise);
  await Promise.all([aPromise, bPromise]);
  assert.deepEqual(
    sentTokens.sort(),
    [tokenFor("clerk-a"), tokenFor("clerk-b")].sort(),
  );
});

test("organization purge only selects the deleted org's drafts", () => {
  const records = [
    queuedLead("deleted-a", "clerk-a"),
    { ...queuedLead("other-org", "clerk-a"), orgId: "other-org" },
    { ...queuedLead("deleted-b", "clerk-b"), orgId: "shared-org" },
  ];

  const deleted = records
    .filter((record) => shouldPurgeQueuedLead(record, "shared-org"))
    .map((record) => record.id);
  const preserved = records
    .filter((record) => !shouldPurgeQueuedLead(record, "shared-org"))
    .map((record) => record.id);

  assert.deepEqual(deleted, ["deleted-a", "deleted-b"]);
  assert.deepEqual(preserved, ["other-org"]);
});

test("in-flight updates for a purged org are discarded", () => {
  const purgedOrgIds = new Set(["shared-org"]);

  assert.equal(
    shouldDiscardQueuedLeadUpdate(
      { orgId: "shared-org" },
      purgedOrgIds,
    ),
    true,
  );
  assert.equal(
    shouldDiscardQueuedLeadUpdate(
      { orgId: "other-org" },
      purgedOrgIds,
    ),
    false,
  );
});
