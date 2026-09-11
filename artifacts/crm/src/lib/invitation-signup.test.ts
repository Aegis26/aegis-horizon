import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvitationAcceptanceController,
  getTokenSubject,
  hasInvitedEmail,
  hasVerifiedInvitedEmail,
  invitationViewState,
  validateSignupFields,
} from "./invitation-signup";

const resolvedState = {
  resolution: "resolved" as const,
  authLoaded: true,
  userLoaded: true,
  isSignedIn: false,
  hasMatchingEmail: false,
  hasVerifiedEmail: false,
  signingOut: false,
  signoutFailed: false,
  phase: "form" as const,
};

test("only a verified invited address can auto-accept", () => {
  const user = {
    emailAddresses: [
      { emailAddress: "employee@example.com", verification: { status: "verified" } },
      { emailAddress: "other@example.com", verification: { status: "unverified" } },
    ],
  };

  assert.equal(hasInvitedEmail(user, "EMPLOYEE@example.com"), true);
  assert.equal(hasVerifiedInvitedEmail(user, "employee@example.com"), true);
  assert.equal(hasVerifiedInvitedEmail(user, "other@example.com"), false);
});

test("signup state exposes the form only after a resolved signed-out session", () => {
  assert.equal(invitationViewState(resolvedState), "form");
  assert.equal(
    invitationViewState({
      ...resolvedState,
      isSignedIn: true,
      signingOut: true,
    }),
    "signing-out",
  );
  assert.equal(
    invitationViewState({
      ...resolvedState,
      isSignedIn: true,
      hasMatchingEmail: true,
    }),
    "account-verification",
  );
  assert.equal(
    invitationViewState({
      ...resolvedState,
      isSignedIn: true,
      hasVerifiedEmail: true,
    }),
    "accepting",
  );
  assert.equal(
    invitationViewState({
      ...resolvedState,
      isSignedIn: true,
      hasVerifiedEmail: true,
      phase: "error",
    }),
    "error",
  );
  assert.equal(
    invitationViewState({
      ...resolvedState,
      isSignedIn: true,
      hasVerifiedEmail: true,
      phase: "accepting",
    }),
    "accepting",
  );
});

test("signup validation rejects weak and mismatched passwords", () => {
  assert.equal(
    validateSignupFields({
      firstName: "A",
      lastName: "User",
      password: "short",
      confirmPassword: "short",
    }),
    "Password must be at least 8 characters.",
  );
  assert.equal(
    validateSignupFields({
      firstName: "A",
      lastName: "User",
      password: "long-enough",
      confirmPassword: "different",
    }),
    "Passwords do not match.",
  );
});

test("identity token subject is decoded without accepting malformed tokens", () => {
  const payload = btoa(JSON.stringify({ sub: "user_123" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(getTokenSubject(`header.${payload}.signature`), "user_123");
  assert.equal(getTokenSubject("not-a-jwt"), null);
});

test("mocked Clerk activation enters acceptance once and can be retried", async () => {
  const clerk = {
    setActiveCalls: 0,
    async setActive() {
      this.setActiveCalls += 1;
    },
  };
  const controller = createInvitationAcceptanceController();
  let acceptanceRequests = 0;

  const activateAndAccept = async () => {
    if (!controller.begin("user_invited")) return;
    await clerk.setActive();
    acceptanceRequests += 1;
  };

  await Promise.all([activateAndAccept(), activateAndAccept()]);
  assert.equal(clerk.setActiveCalls, 1);
  assert.equal(acceptanceRequests, 1);

  controller.reset();
  await activateAndAccept();
  assert.equal(clerk.setActiveCalls, 2);
  assert.equal(acceptanceRequests, 2);
});