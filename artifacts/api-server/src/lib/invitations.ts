import { createHmac, timingSafeEqual } from "node:crypto";

const INVITATION_PURPOSE = "aegis-horizon.org-invitation.v1";
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type InvitationTokenPayload = {
  purpose: typeof INVITATION_PURPOSE;
  membershipId: string;
  userId: string;
  orgId: string;
  email: string;
  iat: number;
  exp: number;
};

export type InvitationMembershipBinding = {
  id: string;
  userId: string;
  orgId: string;
};

export function invitationMembershipMatches(
  token: Pick<InvitationTokenPayload, "membershipId" | "userId" | "orgId">,
  membership: InvitationMembershipBinding | null | undefined,
): boolean {
  return Boolean(
    membership &&
      membership.id === token.membershipId &&
      membership.userId === token.userId &&
      membership.orgId === token.orgId,
  );
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(input: string): string {
  return createHmac("sha256", sessionSecret()).update(input).digest("base64url");
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

/**
 * Invitations intentionally do not persist a bearer token in the database.
 * The signed payload binds the link to the already-created membership, user,
 * organization, and recipient email. The membership remains in place after
 * the seven-day link expires; expiry only invalidates this acceptance link.
 */
export function createInvitationToken(
  input: Omit<InvitationTokenPayload, "purpose" | "iat" | "exp">,
  now = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const payload: InvitationTokenPayload = {
    ...input,
    purpose: INVITATION_PURPOSE,
    iat: issuedAt,
    exp: issuedAt + INVITATION_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

/**
 * Returns null for every malformed, tampered, wrong-purpose, or expired token.
 * Callers should not log the supplied token.
 */
export function verifyInvitationToken(
  token: string,
  now = Date.now(),
): InvitationTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
      return null;
    }

    const [encodedPayload, providedSignature] = parts;
    const expectedSignature = signature(encodedPayload);
    const providedBytes = Buffer.from(providedSignature, "base64url");
    const expectedBytes = Buffer.from(expectedSignature, "base64url");
    if (
      providedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(providedBytes, expectedBytes)
    ) {
      return null;
    }

    const parsed: unknown = JSON.parse(decode(encodedPayload));
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<InvitationTokenPayload>;
    if (
      payload.purpose !== INVITATION_PURPOSE ||
      !validIdentifier(payload.membershipId) ||
      !validIdentifier(payload.userId) ||
      !validIdentifier(payload.orgId) ||
      !validIdentifier(payload.email) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp - payload.iat !== INVITATION_TTL_SECONDS ||
      payload.exp <= Math.floor(now / 1000) ||
      payload.iat > Math.floor(now / 1000) + 60
    ) {
      return null;
    }

    return payload as InvitationTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Builds the browser URL without using the request Host header. The token is
 * placed in the URL fragment so it is not sent in HTTP request logs or
 * referrers; the acceptance page submits it to the authenticated API in a
 * POST body and immediately removes it from the address bar.
 */
export function invitationLink(token: string): string {
  const configured = process.env.APP_URL?.trim();
  if (!configured) {
    throw new Error("APP_URL is not configured");
  }

  const url = new URL(configured);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL must use http or https");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production");
  }

  const basePath = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${basePath}/invite#token=${encodeURIComponent(token)}`;
}