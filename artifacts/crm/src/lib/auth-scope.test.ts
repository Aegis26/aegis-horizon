import assert from "node:assert/strict";
import test from "node:test";

import {
  belongsToAuthenticatedUser,
  hasAuthenticatedOrganizationMembership,
} from "./auth-scope";

test("does not treat another Clerk identity's cached /auth/me as current", () => {
  assert.equal(
    belongsToAuthenticatedUser({ clerkId: "clerk-owner" }, "clerk-employee"),
    false,
  );
  assert.equal(
    belongsToAuthenticatedUser({ clerkId: "clerk-employee" }, "clerk-employee"),
    true,
  );
  assert.equal(belongsToAuthenticatedUser(undefined, "clerk-employee"), false);
});

test("rejects a persisted organization that is absent from memberships", () => {
  const memberships = [{ org: { id: "org-employee" } }];
  assert.equal(
    hasAuthenticatedOrganizationMembership(memberships, "org-owner"),
    false,
  );
  assert.equal(
    hasAuthenticatedOrganizationMembership(memberships, "org-employee"),
    true,
  );
});