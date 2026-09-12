import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, users, windowLoginAttempts, windowSessions } from "@workspace/db";

export const WINDOW_SESSION_HEADER = "x-aegis-window-session";
const TOKEN_PREFIX = "aws_";
const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
const IDLE_LIFETIME_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

export function hashWindowSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWindowSessionToken(value: string | undefined): value is string {
  return Boolean(value && /^aws_[A-Za-z0-9_-]{43}$/.test(value));
}

export function createWindowSessionToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export async function createWindowSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = createWindowSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_LIFETIME_MS);
  await db.insert(windowSessions).values({
    userId,
    tokenHash: hashWindowSessionToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Resolve a session solely from the opaque header and refresh its idle timer.
 * Clerk request cookies and bearer tokens are intentionally never consulted.
 */
export async function authenticateWindowSession(
  token: string | undefined,
): Promise<typeof users.$inferSelect | null> {
  if (!isWindowSessionToken(token)) return null;

  const now = new Date();
  const idleCutoff = new Date(now.getTime() - IDLE_LIFETIME_MS);
  const tokenHash = hashWindowSessionToken(token);
  const [row] = await db
    .select({ sessionId: windowSessions.id, user: users })
    .from(windowSessions)
    .innerJoin(users, eq(users.id, windowSessions.userId))
    .where(eq(windowSessions.tokenHash, tokenHash));
  if (
    !row ||
    row.user.clerkId.startsWith("pending:") ||
    row.user === undefined
  ) {
    return null;
  }

  // This compare-and-set prevents an expired/revoked session from being
  // revived by a concurrent request that read it immediately before revocation.
  const [refreshed] = await db
    .update(windowSessions)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(windowSessions.id, row.sessionId),
        eq(windowSessions.tokenHash, tokenHash),
        isNull(windowSessions.revokedAt),
        gt(windowSessions.expiresAt, now),
        gt(windowSessions.lastSeenAt, idleCutoff),
      ),
    )
    .returning({ id: windowSessions.id });

  return refreshed ? row.user : null;
}

export async function revokeWindowSession(token: string | undefined): Promise<void> {
  if (!isWindowSessionToken(token)) return;
  await db
    .update(windowSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(windowSessions.tokenHash, hashWindowSessionToken(token)),
        isNull(windowSessions.revokedAt),
      ),
    );
}

export async function revokeAllWindowSessions(
  userId: string,
  database: Pick<typeof db, "update"> = db,
): Promise<void> {
  await database
    .update(windowSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(windowSessions.userId, userId), isNull(windowSessions.revokedAt)));
}

export function loginAttemptKey(ip: string | null, normalizedEmail: string): string {
  return createHash("sha256")
    .update(`${ip ?? "unknown"}\u0000${normalizedEmail}`)
    .digest("hex");
}

/**
 * Record before checking credentials so unknown accounts receive exactly the
 * same distributed throttle as real ones. A successful login clears its bucket.
 */
export async function consumeWindowLoginAttempt(keyHash: string): Promise<boolean> {
  const now = new Date();
  const resetBefore = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const blockUntil = new Date(now.getTime() + LOGIN_BLOCK_MS);
  const nextFailures = sql<number>`case
    when ${windowLoginAttempts.updatedAt} < ${resetBefore} then 1
    else ${windowLoginAttempts.failures} + 1
  end`;
  const [bucket] = await db
    .insert(windowLoginAttempts)
    .values({ keyHash, failures: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: windowLoginAttempts.keyHash,
      set: {
        failures: nextFailures,
        blockedUntil: sql`case
          when ${windowLoginAttempts.blockedUntil} > ${now} then ${windowLoginAttempts.blockedUntil}
          when (${nextFailures}) >= ${MAX_LOGIN_FAILURES} then ${blockUntil}
          else null
        end`,
        updatedAt: now,
      },
    })
    .returning({
      blockedUntil: windowLoginAttempts.blockedUntil,
    });
  return !bucket?.blockedUntil || bucket.blockedUntil <= now;
}

export async function clearWindowLoginAttempts(keyHash: string): Promise<void> {
  await db.delete(windowLoginAttempts).where(eq(windowLoginAttempts.keyHash, keyHash));
}