import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  AcceptInvitationBody,
  AcceptInvitationResponse,
  ResolveInvitationBody,
  ResolveInvitationResponse,
} from "@workspace/api-zod";
import { db, organizations, orgUsers, users } from "@workspace/db";
import {
  attachUser,
  acquireOrganizationMutationLock,
  isAccountDeletionActive,
} from "../middlewares/auth";
import {
  invitationAcceptanceDecision,
  invitationResolutionDecision,
  runInvitationTransferAtomically,
  verifyInvitationToken,
} from "../lib/invitations";
import {
  isPendingUserForVerifiedEmail,
  verifiedClerkEmails,
} from "../lib/invitationIdentity";
import { appendAuditEvent, auditContext } from "../services/audit";
import { serializeOrg } from "./auth";
import { getClientIp } from "../lib/clientIp";
import { logger } from "../lib/logger";

const router: IRouter = Router();
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const INVALID_INVITATION_ERROR = "Invalid invitation";
const RESOLVE_WINDOW_MS = 60_000;
const RESOLVE_REQUESTS_PER_WINDOW = 10;
const resolveRateLimits = new Map<
  string,
  { windowStartedAt: number; requestCount: number }
>();

function consumeResolveRateLimit(req: Request):
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const key = getClientIp(req) ?? "unknown";
  if (resolveRateLimits.size > 10_000) {
    for (const [knownKey, bucket] of resolveRateLimits) {
      if (now - bucket.windowStartedAt >= RESOLVE_WINDOW_MS) {
        resolveRateLimits.delete(knownKey);
      }
    }
  }
  const current = resolveRateLimits.get(key);
  if (!current || now - current.windowStartedAt >= RESOLVE_WINDOW_MS) {
    resolveRateLimits.set(key, { windowStartedAt: now, requestCount: 1 });
    return { allowed: true };
  }

  current.requestCount += 1;
  if (current.requestCount <= RESOLVE_REQUESTS_PER_WINDOW) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((current.windowStartedAt + RESOLVE_WINDOW_MS - now) / 1000),
    ),
  };
}

function invalidInvitation(res: Response): void {
  res.status(400).json({ error: INVALID_INVITATION_ERROR });
}

class InvitationTransferFailure extends Error {
  constructor(
    readonly status: 403 | 409 | 410,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Public signup-first resolution. The returned email and organization are
 * loaded from the current database bindings, never trusted from the token.
 */
router.post(
  "/invitations/resolve",
  async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");

    const rateLimit = consumeResolveRateLimit(req);
    if (!rateLimit.allowed) {
      res
        .status(429)
        .set("Retry-After", String(rateLimit.retryAfterSeconds))
        .json({ error: "Too many invitation resolution attempts" });
      return;
    }

    const parsed = ResolveInvitationBody.safeParse(req.body);
    if (!parsed.success) {
      invalidInvitation(res);
      return;
    }

    const token = verifyInvitationToken(parsed.data.token);
    if (!token) {
      invalidInvitation(res);
      return;
    }

    try {
      const [binding] = await db
        .select({
          userId: users.id,
          email: users.email,
          membershipId: orgUsers.id,
          membershipUserId: orgUsers.userId,
          membershipOrgId: orgUsers.orgId,
          organizationId: organizations.id,
          organizationName: organizations.name,
        })
        .from(orgUsers)
        .innerJoin(users, eq(users.id, orgUsers.userId))
        .innerJoin(organizations, eq(organizations.id, orgUsers.orgId))
        .where(
          and(
            eq(orgUsers.id, token.membershipId),
            eq(orgUsers.userId, token.userId),
            eq(orgUsers.orgId, token.orgId),
          ),
        );

      const decision = invitationResolutionDecision({
        token,
        user: binding
          ? { id: binding.userId, email: binding.email }
          : undefined,
        membership: binding
          ? {
              id: binding.membershipId,
              userId: binding.membershipUserId,
              orgId: binding.membershipOrgId,
            }
          : undefined,
        organization: binding
          ? { id: binding.organizationId, name: binding.organizationName }
          : undefined,
      });
      if (!decision.resolved) {
        invalidInvitation(res);
        return;
      }

      res.json(ResolveInvitationResponse.parse(decision));
    } catch {
      // Do not include the token or any token-derived value in diagnostics.
      logger.warn({ invitationResolution: "failed" }, "Invitation resolution failed");
      invalidInvitation(res);
    }
  },
);

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
    if (!(await acquireOrganizationMutationLock(req, res, token.orgId))) return;

    const localUser = req.currentUser;
    const authUserId = localUser?.clerkId;
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
    if (await isAccountDeletionActive(targetUser.id)) {
      res.status(409).json({ error: "This account is being deleted" });
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