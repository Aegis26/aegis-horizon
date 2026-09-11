import type { Request } from "express";
import { and, eq, exists, isNull, or, type SQL } from "drizzle-orm";
import { accounts, db, opportunities, tasks } from "@workspace/db";
import {
  hasCrmManagementAccess,
  withCrmVisibility,
} from "./crmAccess";

/**
 * Build the task visibility boundary used by GET and task mutations.
 * Keeping this predicate in the UPDATE's WHERE clause prevents an ID-only
 * mutation from changing another user's task between a check and the write.
 */
export function taskVisibilityCondition(req: Request): SQL | undefined {
  if (hasCrmManagementAccess(req)) return undefined;

  const userId = req.currentUser!.id;
  const ownership =
    req.currentMembership?.role === "viewer"
      ? eq(tasks.assignedToUserId, userId)
      : or(
          eq(tasks.assignedToUserId, userId),
          eq(tasks.createdByUserId, userId),
        );
  const accountVisible = or(
    isNull(tasks.accountId),
    exists(
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.id, tasks.accountId),
            eq(accounts.orgId, req.currentOrg!.id),
            ...withCrmVisibility(
              req,
              accounts.ownerUserId,
              accounts.createdByUserId,
            ),
          ),
        ),
    ),
  );
  const opportunityVisible = or(
    isNull(tasks.opportunityId),
    exists(
      db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, tasks.opportunityId),
            eq(opportunities.orgId, req.currentOrg!.id),
            ...withCrmVisibility(
              req,
              opportunities.ownerUserId,
              opportunities.createdByUserId,
            ),
            // canAccessCrmRecord(opportunity) also requires its parent
            // account to be visible.  Keep task mutations aligned with that
            // point-access predicate, even when task.accountId is null or
            // points at a different account.
            exists(
              db
                .select({ id: accounts.id })
                .from(accounts)
                .where(
                  and(
                    eq(accounts.id, opportunities.accountId),
                    eq(accounts.orgId, req.currentOrg!.id),
                    ...withCrmVisibility(
                      req,
                      accounts.ownerUserId,
                      accounts.createdByUserId,
                    ),
                  ),
                ),
            ),
          ),
        ),
    ),
  );
  return and(ownership, accountVisible, opportunityVisible);
}