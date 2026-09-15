import { and, eq, isNull } from "drizzle-orm";
import {
  commissions,
  employeeCommissions,
  orgUsers,
  organizations,
  productTypes,
  users,
  type Opportunity,
} from "@workspace/db";
import { db } from "@workspace/db";
import {
  calculateCommissionAmount,
  normalizeCommissionPercentage,
} from "./commissionMath";
import { effectiveMemberDisplayName } from "../lib/memberDisplayName";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CommissionSettingInput = {
  userId: string;
  /** Optional only for internal legacy callers; API rows always send null. */
  productTypeId?: string | null;
  commissionPercentage: string;
  isActive: boolean;
};

/**
 * Replace the currently payable rates for an organization in one transaction.
 * Omitted user/product keys remain visible as inactive history but can no
 * longer pay a commission.
 */
export async function replaceCommissionSettings(
  tx: DatabaseTransaction,
  orgId: string,
  settings: CommissionSettingInput[],
): Promise<void> {
  // Replacement is a read/deactivate/upsert operation. Locking the tenant
  // row makes the whole replacement one serialized per-organization unit:
  // concurrent first saves cannot both observe a missing key, and a later
  // save cannot reactivate a key omitted by an earlier save.
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for("update");
  if (!organization) {
    throw new Error("Commission settings organization was not found");
  }

  // Replacement semantics are keyed by (user, product), not by employee.
  // Deactivate first so omitted rows retain history without remaining payable.
  await tx
    .update(employeeCommissions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(employeeCommissions.orgId, orgId));

  for (const setting of settings) {
    const productTypeId = setting.productTypeId ?? null;
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

    const existing = await tx
      .select({ id: employeeCommissions.id })
      .from(employeeCommissions)
      .where(
        and(
          eq(employeeCommissions.orgId, orgId),
          eq(employeeCommissions.userId, setting.userId),
          productTypeId === null
            ? isNull(employeeCommissions.productTypeId)
            : eq(employeeCommissions.productTypeId, productTypeId),
        ),
      )
      .limit(1);

    if (productTypeId !== null) {
      const [product] = await tx
        .select({ id: productTypes.id, isActive: productTypes.isActive })
        .from(productTypes)
        .where(
          and(
            eq(productTypes.id, productTypeId),
            eq(productTypes.orgId, orgId),
          ),
        )
        .limit(1)
        .for("update");
      // Existing rows are retained when an owner deactivates a product so a
      // settings replacement can round-trip the complete grid. The
      // commission calculator still excludes the inactive product. A new
      // employee/product key must reference an active product.
      if (!product) {
        throw new Error(
          "Every productTypeId must reference a product in this organization",
        );
      }
      if (!product.isActive && !existing[0]) {
        throw new Error(
          "Every productTypeId must reference an active product in this organization",
        );
      }
    }
    if (existing[0]) {
      await tx
        .update(employeeCommissions)
        .set({
          commissionPercentage: setting.commissionPercentage,
          isActive: setting.isActive,
          updatedAt: new Date(),
        })
        .where(eq(employeeCommissions.id, existing[0].id));
    } else {
      await tx.insert(employeeCommissions).values({
        orgId,
        userId: setting.userId,
        productTypeId,
        commissionPercentage: setting.commissionPercentage,
        isActive: setting.isActive,
      });
    }
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
    | "productTypeId"
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

  let productTypeName: string | null = null;
  if (next.productTypeId) {
    // Classified deals never fall back to a general rate. Deactivation also
    // makes a product ineligible for new earnings while preserving its
    // historical opportunity/ledger reference.
    const [product] = await tx
      .select({ name: productTypes.name })
      .from(productTypes)
      .where(
        and(
          eq(productTypes.id, next.productTypeId),
          eq(productTypes.orgId, next.orgId),
          eq(productTypes.isActive, true),
        ),
      )
      .limit(1)
      .for("update");
    if (!product) return;
    productTypeName = product.name;
  }

  // Settings are usable only while the employee still has an active
  // membership in this organization.  The inner joins also prevent stale
  // settings left behind by member-removal semantics from paying a commission.
  const [setting] = await tx
    .select({
      percentage: employeeCommissions.commissionPercentage,
      displayName: orgUsers.displayName,
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
        next.productTypeId
          ? eq(employeeCommissions.productTypeId, next.productTypeId)
          : isNull(employeeCommissions.productTypeId),
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
    employeeName: effectiveMemberDisplayName(
      { displayName: setting.displayName },
      { fullName: setting.employeeName, email: setting.employeeEmail },
    ),
    opportunityId: next.id,
    opportunityName: next.name,
    opportunityValue: calculated.opportunityValue,
    commissionPercentage: percentage,
    commissionAmount: calculated.commissionAmount,
    productTypeId: next.productTypeId ?? null,
    productTypeName,
    earnedDate,
  });
}
