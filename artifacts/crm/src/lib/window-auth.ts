import { setWindowSessionTokenGetter } from "@workspace/api-client-react";

const SESSION_KEY = "aegis_horizon_window_session";
let releaseOwnership: (() => void) | null = null;
let ownedToken: string | null = null;
let pendingOwnershipToken: string | null = null;
let pendingOwnership: Promise<boolean> | null = null;

async function windowSessionLockName(token: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `aegis-window-session:${hash}`;
}

export type WindowAuthUser = {
  id: string;
  clerkId: string;
  email: string;
  fullName: string | null;
};

type StoredSession = {
  token: string;
  user: WindowAuthUser;
  expiresAt: string;
};

function parseSession(value: string | null): StoredSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    if (
      typeof parsed.token !== "string" ||
      !/^aws_[A-Za-z0-9_-]{43}$/.test(parsed.token) ||
      !parsed.user ||
      typeof parsed.user.id !== "string" ||
      typeof parsed.user.clerkId !== "string" ||
      typeof parsed.user.email !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      Number.isNaN(Date.parse(parsed.expiresAt))
    ) {
      return null;
    }
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function readWindowSession(): StoredSession | null {
  try {
    const session = parseSession(sessionStorage.getItem(SESSION_KEY));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function getActiveWindowSessionToken(): string | null {
  return readWindowSession()?.token ?? null;
}

export function getActiveWindowSessionUserId(): string | null {
  return readWindowSession()?.user.id ?? null;
}

function persistWindowSession(session: StoredSession): boolean {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

/**
 * sessionStorage can be copied to a newly opened tab by the browser. Hold a
 * non-shared Web Lock for the lifetime of the tab so only the original window
 * may use that copied capability. Browsers without Web Locks fail closed.
 */
export async function claimWindowSessionOwnership(token: string): Promise<boolean> {
  // React StrictMode deliberately starts, cleans up, and starts effects again
  // in development. The first effect owns the lifetime lock, so a second
  // restore for that same token must reuse it rather than deadlocking behind
  // itself.
  if (!navigator.locks?.request) return false;
  let lockName: string | null;
  try {
    lockName = await windowSessionLockName(token);
  } catch {
    return false;
  }
  if (!lockName) return false;
  if (ownedToken === token) return true;
  if (pendingOwnershipToken === token && pendingOwnership) {
    return pendingOwnership;
  }
  releaseWindowSessionOwnership();
  let acquired = false;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<boolean>((resolve) => {
    void navigator.locks.request(
      lockName,
      { ifAvailable: true },
      async (lock) => {
        acquired = Boolean(lock);
        if (lock) {
          ownedToken = token;
          releaseOwnership = () => {
            if (ownedToken === token) ownedToken = null;
            release?.();
          };
        }
        resolve(acquired);
        if (lock) await held;
      },
    ).catch(() => resolve(false));
  });
  pendingOwnershipToken = token;
  pendingOwnership = started;
  const result = await started;
  if (pendingOwnership === started) {
    pendingOwnership = null;
    pendingOwnershipToken = null;
  }
  return result;
}

export function releaseWindowSessionOwnership(): void {
  const release = releaseOwnership;
  releaseOwnership = null;
  ownedToken = null;
  release?.();
}

export function configureWindowSessionTransport(token: string | null): void {
  setWindowSessionTokenGetter(token ? () => token : null);
}

export function clearWindowSession(): void {
  releaseWindowSessionOwnership();
  configureWindowSessionTransport(null);
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // There is no safe persistence fallback.
  }
}

export async function restoreWindowSession(): Promise<StoredSession | null> {
  const session = readWindowSession();
  if (!session) {
    clearWindowSession();
    return null;
  }
  if (!(await claimWindowSessionOwnership(session.token))) {
    clearWindowSession();
    return null;
  }
  configureWindowSessionTransport(session.token);
  return session;
}

export async function establishWindowSession(session: StoredSession): Promise<boolean> {
  if (!persistWindowSession(session)) return false;
  if (!(await claimWindowSessionOwnership(session.token))) {
    clearWindowSession();
    return false;
  }
  configureWindowSessionTransport(session.token);
  return true;
}