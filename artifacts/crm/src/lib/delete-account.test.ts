import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_ACCOUNT_CONFIRMATION,
  getDeleteAccountErrorMessage,
  isDeleteAccountConfirmation,
} from "./delete-account";

test("account deletion requires the exact uppercase confirmation", () => {
  assert.equal(isDeleteAccountConfirmation(DELETE_ACCOUNT_CONFIRMATION.confirmation), true);
  assert.equal(isDeleteAccountConfirmation("delete"), false);
  assert.equal(isDeleteAccountConfirmation(" DELETE "), false);
  assert.equal(isDeleteAccountConfirmation("DELETE\n"), false);
});

test("server pending or cleanup errors remain explicit and retryable", () => {
  const pendingMessage =
    "HTTP 409 Conflict: Account deletion is pending; retry to resume cleanup.";

  assert.equal(getDeleteAccountErrorMessage(new Error(pendingMessage)), pendingMessage);
  assert.match(
    getDeleteAccountErrorMessage(new Error("")),
    /try again/i,
  );
  assert.match(getDeleteAccountErrorMessage({}), /try again/i);
});

test("unknown failures never replace the dialog with a false success", () => {
  assert.match(
    getDeleteAccountErrorMessage(new Error("network unavailable")),
    /network unavailable/,
  );
});