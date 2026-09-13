import assert from "node:assert/strict";
import test from "node:test";
import { hasRequiredOrganizationRole } from "./organizationAuthorization";

test("owner-only authorization accepts only the selected organization owner", () => {
  assert.equal(hasRequiredOrganizationRole("owner", "owner"), true);

  for (const role of ["admin", "manager", "user", "viewer", undefined]) {
    assert.equal(hasRequiredOrganizationRole(role, "owner"), false);
  }
});

test("non-owner organization permissions retain their rank behavior", () => {
  assert.equal(hasRequiredOrganizationRole("admin", "admin"), true);
  assert.equal(hasRequiredOrganizationRole("owner", "admin"), true);
  assert.equal(hasRequiredOrganizationRole("manager", "admin"), false);
});