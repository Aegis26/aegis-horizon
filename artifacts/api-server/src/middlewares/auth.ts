import type { NextFunction, Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  organizations,
  orgUsers,
  users,
  featureEntitlements,
  orgSecurityPolicies,
  usageLogs,
  type Organization,
  type OrgUser,
  type User,
} from "@workspace/db";
import { featuresForPlan } from "../lib/catalog";
import { getClientIp, isIpAllowed } from "../lib/clientIp";
import {
  isPendingUserForVerifiedEmail,
  verifiedClerkEmails,
} from "../lib/invitationIdentity";
import { isViewerMutation } from "../services/crmAccess";

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
      currentOrg?: Organization;
      currentMembership?: OrgUser;
    }
  }
}

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  user: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Requires a signed-in Clerk session; provisions the local user (and a
 *  default org on first sign-in) just-in-time. */
export async function attachUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  let [user] = await db.select().from(users).where(eq(users.clerkId, auth.userId));

  if (!user) {
    const clerkUser = await clerkClient.users.getUser(auth.userId);
    const verifiedEmails = verifiedClerkEmails(clerkUser);
    if (verifiedEmails.length === 0) {
      res.status(403).json({ error: "A verified email address is required" });
      return;
    }
    const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress
      ?.toLowerCase()
      .trim();
    const email =
      (primaryEmail && verifiedEmails.includes(primaryEmail)
        ? primaryEmail
        : verifiedEmails[0])!;
    const fullName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

    // An admin may have pre-created this user via an invite. Match only
    // verified addresses, and never merge into an active Clerk identity.
    const existingByEmail = await db
      .select()
      .from(users)
      .where(inArray(users.email, verifiedEmails));

    if (existingByEmail.length > 1) {
      res.status(403).json({ error: "Verified email identity is ambiguous" });
      return;
    }

    const candidate = existingByEmail[0];
    if (candidate) {
      if (candidate.clerkId === auth.userId) {
        user = candidate;
      } else if (isPendingUserForVerifiedEmail(candidate, verifiedEmails)) {
        // The clerkId predicate makes this claim safe if two first sign-ins
        // race. A real Clerk identity can never be overwritten.
        [user] = await db
          .update(users)
          .set({ clerkId: auth.userId, fullName: candidate.fullName ?? fullName })
          .where(
            and(
              eq(users.id, candidate.id),
              eq(users.email, candidate.email),
              eq(users.clerkId, candidate.clerkId),
            ),
          )
          .returning();
        if (!user) {
          [user] = await db
            .select()
            .from(users)
            .where(eq(users.clerkId, auth.userId));
        }
        if (!user) {
          res.status(409).json({ error: "Unable to claim invited account safely" });
          return;
        }
      } else {
        res.status(403).json({ error: "Verified email is linked to another account" });
        return;
      }
    } else {
      try {
        [user] = await db
          .insert(users)
          .values({ clerkId: auth.userId, email, fullName })
          .returning();
      } catch {
        // A concurrent first sign-in may have claimed the same identity.
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.clerkId, auth.userId));
        if (!user) {
          res.status(409).json({ error: "Unable to create account safely" });
          return;
        }
      }
    }
  }

  // Ensure the user belongs to at least one org.
  const memberships = await db
    .select()
    .from(orgUsers)
    .where(eq(orgUsers.userId, user.id));

  if (memberships.length === 0) {
    const orgName = user.fullName ? `${user.fullName}'s Workspace` : "My Workspace";
    const enabled = featuresForPlan("professional");
    const [org] = await db
      .insert(organizations)
      .values({
        name: orgName,
        slug: slugify(orgName),
        plan: "professional",
        enabledFeatures: enabled,
      })
      .returning();
    await db.insert(orgUsers).values({ orgId: org.id, userId: user.id, role: "owner" });
    await db
      .insert(featureEntitlements)
      .values(enabled.map((featureKey) => ({ orgId: org.id, featureKey, enabled: true })));
    await db.insert(usageLogs).values({
      orgId: org.id,
      userId: user.id,
      featureKey: "platform",
      action: "org.created",
    });
  }

  req.currentUser = user;
  next();
}

function orgIdParam(req: Request): string {
  const raw = req.params.orgId;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Requires attachUser first. Loads the org from :orgId and verifies membership. */
export async function attachOrg(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const orgId = orgIdParam(req);
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
    res.status(400).json({ error: "Invalid org id" });
    return;
  }

  const [membership] = await db
    .select()
    .from(orgUsers)
    .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.userId, user.id)));
  if (!membership) {
    res.status(403).json({ error: "Not a member of this organization" });
    return;
  }
  if (isViewerMutation(membership.role, req.method)) {
    res.status(403).json({ error: "Viewers have read-only access" });
    return;
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const [securityPolicy] = await db
    .select()
    .from(orgSecurityPolicies)
    .where(eq(orgSecurityPolicies.orgId, org.id));
  if (
    securityPolicy?.ipAllowlistEnabled &&
    !isIpAllowed(getClientIp(req), securityPolicy.allowedCidrs)
  ) {
    res.status(403).json({ error: "Access denied by organization IP policy" });
    return;
  }

  // Viewer requests must be strictly read-only, including GET middleware.
  // Return the loaded context without plan-reconciliation writes.
  if (membership.role === "viewer") {
    req.currentOrg = org;
    req.currentMembership = membership;
    next();
    return;
  }

  // Keep grandfathered paid organizations aligned with their plan's included
  // catalog features. This is plan reconciliation (not a feature-gate bypass):
  // custom plans remain untouched and AI still requires explicit consent.
  if (org.plan !== "custom") {
    const included = featuresForPlan(org.plan);
    const missing = included.filter((feature) => !org.enabledFeatures.includes(feature));
    if (missing.length > 0) {
      const [updated] = await db
        .update(organizations)
        .set({ enabledFeatures: [...new Set([...org.enabledFeatures, ...missing])] })
        .where(eq(organizations.id, org.id))
        .returning();
      req.currentOrg = updated;
      req.currentMembership = membership;
      next();
      return;
    }
  }
  req.currentOrg = org;
  req.currentMembership = membership;
  next();
}

/** Role gate: requires attachOrg first. */
export function requireRole(minRole: keyof typeof ROLE_RANK) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const membership = req.currentMembership;
    if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}

/** Feature entitlement gate: requires attachOrg first. Returns 403 with the
 *  featureKey when the org has not enabled the feature. */
export function requireFeature(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const org = req.currentOrg;
    if (!org) {
      res.status(401).json({ error: "No organization context" });
      return;
    }
    if (!org.enabledFeatures.includes(featureKey)) {
      res.status(403).json({
        error: `Feature '${featureKey}' is not enabled for this organization`,
        featureKey,
      });
      return;
    }
    // Fire-and-forget usage log
    void db
      .insert(usageLogs)
      .values({
        orgId: org.id,
        userId: req.currentUser?.id,
        featureKey,
        action: `${req.method.toLowerCase()}.${req.path}`,
      })
      .catch(() => {});
    next();
  };
}
