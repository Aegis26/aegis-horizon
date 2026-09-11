export interface AuthenticatedUserIdentity {
  clerkId?: string | null;
}

export interface OrganizationMembershipIdentity {
  org: {
    id: string;
  };
}

export function belongsToAuthenticatedUser(
  user: AuthenticatedUserIdentity | null | undefined,
  clerkUserId: string | null | undefined,
): boolean {
  return Boolean(user?.clerkId && clerkUserId && user.clerkId === clerkUserId);
}

export function hasAuthenticatedOrganizationMembership(
  memberships: readonly OrganizationMembershipIdentity[],
  orgId: string | null | undefined,
): boolean {
  return Boolean(orgId && memberships.some((membership) => membership.org.id === orgId));
}