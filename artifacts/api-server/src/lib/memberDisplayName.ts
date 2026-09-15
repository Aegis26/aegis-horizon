type UserName = {
  fullName?: string | null;
  email: string;
};

type MembershipName = {
  displayName?: string | null;
};

/**
 * Resolve a member label without allowing a workspace override to leak into
 * the global users identity. Generic legacy values are not useful labels and
 * should fall through to the verified email address.
 */
export function effectiveMemberDisplayName(
  membership: MembershipName,
  user: UserName,
): string {
  const override = membership.displayName?.trim();
  if (override) return override;

  const fullName = user.fullName?.trim();
  if (fullName && !isPlaceholderName(fullName, user.email)) {
    return fullName;
  }

  return user.email;
}

function isPlaceholderName(name: string, email: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === email.trim().toLowerCase() ||
    normalized === "user" ||
    normalized === "unknown" ||
    normalized === "unknown user" ||
    normalized === "team member" ||
    normalized === "employee" ||
    normalized.startsWith("pending:")
  );
}