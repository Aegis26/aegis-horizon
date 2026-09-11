import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { contacts, db, tasks } from "@workspace/db";
import {
  closeContactVisibilityCondition,
} from "./predictive";
import { taskVisibilityCondition } from "./taskAccess";

function request(role: string, userId = "user-a", orgId = "org-a"): Request {
  return {
    currentMembership: { role },
    currentUser: { id: userId },
    currentOrg: { id: orgId },
  } as Request;
}

test("viewer task mutations use assignee-only ownership", () => {
  const query = db
    .update(tasks)
    .set({ status: "completed" })
    .where(taskVisibilityCondition(request("viewer")));
  const sql = query.toSQL().sql.replaceAll('"', "");

  assert.match(sql, /tasks\.assigned_to_user_id/);
  assert.doesNotMatch(sql, /tasks\.created_by_user_id =/);
});

test("task opportunity mutations require the opportunity parent account", () => {
  const query = db
    .update(tasks)
    .set({ status: "completed" })
    .where(taskVisibilityCondition(request("user")));
  const sql = query.toSQL().sql.replaceAll('"', "");
  const accountVisibilityChecks =
    sql.match(/accounts\.owner_user_id is not null/g) ?? [];

  assert.ok(
    accountVisibilityChecks.length >= 2,
    "task predicate should check both direct and opportunity-parent account visibility",
  );
  assert.match(sql, /opportunities\.owner_user_id is not null/);
});

test("close prediction stakeholder count uses visible contact and account rows", () => {
  const query = db
    .select()
    .from(contacts)
    .where(
      closeContactVisibilityCondition(request("user"), "org-a", "account-a"),
    );
  const sql = query.toSQL().sql.replaceAll('"', "");

  assert.match(sql, /contacts\.owner_user_id is not null/);
  assert.match(sql, /accounts\.owner_user_id is not null/);
});