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