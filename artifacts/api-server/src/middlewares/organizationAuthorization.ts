export const ORGANIZATION_ROLE_RANK = {
  viewer: 0,
  user: 1,
  manager: 2,
  admin: 3,
  owner: 4,
} as const;

export type OrganizationRole = keyof typeof ORGANIZATION_ROLE_RANK;

/**
 * Organization authorization is based exclusively on the membership loaded
 * for the requested organization. In particular, owner access is exact:
 * there is no broader application-level role that can satisfy it.
 */
export function hasRequiredOrganizationRole(
  role: string | undefined,
  minimumRole: OrganizationRole,
): boolean {
  if (minimumRole === "owner") {
    return role === "owner";
  }

  const rank = role
    ? ORGANIZATION_ROLE_RANK[role as OrganizationRole]
    : undefined;
  return rank !== undefined && rank >= ORGANIZATION_ROLE_RANK[minimumRole];
}