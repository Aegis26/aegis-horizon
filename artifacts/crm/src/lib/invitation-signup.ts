export interface ResolvedInvitation {
  email: string;
  org: {
    id: string;
    name: string;
  };
}

export type InvitationResolutionState =
  | { status: "loading" }
  | { status: "resolved"; invitation: ResolvedInvitation }
  | { status: "error"; message: string };

export type InvitationSignupPhase =
  | "form"
  | "verify"
  | "accepting"
  | "complete"
  | "error";

export type InvitationViewState =
  | "loading"
  | "signing-out"
  | "account-verification"
  | "form"
  | "verify"
  | "accepting"
  | "complete"
  | "error";

export interface InvitationAcceptanceController {
  begin(expectedUserId: string): boolean;
  reset(): void;
}

/**
 * Acceptance is intentionally a single entry point. A Clerk session update
 * can make both the submit handler and the auth effect render at once, so the
 * gate must be shared by both paths rather than relying on render timing.
 */
export function createInvitationAcceptanceController(): InvitationAcceptanceController {
  let started = false;
  let expectedUserId: string | null = null;

  return {
    begin(nextUserId) {
      if (started) return false;
      if (expectedUserId !== null && expectedUserId !== nextUserId) return false;
      expectedUserId = nextUserId;
      started = true;
      return true;
    },
    reset() {
      started = false;
    },
  };
}

type InvitationResolveResponse = {
  email?: unknown;
  org?: {
    id?: unknown;
    name?: unknown;
  };
};

export function parseResolvedInvitation(payload: unknown): ResolvedInvitation {
  const response =
    payload && typeof payload === "object"
      ? (payload as InvitationResolveResponse)
      : {};
  if (
    typeof response.email !== "string" ||
    response.email.trim() === "" ||
    typeof response.org?.id !== "string" ||
    response.org.id.trim() === "" ||
    typeof response.org.name !== "string" ||
    response.org.name.trim() === ""
  ) {
    throw new Error("The invitation response was incomplete. Please ask for a new invitation.");
  }

  return {
    email: response.email,
    org: {
      id: response.org.id,
      name: response.org.name,
    },
  };
}

export function hasInvitedEmail(
  user: { emailAddresses: Array<{ emailAddress: string }> } | null | undefined,
  invitedEmail: string,
): boolean {
  const expected = invitedEmail.trim().toLowerCase();
  return Boolean(
    user?.emailAddresses.some(
      ({ emailAddress }) => emailAddress.trim().toLowerCase() === expected,
    ),
  );
}

export function hasVerifiedInvitedEmail(
  user:
    | {
        emailAddresses: Array<{
          emailAddress: string;
          verification?: { status: string | null } | null;
        }>;
      }
    | null
    | undefined,
  invitedEmail: string,
): boolean {
  const expected = invitedEmail.trim().toLowerCase();
  return Boolean(
    user?.emailAddresses.some(
      ({ emailAddress, verification }) =>
        emailAddress.trim().toLowerCase() === expected &&
        verification?.status === "verified",
    ),
  );
}

export function validateSignupFields(input: {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return "Enter your first and last name.";
  }
  if (input.password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (input.password !== input.confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

/**
 * A JWT subject lets the client confirm that the freshly activated Clerk
 * session belongs to the user that was just created. It is only inspected
 * in memory and is never logged or sent as invitation data.
 */
export function getTokenSubject(token: string): string | null {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) return null;

  try {
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export type IdentityTokenGetter = (options?: {
  skipCache?: boolean;
}) => Promise<string | null>;

export async function waitForIdentityToken(
  getToken: IdentityTokenGetter,
  expectedUserId: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 100;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = await getToken({ skipCache: true });
    if (token && getTokenSubject(token) === expectedUserId) return token;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }

  return null;
}

export function invitationViewState(input: {
  resolution: InvitationResolutionState["status"];
  authLoaded: boolean;
  userLoaded: boolean;
  isSignedIn: boolean | undefined;
  hasMatchingEmail: boolean;
  hasVerifiedEmail: boolean;
  signingOut: boolean;
  signoutFailed: boolean;
  phase: InvitationSignupPhase;
}): InvitationViewState {
  if (input.resolution === "error" || input.signoutFailed) return "error";
  if (input.phase === "error") return "error";
  if (input.phase === "complete") return "complete";
  if (input.resolution !== "resolved" || !input.authLoaded || !input.userLoaded) {
    return "loading";
  }
  if (input.signingOut) return "signing-out";
  if (input.isSignedIn) {
    if (input.hasVerifiedEmail || input.hasMatchingEmail) {
      return input.hasVerifiedEmail ? "accepting" : "account-verification";
    }
    return "signing-out";
  }
  return input.phase;
}

export function invitationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("not valid for this account")) {
    return "This invitation is not valid for the current account. Sign in with the invited email.";
  }
  if (message.includes("verify the invited email")) {
    return "Verify the invited email address in Clerk before accepting this invitation.";
  }
  if (message.includes("expired") || message.includes("invalid")) {
    return "This invitation is invalid or expired.";
  }
  return "We could not accept this invitation. Please try again.";
}

export function isExistingEmailSignupError(error: unknown): boolean {
  const candidate = error as {
    errors?: Array<{ code?: unknown; message?: unknown; longMessage?: unknown }>;
  };
  const messages = candidate.errors?.flatMap((entry) =>
    [entry.code, entry.message, entry.longMessage].filter(
      (value): value is string => typeof value === "string",
    ),
  ) ?? [];
  const combined = messages.join(" ").toLowerCase();
  return (
    combined.includes("form_identifier_exists") ||
    combined.includes("identifier_exists") ||
    combined.includes("email address is already") ||
    combined.includes("already exists")
  );
}

export function clerkSignupErrorMessage(error: unknown): string {
  const candidate = error as {
    errors?: Array<{ code?: unknown; message?: unknown; longMessage?: unknown }>;
  };
  const messages = candidate.errors?.flatMap((entry) =>
    [entry.message, entry.longMessage].filter(
      (value): value is string => typeof value === "string",
    ),
  ) ?? [];
  const combined = messages.find((message) => message.trim() !== "");
  return combined ?? "We could not create this account. Please try again.";
}

export function hasCaptchaRequirement(error: unknown): boolean {
  const candidate = error as {
    errors?: Array<{ code?: unknown; message?: unknown; longMessage?: unknown }>;
  };
  const messages = candidate.errors?.flatMap((entry) =>
    [entry.code, entry.message, entry.longMessage].filter(
      (value): value is string => typeof value === "string",
    ),
  ) ?? [];
  return messages.join(" ").toLowerCase().includes("captcha");
}

export function formatMissingSignupRequirements(fields: readonly string[]): string {
  if (fields.length === 0) {
    return "Clerk has not completed the account yet. No session was activated.";
  }
  const labels = fields.map((field) =>
    field
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim(),
  );
  return `Clerk still requires: ${labels.join(", ")}. Complete those requirements before continuing.`;
}