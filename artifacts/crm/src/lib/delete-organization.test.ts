import assert from "node:assert/strict";
import test from "node:test";

import {
  DELETE_ORGANIZATION_CONFIRMATION,
  isDeleteOrganizationConfirmation,
} from "./delete-organization";

test("requires the exact uppercase DELETE confirmation", () => {
  assert.deepEqual(DELETE_ORGANIZATION_CONFIRMATION, { confirmation: "DELETE" });
  assert.equal(isDeleteOrganizationConfirmation("DELETE"), true);
  assert.equal(isDeleteOrganizationConfirmation("delete"), false);
  assert.equal(isDeleteOrganizationConfirmation(" DELETE "), false);
});