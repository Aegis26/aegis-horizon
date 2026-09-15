import assert from "node:assert/strict";
import test from "node:test";
import { InviteMemberBody, UpdateMemberRoleBody } from "@workspace/api-zod";
import { effectiveMemberDisplayName } from "./memberDisplayName";

test("workspace override wins without changing the global profile name", () => {
  const user = { fullName: "Global Profile Name", email: "person@example.com" };
  assert.equal(
    effectiveMemberDisplayName({ displayName: "Workspace Name" }, user),
    "Workspace Name",
  );
  assert.equal(user.fullName, "Global Profile Name");
});

test("member labels fall back from a usable profile name to email", () => {
  assert.equal(
    effectiveMemberDisplayName({ displayName: null }, {
      fullName: "Profile Name",
      email: "person@example.com",
    }),
    "Profile Name",
  );
  assert.equal(
    effectiveMemberDisplayName({ displayName: null }, {
      fullName: "User",
      email: "person@example.com",
    }),
    "person@example.com",
  );
});

test("member update accepts name-only edits and explicit resets", () => {
  assert.deepEqual(
    UpdateMemberRoleBody.parse({ displayName: "Workspace Name" }),
    { displayName: "Workspace Name" },
  );
  assert.deepEqual(UpdateMemberRoleBody.parse({ displayName: null }), {
    displayName: null,
  });
  assert.throws(() => UpdateMemberRoleBody.parse({ displayName: "" }));
  assert.throws(() =>
    UpdateMemberRoleBody.parse({ displayName: "x".repeat(121) }),
  );
});

test("invite accepts workspace displayName and legacy fullName", () => {
  assert.deepEqual(
    InviteMemberBody.parse({
      email: "person@example.com",
      displayName: "Workspace Name",
      role: "user",
    }),
    {
      email: "person@example.com",
      displayName: "Workspace Name",
      role: "user",
    },
  );
  assert.deepEqual(
    InviteMemberBody.parse({
      email: "person@example.com",
      fullName: "Legacy Name",
      role: "user",
    }),
    {
      email: "person@example.com",
      fullName: "Legacy Name",
      role: "user",
    },
  );
});