export type CommissionPeriod = "today" | "7days" | "month" | "year";

/**
 * Keep the authenticated identity in these keys. The query client is shared
 * by the app shell, so an org key by itself could briefly expose a previous
 * user's cached response after an account switch.
 */
export function commissionSettingsQueryKey(orgId: string, identityId: string) {
  return ["commissions", "settings", orgId, identityId] as const;
}

export function earnedCommissionsQueryKey(
  orgId: string,
  identityId: string,
  period: CommissionPeriod,
) {
  return ["commissions", "earned", orgId, identityId, period] as const;
}

export function earnedCommissionsQueryRoot(orgId: string) {
  return ["commissions", "earned", orgId] as const;
}

/**
 * Product types are role-scoped: an owner receives inactive history while
 * other members receive only active classifications. Keep the authenticated
 * identity in the cache key so a window account switch cannot reuse the
 * previous member's product list.
 */
export function productTypesQueryKey(orgId: string, identityId: string) {
  return [`/api/orgs/${orgId}/product-types`, identityId] as const;
}

export function productTypesQueryRoot(orgId: string) {
  return [`/api/orgs/${orgId}/product-types`] as const;
}