import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvitationToken,
  INVITATION_TTL_SECONDS,
  invitationMembershipMatches,
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