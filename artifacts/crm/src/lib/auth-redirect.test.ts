import assert from "node:assert/strict";
import test from "node:test";

import {
  getSafeAuthRedirectUrl,
  isInvitationAuthRedirect,
} from "./auth-redirect";

const ORIGIN = "https://crm.example.test";

test("keeps invite return context on the same origin", () => {
  assert.equal(
    getSafeAuthRedirectUrl("/invite", "/dashboard", ORIGIN),
    "/invite",
  );
  assert.equal(
    getSafeAuthRedirectUrl(
      "https://crm.example.test/invite?step=verify",
      "/dashboard",
      ORIGIN,
    ),
    "/invite?step=verify",
  );
  assert.equal(isInvitationAuthRedirect("/invite", ""), true);
  assert.equal(isInvitationAuthRedirect("/invite?step=verify", ""), true);
  assert.equal(isInvitationAuthRedirect("/tenant/invite", "/tenant"), true);
});

test("rejects protocol-relative and slash-backslash host redirects", () => {
  for (const requested of [
    "//evil.example.test/invite",
    "/\\evil.example.test/invite",
    "\\\\evil.example.test/invite",
    "https://evil.example.test/invite",
  ]) {
    assert.equal(
      getSafeAuthRedirectUrl(requested, "/dashboard", ORIGIN),
      "/dashboard",
      requested,
    );
  }
});

test("does not turn an invalid redirect into a token-bearing auth URL", () => {
  const redirect = getSafeAuthRedirectUrl(
    "/\\evil.example.test/?token=secret",
    "/invite",
    ORIGIN,
  );
  assert.equal(redirect, "/invite");
  assert.equal(redirect.includes("token="), false);
});