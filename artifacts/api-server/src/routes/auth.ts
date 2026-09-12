import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  db,
  accountDeletionLedger,
  featureEntitlements,
  organizations,
  orgUsers,
  usageLogs,
  users,
} from "@workspace/db";
import { GetMeResponse } from "@workspace/api-zod";
import { attachUser } from "../middlewares/auth";
import { getClientIp } from "../lib/clientIp";
import {
  acquireUserExclusiveLock,
  acquireUserSharedLock,
} from "../lib/orgWriteLock";
import { featuresForPlan } from "../lib/catalog";
import {
  clearWindowLoginAttempts,
  consumeWindowLoginAttempt,
  createWindowSession,
  loginAttemptKey,
  revokeWindowSession,
  revokeAllWindowSessions,
  WINDOW_SESSION_HEADER,
} from "../services/windowSessions";

const router: IRouter = Router();

const GENERIC_LOGIN_ERROR = "Unable to sign in with those credentials";

function opaqueClerkIdHash(clerkId: string): string {
  return createHash("sha256").update(clerkId).digest("hex");
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${Math.random().toString(36).slice(2, 8)}`;
}

function validLoginBody(value: unknown): value is {
  email: string;
  password: string;
  totp?: string;
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.email === "string" &&
    body.email.length > 0 &&
    body.email.length <= 320 &&
    typeof body.password === "string" &&
    body.password.length > 0 &&
    body.password.length <= 1024 &&
    (body.totp === undefined ||
      (typeof body.totp === "string" && body.totp.length > 0 && body.totp.length <= 128))
  );
}

function verifiedEmails(user: Awaited<ReturnType<typeof clerkClient.users.getUser>>): string[] {
  return user.emailAddresses
    .filter((address) => address.verification?.status === "verified")
    .map((address) => address.emailAddress.trim().toLowerCase())
    .filter(Boolean);
}

async function ensureLocalUser(
  clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>,
  email: string,
): Promise<typeof users.$inferSelect | null> {
  let [localUser] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkUser.id));
  if (localUser) return localUser;

  const emails = verifiedEmails(clerkUser);
  if (!emails.includes(email)) return null;
  const fullName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
  const matches = await db.select().from(users).where(inArray(users.email, emails));
  if (matches.length > 1) return null;

  const pending = matches[0];
  if (pending) {
    if (!pending.clerkId.startsWith("pending:")) return null;
    [localUser] = await db
      .update(users)
      .set({ clerkId: clerkUser.id, fullName: pending.fullName ?? fullName })
      .where(and(eq(users.id, pending.id), eq(users.clerkId, pending.clerkId)))
      .returning();
  } else {
    try {
      [localUser] = await db
        .insert(users)
        .values({ clerkId: clerkUser.id, email, fullName })
        .returning();
    } catch {
      [localUser] = await db
        .select()
        .from(users)
        .where(eq(users.clerkId, clerkUser.id));
    }
  }
  if (!localUser) return null;

  const memberships = await db
    .select({ id: orgUsers.id })
    .from(orgUsers)
    .where(eq(orgUsers.userId, localUser.id));
  if (memberships.length === 0) {
    const orgName = localUser.fullName
      ? `${localUser.fullName}'s Workspace`
      : "My Workspace";
    const enabled = featuresForPlan("professional");
    const [org] = await db
      .insert(organizations)
      .values({ name: orgName, slug: slugify(orgName), plan: "professional", enabledFeatures: enabled })
      .returning();
    await db.insert(orgUsers).values({ orgId: org.id, userId: localUser.id, role: "owner" });
    await db
      .insert(featureEntitlements)
      .values(enabled.map((featureKey) => ({ orgId: org.id, featureKey, enabled: true })));
    await db.insert(usageLogs).values({
      orgId: org.id,
      userId: localUser.id,
      featureKey: "platform",
      action: "org.created",
    });
  }
  return localUser;
}

/**
 * This endpoint deliberately does not create or use a Clerk browser session.
 * Every browser window must present the password (and required MFA) before it
 * receives its own app-owned token.
 */
router.post("/auth/window/login", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!validLoginBody(req.body)) {
    res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    return;
  }
  const email = req.body.email.trim().toLowerCase();
  const throttleKey = loginAttemptKey(getClientIp(req), email);
  if (!(await consumeWindowLoginAttempt(throttleKey))) {
    res.status(429).set("Retry-After", "900").json({ error: GENERIC_LOGIN_ERROR });
    return;
  }

  try {
    const lookup = await clerkClient.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    const clerkUser = lookup.data.find((candidate) =>
      verifiedEmails(candidate).includes(email),
    );
    if (!clerkUser || clerkUser.banned || clerkUser.locked) {
      res.status(401).json({ error: GENERIC_LOGIN_ERROR });
      return;
    }
    // Account deletion holds the matching exclusive Clerk-id lock. Holding a
    // shared lock from password/MFA verification through app capability
    // issuance: if deletion or reset wins, its fence is observed here; if
    // login wins, the exclusive operation waits and revokes this new token.
    const userLock = await acquireUserSharedLock(clerkUser.id);
    let localUser: typeof users.$inferSelect | null = null;
    let session: Awaited<ReturnType<typeof createWindowSession>> | null = null;
    try {
      await clerkClient.users.verifyPassword({ userId: clerkUser.id, password: req.body.password });
      if (clerkUser.twoFactorEnabled) {
        if (!req.body.totp) {
          res.status(401).json({ error: GENERIC_LOGIN_ERROR, mfaRequired: true });
          return;
        }
        // Clerk verifies both configured TOTP and supported backup codes. If
        // another MFA factor is configured, this fails closed rather than
        // treating password-only verification as sufficient.
        await clerkClient.users.verifyTOTP({ userId: clerkUser.id, code: req.body.totp });
      }
      const [deletion] = await db
        .select({ id: accountDeletionLedger.id })
        .from(accountDeletionLedger)
        .where(
          eq(
            accountDeletionLedger.userOpaqueHash,
            opaqueClerkIdHash(clerkUser.id),
          ),
        )
        .limit(1);
      if (deletion) {
        res.status(401).json({ error: GENERIC_LOGIN_ERROR });
        return;
      }
      localUser = await ensureLocalUser(clerkUser, email);
      if (!localUser) {
        res.status(401).json({ error: GENERIC_LOGIN_ERROR });
        return;
      }
      session = await createWindowSession(localUser.id);
    } finally {
      try {
        await userLock.release();
      } catch {
        // The lock owner destroys its dedicated connection on unlock failure.
      }
    }
    if (!localUser || !session) {
      res.status(401).json({ error: GENERIC_LOGIN_ERROR });
      return;
    }
    await clearWindowLoginAttempts(throttleKey);
    res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: { id: localUser.id, clerkId: localUser.clerkId, email: localUser.email, fullName: localUser.fullName },
    });
  } catch {
    // Never log credential errors or expose whether the password, MFA, or
    // identifier failed. Provider availability is intentionally indistinct.
    res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }
});

router.post("/auth/window/logout", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  await revokeWindowSession(req.header(WINDOW_SESSION_HEADER) ?? undefined);
  res.status(204).end();
});

/**
 * This is not a CRM API authentication fallback. It accepts a freshly created
 * Clerk password-reset session solely to revoke all app-owned capabilities for
 * that same identity after Clerk has verified the reset code and new password.
 */
router.post("/auth/window/password-reset/revoke", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const authorization = req.header("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  {
    // Lock even before local provisioning: an in-flight login may be creating
    // this identity's first local user and session under the shared lock.
    const userLock = await acquireUserExclusiveLock(clerkId);
    try {
      // Re-read under the exclusive lock so a concurrent login cannot issue a
      // capability after reset revocation.
      const [lockedUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);
      if (lockedUser) await revokeAllWindowSessions(lockedUser.id);
    } finally {
      try {
        await userLock.release();
      } catch {
        // Destroying the dedicated lock connection releases the fence.
      }
    }
  }
  res.status(204).end();
});

router.get("/auth/me", attachUser, async (req, res): Promise<void> => {
  const user = req.currentUser!;

  const memberships = await db
    .select()
    .from(orgUsers)
    .where(eq(orgUsers.userId, user.id));

  const orgs =
    memberships.length > 0
      ? await db
          .select()
          .from(organizations)
          .where(
            inArray(
              organizations.id,
              memberships.map((m) => m.orgId),
            ),
          )
      : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  res.json(
    GetMeResponse.parse({
      user: {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        fullName: user.fullName,
      },
      orgs: memberships
        .filter((m) => orgById.has(m.orgId))
        .map((m) => ({
          org: serializeOrg(orgById.get(m.orgId)!),
          role: m.role,
        })),
    }),
  );
});

export function serializeOrg(org: typeof organizations.$inferSelect) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    enabledFeatures: org.enabledFeatures,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    createdAt: org.createdAt.toISOString(),
  };
}

export default router;
