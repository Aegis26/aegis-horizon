import { and, eq, notInArray } from "drizzle-orm";
import {
  commissions,
  employeeCommissions,
  orgUsers,
  users,
  type Opportunity,
} from "@workspace/db";
import { db } from "@workspace/db";
import {
  calculateCommissionAmount,
  normalizeCommissionPercentage,
} from "./commissionMath";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CommissionSettingInput = {
  userId: string;
  commissionPercentage: string;
  isActive: boolean;
};

/**
 * Replace the currently payable rates for an organization in one
 * transaction. Omitted settings remain visible as inactive history but can no
 * longer pay a commission.
 */
export async function replaceCommissionSettings(
  tx: DatabaseTransaction,
  orgId: string,
  settings: CommissionSettingInput[],
): Promise<void> {
  const submittedUserIds = settings.map((setting) => setting.userId);
  if (submittedUserIds.length > 0) {
    await tx
      .update(employeeCommissions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(employeeCommissions.orgId, orgId),
          notInArray(employeeCommissions.userId, submittedUserIds),
        ),
      );
  } else {
    await tx
      .update(employeeCommissions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(employeeCommissions.orgId, orgId));
  }
  for (const setting of settings) {
    const [membership] = await tx
      .select({ id: orgUsers.id })
      .from(orgUsers)
      .where(
        and(eq(orgUsers.orgId, orgId), eq(orgUsers.userId, setting.userId)),
      )
      .limit(1);
    if (!membership) {
      throw new Error("Every commission setting userId must be an active organization member");
    }
    await tx
      .insert(employeeCommissions)
      .values({
        orgId,
        userId: setting.userId,
        commissionPercentage: setting.commissionPercentage,
        isActive: setting.isActive,
      })
      .onConflictDoUpdate({
        target: [employeeCommissions.orgId, employeeCommissions.userId],
        set: {
          commissionPercentage: setting.commissionPercentage,
          isActive: setting.isActive,
          updatedAt: new Date(),
        },
      });
  }
}

export async function removeEmployeeCommissionForMembership(
  tx: DatabaseTransaction,
  orgId: string,
  userId: string,
): Promise<void> {
  await tx
    .delete(employeeCommissions)
    .where(
      and(
        eq(employeeCommissions.orgId, orgId),
        eq(employeeCommissions.userId, userId),
      ),
    );
}

export function isClosedWonOpportunity(
  opportunity: Pick<Opportunity, "stage" | "forecastCategory">,
): boolean {
  const stage = opportunity.stage.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (
    opportunity.forecastCategory === "closed_won" ||
    stage === "closed_won" ||
    stage === "closedwon"
  );
}

/**
 * Record the first transition into Closed Won inside the caller's
 * transaction.  The caller must lock the opportunity row before invoking
 * this function; this ensures concurrent close requests see one ordered
 * snapshot and makes the unique ledger key a final idempotency fence.
 */
export async function recordCommissionForClosedWon(
  tx: DatabaseTransaction,
  previous: Pick<Opportunity, "stage" | "forecastCategory"> | null,
  next: Pick<
    Opportunity,
    | "id"
    | "orgId"
    | "stage"
    | "forecastCategory"
    | "ownerUserId"
    | "name"
    | "value"
  >,
  earnedDate = new Date(),
): Promise<void> {
  if (!isClosedWonOpportunity(next) || (previous && isClosedWonOpportunity(previous))) {
    return;
  }
  if (!next.ownerUserId) return;

  // Reopen/reclose and retried requests must not alter the original record.
  const [existing] = await tx
    .select({ id: commissions.id })
    .from(commissions)
    .where(
      and(
        eq(commissions.orgId, next.orgId),
        eq(commissions.opportunityId, next.id),
      ),
    )
    .limit(1);
  if (existing) return;

  // Settings are usable only while the employee still has an active
  // membership in this organization.  The inner joins also prevent stale
  // settings left behind by member-removal semantics from paying a commission.
  const [setting] = await tx
    .select({
      percentage: employeeCommissions.commissionPercentage,
      employeeName: users.fullName,
      employeeEmail: users.email,
    })
    .from(employeeCommissions)
    .innerJoin(
      orgUsers,
      and(
        eq(orgUsers.orgId, employeeCommissions.orgId),
        eq(orgUsers.userId, employeeCommissions.userId),
      ),
    )
    .innerJoin(users, eq(users.id, employeeCommissions.userId))
    .where(
      and(
        eq(employeeCommissions.orgId, next.orgId),
        eq(employeeCommissions.userId, next.ownerUserId),
        eq(employeeCommissions.isActive, true),
      ),
    )
    .limit(1);
  if (!setting) return;

  const percentage = normalizeCommissionPercentage(setting.percentage);
  // An active rate with an invalid/missing deal value is an explicit financial
  // failure.  Throwing rolls back the opportunity update instead of silently
  // creating a won deal without its configured commission.
  const calculated = calculateCommissionAmount(next.value, percentage);
  await tx.insert(commissions).values({
    orgId: next.orgId,
    userId: next.ownerUserId,
    employeeName: setting.employeeName?.trim() || setting.employeeEmail,
    opportunityId: next.id,
    opportunityName: next.name,
    opportunityValue: calculated.opportunityValue,
    commissionPercentage: percentage,
    commissionAmount: calculated.commissionAmount,
    earnedDate,
  });
}
