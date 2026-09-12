import assert from "node:assert/strict";
import test, { before } from "node:test";

let createWindowSessionToken: typeof import("./windowSessions").createWindowSessionToken;
let hashWindowSessionToken: typeof import("./windowSessions").hashWindowSessionToken;
let isWindowSessionToken: typeof import("./windowSessions").isWindowSessionToken;

before(async () => {
  // These are pure capability-format tests. No database connection is opened.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  ({ createWindowSessionToken, hashWindowSessionToken, isWindowSessionToken } =
    await import("./windowSessions"));
});

test("window session tokens are random opaque capabilities and only hashes persist", () => {
  const first = createWindowSessionToken();
  const second = createWindowSessionToken();
  assert.equal(isWindowSessionToken(first), true);
  assert.equal(isWindowSessionToken(second), true);
  assert.notEqual(first, second);
  assert.match(hashWindowSessionToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashWindowSessionToken(first), first);
});

test("Clerk JWTs and malformed browser values cannot be window sessions", () => {
  assert.equal(isWindowSessionToken("eyJhbGciOiJIUzI1NiJ9.payload.signature"), false);
  assert.equal(isWindowSessionToken("aws_short"), false);
  assert.equal(isWindowSessionToken(undefined), false);
});