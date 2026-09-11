import type { Request } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  customReports,
  db,
  documentVersions,
  documents,
  orgUsers,
  reportExports,
  users,
} from "@workspace/db";
import type { ObjectAclPolicy } from "../lib/objectAcl";
import {
  canAccessCrmRecord,
  hasCrmManagementAccess,
} from "./crmAccess";

const MANAGEMENT_ROLES = new Set(["owner", "admin", "manager"]);

type ObjectBindingAuthorization = {
  /**
   * A binding is true when the object path is referenced by a known logical
   * document version or report export.  A known-but-unauthorized binding must
   * not fall through to the ACL owner check.
   */
  bound: boolean;
  allowed: boolean;
};

function scopedRequest(
  req: Request,
  userId: string,
  role: string,
  orgId: string,
): Request {
  // The storage route intentionally does not use attachOrg because an object
  // path has no orgId parameter.  CRM access still needs the same request
  // context as an ordinary org route, so provide a narrow scoped context for
  // each candidate organization.
  const scoped = Object.create(req) as Request;
  scoped.currentUser = { id: userId } as Request["currentUser"];
  scoped.currentMembership = { role } as Request["currentMembership"];
  scoped.currentOrg = { id: orgId } as Request["currentOrg"];
  return scoped;
}

/**
 * Authorize the database owner of a private object after its object-storage
 * ACL has passed.
 *
 * Object ACLs intentionally grant ORG_MEMBER read access for convenience, but
 * that is not sufficient for derived files: report exports are manager-only,
 * and document bytes inherit the document's CRM/creator visibility.  This
 * helper closes that second, logical-row boundary for both direct object GETs
 * and redirects from the report/document routers.
 */
export async function authorizePrivateObjectBinding(
  req: Request,
  objectPath: string,
  clerkUserId: string,
  aclPolicy: ObjectAclPolicy,
): Promise<ObjectBindingAuthorization> {
  const [localUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkUserId));

  const [documentBindings, reportBindings] = await Promise.all([
    db
      .select({
        orgId: documentVersions.orgId,
        documentId: documents.id,
        accountId: documents.accountId,
        opportunityId: documents.opportunityId,
        createdByUserId: documents.createdByUserId,
      })
      .from(documentVersions)
      .innerJoin(
        documents,
        and(
          eq(documents.id, documentVersions.documentId),
          eq(documents.orgId, documentVersions.orgId),
        ),
      )
      .where(eq(documentVersions.objectPath, objectPath)),
    db
      .select({
        orgId: reportExports.orgId,
        reportId: customReports.id,
        status: reportExports.status,
      })
      .from(reportExports)
      .leftJoin(
        customReports,
        and(
          eq(customReports.id, reportExports.reportId),
          eq(customReports.orgId, reportExports.orgId),
        ),
      )
      .where(eq(reportExports.objectPath, objectPath)),
  ]);

  const bound = documentBindings.length > 0 || reportBindings.length > 0;
  const orgIds = [
    ...new Set([
      ...documentBindings.map((binding) => binding.orgId),
      ...reportBindings.map((binding) => binding.orgId),
    ]),
  ];
  if (orgIds.length === 0) {
    // A user-owned object uploaded before it is associated with a document is
    // safe to read only by that exact object ACL owner.  Management users may
    // also read an unbound object shared with one of their organizations;
    // regular users must not use a broad ORG_MEMBER rule as a row predicate.
    if (aclPolicy.owner === clerkUserId) {
      return { bound: false, allowed: true };
    }
    if (!localUser) return { bound: false, allowed: false };
    const aclOrgIds = [
      ...new Set(
        (aclPolicy.aclRules ?? [])
          .filter((rule) => rule.group.type === "ORG_MEMBER")
          .map((rule) => rule.group.id),
      ),
    ];
    if (aclOrgIds.length === 0) return { bound: false, allowed: false };
    const managementMemberships = await db
      .select({ role: orgUsers.role })
      .from(orgUsers)
      .where(
        and(
          eq(orgUsers.userId, localUser.id),
          inArray(orgUsers.orgId, aclOrgIds),
        ),
      );
    return {
      bound: false,
      allowed: managementMemberships.some((membership) =>
        MANAGEMENT_ROLES.has(membership.role),
      ),
    };
  }
  if (!localUser) {
    return { bound, allowed: false };
  }

  const memberships = await db
    .select({ orgId: orgUsers.orgId, role: orgUsers.role })
    .from(orgUsers)
    .where(
      and(
        eq(orgUsers.userId, localUser.id),
        inArray(orgUsers.orgId, orgIds),
      ),
    );

  for (const binding of documentBindings) {
    const membership = memberships.find((item) => item.orgId === binding.orgId);
    if (!membership) continue;

    const candidate = scopedRequest(
      req,
      localUser.id,
      membership.role,
      binding.orgId,
    );
    if (hasCrmManagementAccess(candidate)) return { bound: true, allowed: true };

    // This mirrors documentVisibility: every populated CRM parent must be
    // visible. Creator access is intentionally only for an unlinked document;
    // it must not bypass an inaccessible account or opportunity parent.
    const hasAccount = Boolean(binding.accountId);
    const hasOpportunity = Boolean(binding.opportunityId);
    const accountVisible =
      !hasAccount ||
      (await canAccessCrmRecord(candidate, "account", binding.accountId!));
    const opportunityVisible =
      !hasOpportunity ||
      (await canAccessCrmRecord(
        candidate,
        "opportunity",
        binding.opportunityId!,
      ));
    if (
      accountVisible &&
      opportunityVisible &&
      (hasAccount ||
        hasOpportunity ||
        (membership.role !== "viewer" &&
          binding.createdByUserId === localUser.id))
    ) {
      return { bound: true, allowed: true };
    }
  }

  for (const binding of reportBindings) {
    const membership = memberships.find((item) => item.orgId === binding.orgId);
    // A report export is valid only while its report still exists.  A
    // left-join row with a null reportId is a known-but-stale binding and is
    // deliberately denied.
    if (
      !membership ||
      !binding.reportId ||
      binding.status !== "completed"
    ) continue;
    if (MANAGEMENT_ROLES.has(membership.role)) {
      return { bound: true, allowed: true };
    }
  }

  // A known binding which did not pass its row predicate must never use the
  // object ACL's broader ORG_MEMBER permission as a fallback.
  return { bound, allowed: false };
}