import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { accounts, db } from "@workspace/db";
import {
  crmRecordCondition,
  crmVisibility,
  hasCrmManagementAccess,
  isViewerMutation,
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

test("ordinary roles require a non-null owner and owner-or-creator match", () => {
  for (const role of ["user", "viewer"]) {
    const query = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(crmRecordCondition(request(role), "account", "account-a"))
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
  }
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