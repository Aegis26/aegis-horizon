import type { Request } from "express";
import { and, eq, isNotNull, or, type SQL, type AnyColumn } from "drizzle-orm";
import { accounts, contacts, db, leads, opportunities } from "@workspace/db";

const MANAGEMENT_ROLES = new Set(["owner", "admin", "manager"]);
const READ_ONLY_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CrmRecordType = "account" | "contact" | "opportunity" | "lead";

export function isViewerMutation(role: string | undefined, method: string): boolean {
  return role === "viewer" && !READ_ONLY_HTTP_METHODS.has(method);
}

export function hasCrmManagementAccess(req: Request): boolean {
  return MANAGEMENT_ROLES.has(req.currentMembership?.role ?? "");
}

/** Management sees every tenant row; others see rows they own or created. */
export function crmVisibility(
  req: Request,
  ownerColumn: AnyColumn,
  createdByColumn: AnyColumn,
): SQL | undefined {
  if (hasCrmManagementAccess(req)) return undefined;
  const userId = req.currentUser!.id;
  return and(
    isNotNull(ownerColumn),
    or(eq(ownerColumn, userId), eq(createdByColumn, userId)),
  );
}

export function withCrmVisibility(
  req: Request,
  ownerColumn: AnyColumn,
  createdByColumn: AnyColumn,
): SQL[] {
  const visibility = crmVisibility(req, ownerColumn, createdByColumn);
  return visibility ? [visibility] : [];
}

export function crmRecordCondition(
  req: Request,
  type: CrmRecordType,
  id: string,
): SQL {
  const orgId = req.currentOrg!.id;
  if (type === "account") {
    return and(
      eq(accounts.id, id),
      eq(accounts.orgId, orgId),
      ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
    )!;
  }
  if (type === "contact") {
    return and(
      eq(contacts.id, id),
      eq(contacts.orgId, orgId),
      ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
    )!;
  }
  if (type === "opportunity") {
    return and(
      eq(opportunities.id, id),
      eq(opportunities.orgId, orgId),
      ...withCrmVisibility(
        req,
        opportunities.ownerUserId,
        opportunities.createdByUserId,
      ),
    )!;
  }
  return and(
    eq(leads.id, id),
    eq(leads.orgId, orgId),
    ...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId),
  )!;
}

/** Returns false rather than disclosing whether an inaccessible row exists. */
export async function canAccessCrmRecord(
  req: Request,
  type: CrmRecordType,
  id: string,
): Promise<boolean> {
  if (type === "account") {
    return Boolean(
      (
        await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(crmRecordCondition(req, type, id))
      )[0],
    );
  }
  if (type === "contact") {
    return Boolean(
      (
        await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(crmRecordCondition(req, type, id))
      )[0],
    );
  }
  if (type === "opportunity") {
    return Boolean(
      (
        await db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(crmRecordCondition(req, type, id))
      )[0],
    );
  }
  return Boolean(
    (
      await db
        .select({ id: leads.id })
        .from(leads)
        .where(crmRecordCondition(req, type, id))
    )[0],
  );
}