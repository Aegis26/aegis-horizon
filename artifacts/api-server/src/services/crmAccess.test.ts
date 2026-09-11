import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import {
  accounts,
  contacts,
  db,
  leads,
  opportunities,
  orgUsers,
  organizations,
  segments,
  users,
} from "@workspace/db";
import { segmentVisibilityScope } from "../routes/crm";
import {
  crmRecordCondition,
  crmVisibility,
  hasCrmManagementAccess,
  isViewerMutation,
  withCrmVisibility,
} from "./crmAccess";

function request(role: string, userId = "user-a", orgId = "org-a"): Request {
  return {
    currentMembership: { role },
    currentUser: { id: userId },
    currentOrg: { id: orgId },
  } as Request;
}

test("management roles receive organization-wide CRM visibility", () => {
  for (const role of ["owner", "admin", "manager"]) {
    const req = request(role);
    assert.equal(hasCrmManagementAccess(req), true);
    assert.equal(
      crmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
      undefined,
    );
  }
});

test("users require a non-null owner and owner-or-creator match", () => {
  const query = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(crmRecordCondition(request("user"), "account", "account-a"))
    .toSQL();
  const sql = query.sql.replaceAll('"', "");

  assert.match(sql, /accounts\.id = \$1/);
  assert.match(sql, /accounts\.org_id = \$2/);
  assert.match(sql, /accounts\.owner_user_id is not null/);
  assert.match(sql, /accounts\.owner_user_id = \$3/);
  assert.match(sql, /accounts\.created_by_user_id = \$4/);
  assert.deepEqual(query.params, [
    "account-a",
    "org-a",
    "user-a",
    "user-a",
  ]);
});

test("viewers require a non-null owner and current ownership only", () => {
  const query = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(crmRecordCondition(request("viewer"), "account", "account-a"))
    .toSQL();
  const sql = query.sql.replaceAll('"', "");

  assert.match(sql, /accounts\.id = \$1/);
  assert.match(sql, /accounts\.org_id = \$2/);
  assert.match(sql, /accounts\.owner_user_id is not null/);
  assert.match(sql, /accounts\.owner_user_id = \$3/);
  assert.doesNotMatch(sql, /created_by_user_id/);
  assert.deepEqual(query.params, ["account-a", "org-a", "user-a"]);
});

test("creator access remains part of the predicate after reassignment", () => {
  const query = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(crmRecordCondition(request("user", "creator-a"), "account", "record-a"))
    .toSQL();

  assert.equal(query.params.filter((value) => value === "creator-a").length, 2);
  assert.match(query.sql.replaceAll('"', ""), /owner_user_id = \$3 or accounts\.created_by_user_id = \$4/);
});

test("employee opportunity queries are scoped to owner or creator, not the organization owner", () => {
  const query = db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      crmRecordCondition(
        request("user", "employee-a", "org-a"),
        "opportunity",
        "opportunity-a",
      ),
    )
    .toSQL();
  const sql = query.sql.replaceAll('"', "");

  assert.match(sql, /opportunities\.id = \$1/);
  assert.match(sql, /opportunities\.org_id = \$2/);
  assert.match(sql, /opportunities\.owner_user_id is not null/);
  assert.match(sql, /opportunities\.owner_user_id = \$3/);
  assert.match(sql, /opportunities\.created_by_user_id = \$4/);
  assert.deepEqual(query.params, [
    "opportunity-a",
    "org-a",
    "employee-a",
    "employee-a",
  ]);
});

test("viewer lead queries use assigned ownership without creator fallback", () => {
  const query = db
    .select({ id: leads.id })
    .from(leads)
    .where(crmRecordCondition(request("viewer"), "lead", "lead-a"))
    .toSQL();
  const sql = query.sql.replaceAll('"', "");

  assert.match(sql, /leads\.id = \$1/);
  assert.match(sql, /leads\.org_id = \$2/);
  assert.match(sql, /leads\.assigned_to_user_id is not null/);
  assert.match(sql, /leads\.assigned_to_user_id = \$3/);
  assert.doesNotMatch(sql, /created_by_user_id/);
  assert.deepEqual(query.params, ["lead-a", "org-a", "user-a"]);
});

test("dashboard account and opportunity counts reuse employee row visibility", () => {
  const req = request("user", "employee-a", "org-a");
  const accountQuery = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(crmRecordCondition(req, "account", "account-a"))
    .toSQL();
  const opportunityQuery = db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(crmRecordCondition(req, "opportunity", "opportunity-a"))
    .toSQL();

  assert.match(accountQuery.sql.replaceAll('"', ""), /owner_user_id = \$3/);
  assert.match(opportunityQuery.sql.replaceAll('"', ""), /owner_user_id = \$3/);
  assert.equal(accountQuery.params.includes("owner-a"), false);
  assert.equal(opportunityQuery.params.includes("owner-a"), false);
});

test("point-access conditions always include record and organization scope", () => {
  const query = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      crmRecordCondition(
        request("manager", "manager-a", "tenant-a"),
        "account",
        "record-a",
      ),
    )
    .toSQL();

  assert.deepEqual(query.params, ["record-a", "tenant-a"]);
  assert.match(query.sql.replaceAll('"', ""), /accounts\.id = \$1/);
  assert.match(query.sql.replaceAll('"', ""), /accounts\.org_id = \$2/);
});

test("viewer access is read-only for every mutating HTTP method", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isViewerMutation("viewer", method), false);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isViewerMutation("viewer", method), true);
  }
  assert.equal(isViewerMutation("user", "POST"), false);
});

test("segment lookup and mutations share creator-or-management scope", () => {
  const employee = request("user", "employee-a", "org-a");
  const manager = request("manager", "manager-a", "org-a");
  const segmentId = "segment-a";
  const employeeList = db
    .select({ id: segments.id })
    .from(segments)
    .where(and(...segmentVisibilityScope(employee)))
    .toSQL();
  const employeeLookup = db
    .select({ id: segments.id })
    .from(segments)
    .where(and(...segmentVisibilityScope(employee, segmentId)))
    .toSQL();
  const employeeUpdate = db
    .update(segments)
    .set({ name: "updated" })
    .where(and(...segmentVisibilityScope(employee, segmentId)))
    .toSQL();
  const employeeDelete = db
    .delete(segments)
    .where(and(...segmentVisibilityScope(employee, segmentId)))
    .toSQL();
  const managerUpdate = db
    .update(segments)
    .set({ name: "updated" })
    .where(and(...segmentVisibilityScope(manager, segmentId)))
    .toSQL();

  for (const query of [employeeList, employeeLookup, employeeUpdate, employeeDelete]) {
    assert.match(query.sql.replaceAll('"', ""), /segments\.org_id/);
    assert.match(query.sql.replaceAll('"', ""), /segments\.created_by_user_id/);
    assert.ok(query.params.includes("employee-a"));
  }
  assert.match(employeeLookup.sql.replaceAll('"', ""), /segments\.id/);
  assert.match(employeeUpdate.sql.replaceAll('"', ""), /segments\.id/);
  assert.match(employeeDelete.sql.replaceAll('"', ""), /segments\.id/);
  assert.match(managerUpdate.sql.replaceAll('"', ""), /segments\.org_id/);
  assert.match(managerUpdate.sql.replaceAll('"', ""), /segments\.id/);
  assert.doesNotMatch(managerUpdate.sql.replaceAll('"', ""), /created_by_user_id/);
  assert.equal(managerUpdate.params[0], "updated");
  assert.deepEqual(managerUpdate.params.slice(-2), ["org-a", "segment-a"]);
});

test(
  "development DB integration: role visibility and denied details use synthetic rows",
  { skip: !process.env.DATABASE_URL ? "DATABASE_URL is unavailable" : false },
  async () => {
    const suffix = randomUUID();
    const orgId = randomUUID();
    const ownerId = randomUUID();
    const employeeId = randomUUID();
    const viewerId = randomUUID();
    const ownerAccountId = randomUUID();
    const employeeAccountId = randomUUID();
    const viewerAccountId = randomUUID();
    const viewerCreatorAccountId = randomUUID();
    const unownedAccountId = randomUUID();
    const ownerOpportunityId = randomUUID();
    const employeeOpportunityId = randomUUID();
    const viewerOpportunityId = randomUUID();
    const viewerCreatorOpportunityId = randomUUID();
    const unownedOpportunityId = randomUUID();
    const ownerContactId = randomUUID();
    const employeeContactId = randomUUID();
    const viewerContactId = randomUUID();
    const viewerCreatorContactId = randomUUID();
    const unownedContactId = randomUUID();
    const ownerLeadId = randomUUID();
    const employeeLeadId = randomUUID();
    const viewerLeadId = randomUUID();
    const viewerCreatorLeadId = randomUUID();
    const unownedLeadId = randomUUID();
    const initialEmployeeAccountId = randomUUID();

    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
    async function accountIds(tx: Tx, req: Request) {
      return (
        await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.orgId, orgId),
              ...withCrmVisibility(
                req,
                accounts.ownerUserId,
                accounts.createdByUserId,
              ),
            ),
          )
      ).map(({ id }) => id);
    }
    async function opportunityIds(tx: Tx, req: Request) {
      return (
        await tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.orgId, orgId),
              ...withCrmVisibility(
                req,
                opportunities.ownerUserId,
                opportunities.createdByUserId,
              ),
            ),
          )
      ).map(({ id }) => id);
    }
    async function contactIds(tx: Tx, req: Request) {
      return (
        await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.orgId, orgId),
              ...withCrmVisibility(
                req,
                contacts.ownerUserId,
                contacts.createdByUserId,
              ),
            ),
          )
      ).map(({ id }) => id);
    }
    async function leadIds(tx: Tx, req: Request) {
      return (
        await tx
          .select({ id: leads.id })
          .from(leads)
          .where(
            and(
              eq(leads.orgId, orgId),
              ...withCrmVisibility(
                req,
                leads.assignedToUserId,
                leads.createdByUserId,
              ),
            ),
          )
      ).map(({ id }) => id);
    }
    async function detailExists(
      tx: Tx,
      req: Request,
      type: "account" | "contact" | "opportunity" | "lead",
      id: string,
    ) {
      if (type === "account") {
        return Boolean(
          (
            await tx
              .select({ id: accounts.id })
              .from(accounts)
              .where(crmRecordCondition(req, type, id))
          )[0],
        );
      }
      if (type === "contact") {
        return Boolean(
          (
            await tx
              .select({ id: contacts.id })
              .from(contacts)
              .where(crmRecordCondition(req, type, id))
          )[0],
        );
      }
      if (type === "opportunity") {
        return Boolean(
          (
            await tx
              .select({ id: opportunities.id })
              .from(opportunities)
              .where(crmRecordCondition(req, type, id))
          )[0],
        );
      }
      return Boolean(
        (
          await tx
            .select({ id: leads.id })
            .from(leads)
            .where(crmRecordCondition(req, type, id))
        )[0],
      );
    }

    const ownerRequest = request("owner", ownerId, orgId);
    const employeeRequest = request("user", employeeId, orgId);
    const viewerRequest = request("viewer", viewerId, orgId);
    const rollback = Symbol("rollback synthetic CRM access rows");
    let observed:
      | {
          employeeInitial: string[];
          ownerAccounts: string[];
          employeeAccounts: string[];
          ownerOpportunities: string[];
          employeeOpportunities: string[];
          ownerContacts: string[];
          employeeContacts: string[];
          ownerLeads: string[];
          employeeLeads: string[];
          viewerAccounts: string[];
          viewerOpportunities: string[];
          viewerContacts: string[];
          viewerLeads: string[];
          employeeDeniedDetails: boolean[];
          viewerDeniedDetails: boolean[];
        }
      | undefined;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(organizations).values({
          id: orgId,
          name: `CRM access regression ${suffix}`,
          slug: `crm-access-regression-${suffix}`,
        });
        await tx.insert(users).values([
          {
            id: ownerId,
            clerkId: `crm-access-owner-${suffix}`,
            email: `crm-access-owner-${suffix}@example.invalid`,
            fullName: "Synthetic owner",
          },
          {
            id: employeeId,
            clerkId: `crm-access-employee-${suffix}`,
            email: `crm-access-employee-${suffix}@example.invalid`,
            fullName: "Synthetic employee",
          },
          {
            id: viewerId,
            clerkId: `crm-access-viewer-${suffix}`,
            email: `crm-access-viewer-${suffix}@example.invalid`,
            fullName: "Synthetic viewer",
          },
        ]);
        await tx.insert(orgUsers).values([
          { orgId, userId: ownerId, role: "owner" },
          { orgId, userId: employeeId, role: "user" },
          { orgId, userId: viewerId, role: "viewer" },
        ]);
        await tx.insert(accounts).values([
          {
            id: ownerAccountId,
            orgId,
            name: "Synthetic owner account",
            ownerUserId: ownerId,
            createdByUserId: ownerId,
          },
          {
            id: initialEmployeeAccountId,
            orgId,
            name: "Synthetic initial employee account",
            ownerUserId: ownerId,
            createdByUserId: ownerId,
          },
          {
            id: viewerAccountId,
            orgId,
            name: "Synthetic viewer account",
            ownerUserId: viewerId,
            createdByUserId: ownerId,
          },
          {
            id: viewerCreatorAccountId,
            orgId,
            name: "Synthetic viewer creator-only account",
            ownerUserId: ownerId,
            createdByUserId: viewerId,
          },
          {
            id: unownedAccountId,
            orgId,
            name: "Synthetic unowned account",
            ownerUserId: null,
            createdByUserId: viewerId,
          },
        ]);

        observed = {
          employeeInitial: await accountIds(tx, employeeRequest),
          ownerAccounts: [],
          employeeAccounts: [],
          ownerOpportunities: [],
          employeeOpportunities: [],
          ownerContacts: [],
          employeeContacts: [],
          ownerLeads: [],
          employeeLeads: [],
          viewerAccounts: [],
          viewerOpportunities: [],
          viewerContacts: [],
          viewerLeads: [],
          employeeDeniedDetails: [],
          viewerDeniedDetails: [],
        };

        await tx.insert(accounts).values({
          id: employeeAccountId,
          orgId,
          name: "Synthetic employee account",
          ownerUserId: employeeId,
          createdByUserId: ownerId,
        });
        await tx.insert(opportunities).values([
          {
            id: ownerOpportunityId,
            orgId,
            accountId: ownerAccountId,
            name: "Synthetic owner opportunity",
            stage: "qualification",
            ownerUserId: ownerId,
            createdByUserId: ownerId,
          },
          {
            id: employeeOpportunityId,
            orgId,
            accountId: employeeAccountId,
            name: "Synthetic employee opportunity",
            stage: "qualification",
            ownerUserId: employeeId,
            createdByUserId: ownerId,
          },
          {
            id: viewerOpportunityId,
            orgId,
            accountId: viewerAccountId,
            name: "Synthetic viewer opportunity",
            stage: "qualification",
            ownerUserId: viewerId,
            createdByUserId: ownerId,
          },
          {
            id: viewerCreatorOpportunityId,
            orgId,
            accountId: viewerCreatorAccountId,
            name: "Synthetic viewer creator-only opportunity",
            stage: "qualification",
            ownerUserId: ownerId,
            createdByUserId: viewerId,
          },
          {
            id: unownedOpportunityId,
            orgId,
            accountId: unownedAccountId,
            name: "Synthetic unowned opportunity",
            stage: "qualification",
            ownerUserId: null,
            createdByUserId: viewerId,
          },
        ]);
        await tx.insert(contacts).values([
          {
            id: ownerContactId,
            orgId,
            accountId: ownerAccountId,
            firstName: "Synthetic",
            lastName: "Owner contact",
            ownerUserId: ownerId,
            createdByUserId: ownerId,
          },
          {
            id: employeeContactId,
            orgId,
            accountId: employeeAccountId,
            firstName: "Synthetic",
            lastName: "Employee contact",
            ownerUserId: employeeId,
            createdByUserId: ownerId,
          },
          {
            id: viewerContactId,
            orgId,
            accountId: viewerAccountId,
            firstName: "Synthetic",
            lastName: "Viewer contact",
            ownerUserId: viewerId,
            createdByUserId: ownerId,
          },
          {
            id: viewerCreatorContactId,
            orgId,
            accountId: viewerCreatorAccountId,
            firstName: "Synthetic",
            lastName: "Viewer creator-only contact",
            ownerUserId: ownerId,
            createdByUserId: viewerId,
          },
          {
            id: unownedContactId,
            orgId,
            accountId: unownedAccountId,
            firstName: "Synthetic",
            lastName: "Unowned contact",
            ownerUserId: null,
            createdByUserId: viewerId,
          },
        ]);
        await tx.insert(leads).values([
          {
            id: ownerLeadId,
            orgId,
            firstName: "Synthetic",
            lastName: "Owner lead",
            assignedToUserId: ownerId,
            createdByUserId: ownerId,
          },
          {
            id: employeeLeadId,
            orgId,
            firstName: "Synthetic",
            lastName: "Employee lead",
            assignedToUserId: employeeId,
            createdByUserId: ownerId,
          },
          {
            id: viewerLeadId,
            orgId,
            firstName: "Synthetic",
            lastName: "Viewer lead",
            assignedToUserId: viewerId,
            createdByUserId: ownerId,
          },
          {
            id: viewerCreatorLeadId,
            orgId,
            firstName: "Synthetic",
            lastName: "Viewer creator-only lead",
            assignedToUserId: ownerId,
            createdByUserId: viewerId,
          },
          {
            id: unownedLeadId,
            orgId,
            firstName: "Synthetic",
            lastName: "Unassigned lead",
            assignedToUserId: null,
            createdByUserId: viewerId,
          },
        ]);

        observed.ownerAccounts = await accountIds(tx, ownerRequest);
        observed.employeeAccounts = await accountIds(tx, employeeRequest);
        observed.ownerOpportunities = await opportunityIds(tx, ownerRequest);
        observed.employeeOpportunities = await opportunityIds(tx, employeeRequest);
        observed.ownerContacts = await contactIds(tx, ownerRequest);
        observed.employeeContacts = await contactIds(tx, employeeRequest);
        observed.ownerLeads = await leadIds(tx, ownerRequest);
        observed.employeeLeads = await leadIds(tx, employeeRequest);
        observed.viewerAccounts = await accountIds(tx, viewerRequest);
        observed.viewerOpportunities = await opportunityIds(tx, viewerRequest);
        observed.viewerContacts = await contactIds(tx, viewerRequest);
        observed.viewerLeads = await leadIds(tx, viewerRequest);
        observed.employeeDeniedDetails = await Promise.all([
          detailExists(tx, employeeRequest, "account", ownerAccountId),
          detailExists(tx, employeeRequest, "opportunity", ownerOpportunityId),
          detailExists(tx, employeeRequest, "contact", ownerContactId),
          detailExists(tx, employeeRequest, "lead", ownerLeadId),
        ]);
        observed.viewerDeniedDetails = await Promise.all([
          detailExists(tx, viewerRequest, "account", viewerCreatorAccountId),
          detailExists(tx, viewerRequest, "opportunity", viewerCreatorOpportunityId),
          detailExists(tx, viewerRequest, "contact", viewerCreatorContactId),
          detailExists(tx, viewerRequest, "lead", viewerCreatorLeadId),
          detailExists(tx, viewerRequest, "account", unownedAccountId),
          detailExists(tx, viewerRequest, "opportunity", unownedOpportunityId),
          detailExists(tx, viewerRequest, "contact", unownedContactId),
          detailExists(tx, viewerRequest, "lead", unownedLeadId),
        ]);
        throw rollback;
      });
      assert.fail("synthetic CRM access transaction unexpectedly committed");
    } catch (error) {
      assert.equal(error, rollback);
    }

    assert.ok(observed, "integration transaction did not record observations");
    assert.deepEqual(observed.employeeInitial, []);
    assert.deepEqual(observed.employeeAccounts, [employeeAccountId]);
    assert.deepEqual(observed.employeeOpportunities, [employeeOpportunityId]);
    assert.deepEqual(observed.employeeContacts, [employeeContactId]);
    assert.deepEqual(observed.employeeLeads, [employeeLeadId]);
    assert.ok(observed.ownerAccounts.includes(ownerAccountId));
    assert.ok(observed.ownerAccounts.includes(employeeAccountId));
    assert.ok(observed.ownerOpportunities.includes(ownerOpportunityId));
    assert.ok(observed.ownerOpportunities.includes(employeeOpportunityId));
    assert.ok(observed.ownerContacts.includes(ownerContactId));
    assert.ok(observed.ownerContacts.includes(employeeContactId));
    assert.ok(observed.ownerLeads.includes(ownerLeadId));
    assert.ok(observed.ownerLeads.includes(employeeLeadId));
    assert.deepEqual(observed.viewerAccounts, [viewerAccountId]);
    assert.deepEqual(observed.viewerOpportunities, [viewerOpportunityId]);
    assert.deepEqual(observed.viewerContacts, [viewerContactId]);
    assert.deepEqual(observed.viewerLeads, [viewerLeadId]);
    assert.deepEqual(observed.employeeDeniedDetails, [false, false, false, false]);
    assert.deepEqual(observed.viewerDeniedDetails, [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  },
);