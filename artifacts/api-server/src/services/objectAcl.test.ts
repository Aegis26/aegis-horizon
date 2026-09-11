import assert from "node:assert/strict";
import test from "node:test";
import type { File } from "@google-cloud/storage";
import { canAccessObject, ObjectPermission } from "../lib/objectAcl";

function objectWithPolicy(policy: object): File {
  return {
    getMetadata: async () => [
      { metadata: { "custom:aclPolicy": JSON.stringify(policy) } },
    ],
  } as unknown as File;
}

test("private object ACL denies a different user", async () => {
  const objectFile = objectWithPolicy({
    owner: "clerk-owner",
    visibility: "private",
    aclRules: [],
  });

  assert.equal(
    await canAccessObject({
      userId: "clerk-other",
      objectFile,
      requestedPermission: ObjectPermission.READ,
    }),
    false,
  );
  assert.equal(
    await canAccessObject({
      userId: "clerk-owner",
      objectFile,
      requestedPermission: ObjectPermission.READ,
    }),
    true,
  );
});

test("malformed private object ACL fails closed", async () => {
  const objectFile = {
    getMetadata: async () => [
      { metadata: { "custom:aclPolicy": "{not-json" } },
    ],
  } as unknown as File;

  assert.equal(
    await canAccessObject({
      userId: "clerk-owner",
      objectFile,
      requestedPermission: ObjectPermission.READ,
    }),
    false,
  );
});