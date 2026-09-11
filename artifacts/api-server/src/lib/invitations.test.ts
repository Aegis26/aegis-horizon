import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvitationToken,
  INVITATION_TTL_SECONDS,
  invitationAcceptanceDecision,
  invitationMembershipMatches,
  invitationResolutionDecision,
  runInvitationTransferAtomically,
  verifyInvitationToken,
} from "./invitations";
import { sendInvitationEmail } from "./email";
import {
  isPendingUserForVerifiedEmail,
  verifiedClerkEmails,
} from "./invitationIdentity";

const NOW = Date.UTC(2026, 0, 1);
const invitation = {
  membershipId: "membership-1",
  userId: "user-1",
  orgId: "org-1",
  email: "recipient@example.com",
};

test("signed invitation tokens bind the membership and survive only seven days", () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const token = createInvitationToken(invitation, NOW);

  assert.deepEqual(verifyInvitationToken(token, NOW), {
    ...invitation,
    purpose: "aegis-horizon.org-invitation.v1",
    iat: NOW / 1000,
    exp: NOW / 1000 + INVITATION_TTL_SECONDS,
  });
  assert.equal(
    verifyInvitationToken(token, NOW + INVITATION_TTL_SECONDS * 1000 - 1)?.userId,
    invitation.userId,
  );
  assert.equal(verifyInvitationToken(token, NOW + INVITATION_TTL_SECONDS * 1000), null);
});

test("tampered tokens and tokens for another identity are rejected by binding checks", () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const token = createInvitationToken(invitation, NOW);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

  assert.equal(verifyInvitationToken(tampered, NOW), null);
  const decoded = verifyInvitationToken(token, NOW);
  assert.ok(decoded);
  assert.notEqual(decoded.userId, "different-user");
  assert.notEqual(decoded.email, "different@example.com");
});

test("unverified addresses cannot claim pending users, while verified secondary addresses can", () => {
  const verifiedEmails = verifiedClerkEmails({
    emailAddresses: [
      {
        emailAddress: "primary@example.com",
        verification: { status: "unverified" },
      },
      {
        emailAddress: "Invitee@Example.com",
        verification: { status: "verified" },
      },
    ],
  });

  assert.deepEqual(verifiedEmails, ["invitee@example.com"]);
  assert.equal(
    isPendingUserForVerifiedEmail(
      { clerkId: "pending:invitee@example.com", email: "invitee@example.com" },
      verifiedEmails,
    ),
    true,
  );
  assert.equal(
    isPendingUserForVerifiedEmail(
      { clerkId: "pending:primary@example.com", email: "primary@example.com" },
      verifiedEmails,
    ),
    false,
  );
  assert.equal(
    isPendingUserForVerifiedEmail(
      { clerkId: "clerk_other", email: "invitee@example.com" },
      verifiedEmails,
    ),
    false,
  );
  assert.equal(
    isPendingUserForVerifiedEmail(
      { clerkId: "pending:invitee@example.com", email: "invitee@example.com" },
      verifiedClerkEmails({
        emailAddresses: [
          { emailAddress: "wrong@example.com", verification: { status: "verified" } },
        ],
      }),
    ),
    false,
  );
});

test("acceptance membership binding fails closed for removed or wrong-org memberships", () => {
  const token = {
    membershipId: invitation.membershipId,
    userId: invitation.userId,
    orgId: invitation.orgId,
  };
  assert.equal(invitationMembershipMatches(token, undefined), false);
  assert.equal(
    invitationMembershipMatches(token, {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: "other-org",
    }),
    false,
  );
  assert.equal(
    invitationMembershipMatches(token, {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: invitation.orgId,
    }),
    true,
  );
});

test("acceptance rejects a signed-in owner whose verified email is not invited", () => {
  const decision = invitationAcceptanceDecision({
    token: invitation,
    authUserId: "clerk-owner",
    localUser: { id: "owner-user", clerkId: "clerk-owner" },
    verifiedEmails: ["owner@example.com"],
    targetUser: {
      id: invitation.userId,
      clerkId: "pending:recipient@example.com",
      email: invitation.email,
    },
    targetMembership: {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: invitation.orgId,
      role: "user",
    },
    organization: { id: invitation.orgId },
  });

  assert.deepEqual(decision, {
    accepted: false,
    status: 403,
    error: "Verify the invited email address in Clerk before accepting",
  });
});

test("verified employee acceptance selects the token organization without consuming membership", () => {
  const decision = invitationAcceptanceDecision({
    token: invitation,
    authUserId: "clerk-employee",
    localUser: { id: invitation.userId, clerkId: "clerk-employee" },
    verifiedEmails: [invitation.email],
    targetUser: {
      id: invitation.userId,
      clerkId: "clerk-employee",
      email: invitation.email,
    },
    targetMembership: {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: invitation.orgId,
      role: "user",
    },
    // A different org must not be selected from ambient session state.
    organization: { id: invitation.orgId },
  });

  assert.deepEqual(decision, {
    accepted: true,
    transferMembership: false,
    orgId: invitation.orgId,
    membershipId: invitation.membershipId,
    role: "user",
  });
});

test("removed memberships fail closed even when the signed invitation is unexpired", () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const token = createInvitationToken(invitation, NOW);
  assert.ok(verifyInvitationToken(token, NOW));

  const decision = invitationAcceptanceDecision({
    token: invitation,
    authUserId: "clerk-employee",
    localUser: { id: invitation.userId, clerkId: "clerk-employee" },
    verifiedEmails: [invitation.email],
    targetUser: {
      id: invitation.userId,
      clerkId: "clerk-employee",
      email: invitation.email,
    },
    targetMembership: undefined,
    organization: { id: invitation.orgId },
  });

  assert.equal(decision.accepted, false);
  if (!decision.accepted) {
    assert.equal(decision.status, 410);
  }
});

test("acceptance fails closed when the database organization does not match the token", () => {
  const decision = invitationAcceptanceDecision({
    token: invitation,
    authUserId: "clerk-employee",
    localUser: { id: invitation.userId, clerkId: "clerk-employee" },
    verifiedEmails: [invitation.email],
    targetUser: {
      id: invitation.userId,
      clerkId: "clerk-employee",
      email: invitation.email,
    },
    targetMembership: {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: invitation.orgId,
      role: "user",
    },
    organization: { id: "different-org" },
  });

  assert.equal(decision.accepted, false);
  if (!decision.accepted) {
    assert.equal(decision.status, 410);
  }
});

test("public resolution returns only database-bound email and organization", () => {
  const decision = invitationResolutionDecision({
    token: invitation,
    user: { id: invitation.userId, email: "Recipient@Example.com" },
    membership: {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: invitation.orgId,
    },
    organization: { id: invitation.orgId, name: "Acme" },
  });

  assert.deepEqual(decision, {
    resolved: true,
    email: "Recipient@Example.com",
    org: { id: invitation.orgId, name: "Acme" },
  });
});

test("public resolution rejects expired and tampered signed tokens", () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const signedToken = createInvitationToken(invitation, NOW);
  const tamperedToken = `${signedToken.slice(0, -1)}${
    signedToken.endsWith("a") ? "b" : "a"
  }`;

  assert.equal(
    verifyInvitationToken(
      signedToken,
      NOW + INVITATION_TTL_SECONDS * 1000,
    ),
    null,
  );
  assert.equal(verifyInvitationToken(tamperedToken, NOW), null);
});

test("public resolution rejects removed or mismatched database bindings", () => {
  const validInput = {
    token: invitation,
    user: { id: invitation.userId, email: invitation.email },
    membership: {
      id: invitation.membershipId,
      userId: invitation.userId,
      orgId: invitation.orgId,
    },
    organization: { id: invitation.orgId, name: "Acme" },
  };

  assert.deepEqual(
    invitationResolutionDecision({ ...validInput, membership: undefined }),
    { resolved: false },
  );
  assert.deepEqual(
    invitationResolutionDecision({
      ...validInput,
      membership: {
        ...validInput.membership,
        orgId: "other-org",
      },
    }),
    { resolved: false },
  );
  assert.deepEqual(
    invitationResolutionDecision({
      ...validInput,
      user: { id: invitation.userId, email: "different@example.com" },
    }),
    { resolved: false },
  );
  assert.deepEqual(
    invitationResolutionDecision({
      ...validInput,
      organization: { id: "other-org", name: "Other" },
    }),
    { resolved: false },
  );
});

test("audit failure rolls back pending transfer so the same invitation link can retry", async () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const signedToken = createInvitationToken(invitation, NOW);
  const verifiedToken = verifyInvitationToken(signedToken, NOW);
  assert.ok(verifiedToken);

  type TransactionState = { membershipUserId: string };
  let persisted: TransactionState = { membershipUserId: invitation.userId };
  let auditAttempts = 0;
  const auditRows: string[] = [];
  const transaction = async (
    work: (tx: TransactionState) => Promise<string>,
  ): Promise<string> => {
    const tx = { ...persisted };
    const result = await work(tx);
    persisted = tx;
    return result;
  };

  const transfer = async (tx: TransactionState): Promise<string> => {
    if (tx.membershipUserId !== verifiedToken.userId) {
      throw new Error("Invitation is no longer bound to the pending user");
    }
    tx.membershipUserId = "employee-user";
    return tx.membershipUserId;
  };
  const writeAudit = async (
    _tx: TransactionState,
    membershipUserId: string,
  ): Promise<void> => {
    auditAttempts += 1;
    if (auditAttempts === 1) throw new Error("audit unavailable");
    auditRows.push(membershipUserId);
  };

  await assert.rejects(
    runInvitationTransferAtomically(transaction, transfer, writeAudit),
    /audit unavailable/,
  );
  assert.equal(persisted.membershipUserId, invitation.userId);
  assert.equal(auditRows.length, 0);

  const acceptedUserId = await runInvitationTransferAtomically(
    transaction,
    transfer,
    writeAudit,
  );
  assert.equal(acceptedUserId, "employee-user");
  assert.equal(persisted.membershipUserId, "employee-user");
  assert.deepEqual(auditRows, ["employee-user"]);
});

test("resend can issue a fresh token for the same membership binding", () => {
  process.env.SESSION_SECRET = "test-session-secret";
  const first = createInvitationToken(invitation, NOW);
  const resent = createInvitationToken(invitation, NOW + 1000);

  assert.notEqual(first, resent);
  assert.deepEqual(verifyInvitationToken(resent, NOW + 1000), {
    ...invitation,
    purpose: "aegis-horizon.org-invitation.v1",
    iat: NOW / 1000 + 1,
    exp: NOW / 1000 + 1 + INVITATION_TTL_SECONDS,
  });
});

test("invitation email escapes organization and link content", async () => {
  let sent: { to: string; subject: string; html: string } | undefined;
  const result = await sendInvitationEmail(
    "recipient@example.com",
    `<Acme> & "Partners"`,
    "https://example.com/invite#token=a&b",
    async (args) => {
      sent = args;
      return { id: "message-1" };
    },
  );

  assert.equal(result.id, "message-1");
  assert.equal(sent?.to, "recipient@example.com");
  assert.match(sent?.html ?? "", /&lt;Acme&gt; &amp; &quot;Partners&quot;/);
  assert.match(sent?.html ?? "", /token=a&amp;b/);
});

test("invitation email delivery rejects provider errors and empty ids", async () => {
  await assert.rejects(
    sendInvitationEmail(
      "recipient@example.com",
      "Acme",
      "https://example.com/invite",
      async () => {
        throw new Error("provider unavailable");
      },
    ),
    /provider unavailable/,
  );
  await assert.rejects(
    sendInvitationEmail(
      "recipient@example.com",
      "Acme",
      "https://example.com/invite",
      async () => ({ id: "" }),
    ),
    /message id/,
  );
});