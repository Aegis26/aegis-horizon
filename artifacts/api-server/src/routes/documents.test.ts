import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { documents, db } from "@workspace/db";
import { documentVisibility } from "./documents";

function request(role: string, userId = "user-a", orgId = "org-a"): Request {
  return {
    currentMembership: { role },
    currentUser: { id: userId },
    currentOrg: { id: orgId },
  } as Request;
}

function visibilitySql(role: string) {
  const predicate = documentVisibility(request(role));
  assert.ok(predicate);
  return db
    .select({ id: documents.id })
    .from(documents)
    .where(predicate)
    .toSQL()
    .sql
    .replaceAll('"', "");
}

test("linked document visibility requires every populated CRM parent", () => {
  const sql = visibilitySql("user");

  assert.match(sql, /documents\.account_id is null/);
  assert.match(sql, /documents\.opportunity_id is null/);
  assert.match(sql, /documents\.account_id is not null/);
  assert.match(sql, /documents\.opportunity_id is not null/);
  assert.match(sql, /accounts\.owner_user_id is not null/);
  assert.match(sql, /opportunities\.owner_user_id is not null/);
});

test("regular-user creator fallback applies only to unlinked documents", () => {
  const sql = visibilitySql("user");

  assert.match(
    sql,
    /documents\.account_id is null and documents\.opportunity_id is null and documents\.created_by_user_id =/,
  );
});

test("viewer document visibility has no creator fallback", () => {
  const sql = visibilitySql("viewer");

  assert.match(sql, /documents\.account_id is null/);
  assert.match(sql, /documents\.opportunity_id is null/);
  assert.match(sql, /documents\.account_id is not null/);
  assert.match(sql, /documents\.opportunity_id is not null/);
  assert.doesNotMatch(sql, /documents\.created_by_user_id/);
});

test("management document visibility remains organization-wide", () => {
  assert.equal(documentVisibility(request("manager")), undefined);
});