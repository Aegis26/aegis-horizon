import type { Request } from "express";
import {
  and,
  eq,
  isNotNull,
  or,
  sql,
  type SQL,
  type AnyColumn,
} from "drizzle-orm";
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

/**
 * Build the row predicate for a CRM resource.
 *
 * Owners, admins, and managers have organization-wide visibility. Regular
 * users retain access after reassignment when they created a row, but only
 * rows with a non-null owner are eligible. Viewers deliberately do not get
 * creator access: they can read only rows they currently own.
 */
export function crmVisibility(
  req: Request,
  ownerColumn: AnyColumn,
  createdByColumn: AnyColumn,
): SQL | undefined {
  if (hasCrmManagementAccess(req)) return undefined;
  const userId = req.currentUser!.id;
  if (req.currentMembership?.role === "viewer") {
    return and(isNotNull(ownerColumn), eq(ownerColumn, userId));
  }
  if (req.currentMembership?.role !== "user") {
    // The membership role is a database enum, but fail closed if an invalid
    // value ever reaches this helper instead of broadening visibility.
    return sql`false`;
  }
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
    const [contact] = await db
      .select({ id: contacts.id, accountId: contacts.accountId })
      .from(contacts)
      .where(crmRecordCondition(req, type, id));
    return Boolean(
      contact && (await canAccessCrmRecord(req, "account", contact.accountId)),
    );
  }
  if (type === "opportunity") {
    const [opportunity] = await db
      .select({ id: opportunities.id, accountId: opportunities.accountId })
      .from(opportunities)
      .where(crmRecordCondition(req, type, id));
    return Boolean(
      opportunity &&
        (await canAccessCrmRecord(req, "account", opportunity.accountId)),
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