import type { NextFunction, Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import {
  db,
  organizations,
  orgUsers,
  users,
  featureEntitlements,
  usageLogs,
  type Organization,
  type OrgUser,
  type User,
} from "@workspace/db";
import { featuresForPlan } from "../lib/catalog";
import { seedDemoData } from "../lib/seedDemoData";

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
    const email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      `${auth.userId}@unknown.local`;
    const fullName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

    // An admin may have pre-created this user via an invite (by email).
    const [existingByEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()));

    if (existingByEmail) {
      [user] = await db
        .update(users)
        .set({ clerkId: auth.userId, fullName: existingByEmail.fullName ?? fullName })
        .where(eq(users.id, existingByEmail.id))
        .returning();
    } else {
      [user] = await db
        .insert(users)
        .values({ clerkId: auth.userId, email: email.toLowerCase(), fullName })
        .returning();
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
    await seedDemoData(org.id, user.id);
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

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
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
