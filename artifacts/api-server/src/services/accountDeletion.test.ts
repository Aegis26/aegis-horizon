import assert from "node:assert/strict";
import test, { before } from "node:test";
import { DeleteUserAccountResponse } from "@workspace/api-zod";
import { parseExactAccountDeletionBody } from "../routes/accountDeletionContract";
let isClerkNotFound: typeof import("./accountDeletion").isClerkNotFound;

before(async () => {
  // Bundled Node tests do not include Pino's development transport workers.
  // Select the worker-free logger before loading the service; no live API
  // operations are invoked by these pure error-classification tests.
  process.env.NODE_ENV = "production";
  ({ isClerkNotFound } = await import("./accountDeletion"));
});

test("account deletion contract requires exactly DELETE", () => {
  assert.equal(
    parseExactAccountDeletionBody({ confirmation: "DELETE" }) !== null,
    true,
  );
  assert.equal(
    parseExactAccountDeletionBody({ confirmation: "delete" }),
    null,
  );
  assert.equal(
    parseExactAccountDeletionBody({ confirmation: "DELETE", userId: "other" }),
    null,
  );
  assert.deepEqual(
    DeleteUserAccountResponse.parse({ success: true }),
    { success: true },
  );
});

test("already-absent Clerk users are safe to resume", () => {
  assert.equal(isClerkNotFound({ status: 404 }), true);
  assert.equal(isClerkNotFound({ statusCode: 404 }), true);
  assert.equal(
    isClerkNotFound({ errors: [{ code: "resource_not_found" }] }),
    true,
  );
  assert.equal(isClerkNotFound({ status: 500 }), false);
});