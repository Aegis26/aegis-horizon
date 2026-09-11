import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  AcceptInvitationBody,
  AcceptInvitationResponse,
} from "@workspace/api-zod";
import { db, organizations, orgUsers, users } from "@workspace/db";
import {
  attachUser,
} from "../middlewares/auth";
import {
  invitationAcceptanceDecision,
  runInvitationTransferAtomically,
  verifyInvitationToken,
} from "../lib/invitations";
import {
  isPendingUserForVerifiedEmail,
  verifiedClerkEmails,
} from "../lib/invitationIdentity";
import { appendAuditEvent, auditContext } from "../services/audit";
import { serializeOrg } from "./auth";

const router: IRouter = Router();
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class InvitationTransferFailure extends Error {
  constructor(
    readonly status: 403 | 409 | 410,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Accepting an invitation confirms an authenticated recipient and selects the
 * organization whose membership was pre-provisioned by an administrator. It
 * does not create a second membership or revoke the existing one when the
 * seven-day link expires.
 */
router.post(
  "/invitations/accept",
  attachUser,
  async (req, res): Promise<void> => {
    const parsed = AcceptInvitationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid invitation" });
      return;
    }

    const token = verifyInvitationToken(parsed.data.token);
    if (!token) {
      res.status(400).json({ error: "Invalid or expired invitation" });
      return;
    }

    const authUserId = getAuth(req).userId;
    const localUser = req.currentUser;
    if (!authUserId) {
      res.status(403).json({ error: "Invitation is not valid for this account" });
      return;
    }

    let clerkUser;
    try {
      clerkUser = await clerkClient.users.getUser(authUserId);
    } catch {
      res.status(503).json({ error: "Unable to verify the signed-in email" });
      return;
    }
    const verifiedEmails = verifiedClerkEmails(clerkUser);

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, token.userId));
    if (!targetUser) {
      res.status(410).json({ error: "Invitation is no longer available" });
      return;
    }

    const [targetMembership] = await db
      .select()
      .from(orgUsers)
      .where(
        and(
          eq(orgUsers.id, token.membershipId),
          eq(orgUsers.userId, token.userId),
          eq(orgUsers.orgId, token.orgId),
        ),
      );

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, token.orgId));

    const decision = invitationAcceptanceDecision({
      token,
      authUserId,
      localUser,
      verifiedEmails,
      targetUser,
      targetMembership,
      organization: org,
    });
    if (!decision.accepted) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }

    const acceptanceAuditContext = auditContext(req);
    const auditAcceptance = (acceptedMembership: typeof orgUsers.$inferSelect) => ({
      orgId: org.id,
      action: "invitation.accepted",
      entityType: "org_user",
      entityId: acceptedMembership.id,
      ...acceptanceAuditContext,
      metadata: {
        role: acceptedMembership.role,
      },
    });

    let membership = targetMembership;
    if (!localUser) {
      // The decision above requires a matching local user. This guard keeps
      // the narrowing explicit if the request type changes in the future.
      res.status(403).json({ error: "Invitation is not valid for this account" });
      return;
    }
    if (decision.transferMembership) {
      // The invite was pre-provisioned under a pending email row, while the
      // recipient already has an active local account (for example, their
      // invited address is a verified secondary email). Transfer only that
      // pending membership, never a membership owned by a real Clerk user.
      if (
        targetUser.email.toLowerCase() !== token.email ||
        !isPendingUserForVerifiedEmail(targetUser, verifiedEmails)
      ) {
        res.status(403).json({ error: "Invitation is not valid for this account" });
        return;
      }
      try {
        membership = await runInvitationTransferAtomically<
          DatabaseTransaction,
          typeof orgUsers.$inferSelect
        >(
          (work) => db.transaction(work),
          async (tx) => {
            const [lockedTargetUser] = await tx
              .select()
              .from(users)
              .where(eq(users.id, token.userId))
              .for("update");
            if (
              !lockedTargetUser ||
              !isPendingUserForVerifiedEmail(lockedTargetUser, verifiedEmails) ||
              lockedTargetUser.email.toLowerCase() !== token.email
            ) {
              throw new InvitationTransferFailure(
                403,
                "Invitation is not valid for this account",
              );
            }

            const [lockedMembership] = await tx
              .select()
              .from(orgUsers)
              .where(
                and(
                  eq(orgUsers.id, token.membershipId),
                  eq(orgUsers.userId, token.userId),
                  eq(orgUsers.orgId, token.orgId),
                ),
              )
              .for("update");
            if (!lockedMembership) {
              throw new InvitationTransferFailure(
                410,
                "Invitation is no longer available",
              );
            }

            const [sameOrgMembership] = await tx
              .select()
              .from(orgUsers)
              .where(
                and(
                  eq(orgUsers.orgId, token.orgId),
                  eq(orgUsers.userId, localUser.id),
                ),
              )
              .for("update");
            if (sameOrgMembership) {
              // Preserve both records rather than deleting one or changing the
              // role, which could accidentally escalate access.
              throw new InvitationTransferFailure(
                409,
                "This account is already a member of the organization",
              );
            }

            const [transferred] = await tx
              .update(orgUsers)
              .set({ userId: localUser.id })
              .where(
                and(
                  eq(orgUsers.id, token.membershipId),
                  eq(orgUsers.orgId, token.orgId),
                  eq(orgUsers.userId, token.userId),
                ),
              )
              .returning();
            if (!transferred) {
              throw new InvitationTransferFailure(
                410,
                "Invitation is no longer available",
              );
            }
            return transferred;
          },
          (tx, transferred) => appendAuditEvent(auditAcceptance(transferred), tx),
        );
      } catch (error) {
        if (error instanceof InvitationTransferFailure) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        res.status(503).json({ error: "Unable to accept invitation safely" });
        return;
      }
    }

    if (!membership) {
      // The pure decision above guarantees this, but avoid dereferencing an
      // unexpected database result if a concurrent deletion occurs.
      res.status(410).json({ error: "Invitation is no longer available" });
      return;
    }

    if (!decision.transferMembership) {
      // Keep the audit record server-derived. In particular, never copy the
      // bearer token (or a client-supplied identity/IP field) into metadata.
      await appendAuditEvent(auditAcceptance(membership));
    }

    res.json(
      AcceptInvitationResponse.parse({
        org: serializeOrg(org),
        role: membership.role,
      }),
    );
  },
);

export default router;