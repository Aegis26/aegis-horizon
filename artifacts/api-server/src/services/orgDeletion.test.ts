import assert from "node:assert/strict";
import test from "node:test";
import { runDeletionStages } from "./orgDeletionStages";

test("deletion stages resume after Stripe without cancelling again", async () => {
  const events: string[] = [];
  let advanced: string | undefined;

  const phase = await runDeletionStages({
    phase: "storage",
    subscriptionId: "sub_synthetic",
    cancelSubscription: async () => {
      events.push("stripe");
    },
    listObjectPaths: async () => {
      events.push("list");
      return ["/objects/uploads/a", "/objects/exports/b"];
    },
    deleteObject: async (path) => {
      events.push(`delete:${path}`);
    },
    advance: async (next) => {
      advanced = next;
      events.push(`advance:${next}`);
    },
  });

  assert.equal(phase, "relational");
  assert.deepEqual(events, [
    "list",
    "delete:/objects/uploads/a",
    "delete:/objects/exports/b",
    "advance:relational",
  ]);
  assert.equal(advanced, "relational");
});

test("a failed Stripe cancellation does not begin object or relational work", async () => {
  const events: string[] = [];

  await assert.rejects(
    runDeletionStages({
      phase: "stripe",
      subscriptionId: "sub_synthetic",
      cancelSubscription: async () => {
        events.push("stripe");
        throw new Error("synthetic Stripe outage");
      },
      listObjectPaths: async () => {
        events.push("list");
        return [];
      },
      deleteObject: async () => {
        events.push("delete");
      },
      advance: async () => {
        events.push("advance");
      },
    }),
  );

  assert.deepEqual(events, ["stripe"]);
});

test("a failed object deletion stops before relational completion", async () => {
  const events: string[] = [];

  await assert.rejects(
    runDeletionStages({
      phase: "storage",
      subscriptionId: null,
      cancelSubscription: null,
      listObjectPaths: async () => ["/objects/uploads/a", "/objects/uploads/b"],
      deleteObject: async (path) => {
        events.push(path);
        if (path.endsWith("/b")) throw new Error("synthetic storage outage");
      },
      advance: async () => {
        events.push("advance");
      },
    }),
  );

  assert.deepEqual(events, ["/objects/uploads/a", "/objects/uploads/b"]);
});