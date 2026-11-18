import type { QueryClient } from "@tanstack/react-query";
import {
  getListLeadQueueQueryKey, getListLeadsQueryKey, getListAccountsQueryKey, getGetOrgDashboardQueryKey,
} from "@workspace/api-client-react";

export const LEAD_QUEUE_POLL_MS = 15000;

export const LEAD_TYPE_LABELS: Record<string, string> = {
  web_dev: "Web development",
  cyber: "Cybersecurity",
  both: "Both",
};

export const DISMISS_REASONS = ["not a fit", "duplicate", "existing client"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

/** Invalidates every lead-queue variant (any params) plus related lists for an org. */
export function invalidateLeadQueue(queryClient: QueryClient, orgId: string) {
  const prefix = getListLeadQueueQueryKey(orgId)[0];
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === prefix });
  void queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(orgId) });
  void queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(orgId) });
  void queryClient.invalidateQueries({ queryKey: getGetOrgDashboardQueryKey(orgId) });
}

export function queueErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: unknown } } | null)?.data;
  if (data && typeof data.error === "string" && data.error) return data.error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isConflict(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 409;
}
