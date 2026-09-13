import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import commissionsRouter from "./commissions";

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }>;
  };
};

function settingsRoleGate(method: "get" | "put") {
  const stack = (commissionsRouter as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find(
    (candidate) =>
      candidate.route?.path === "/orgs/:orgId/commissions/settings" &&
      candidate.route.methods[method],
  );
  assert.ok(layer?.route, `commission settings ${method.toUpperCase()} route not found`);

  // The route intentionally keeps attachUser and attachOrg ahead of this
  // owner gate. Invoke only the gate so this is a no-DB authorization test.
  const gate = layer.route.stack[2]?.handle;
  assert.ok(gate, "commission settings owner gate not found");
  return gate;
}

function runGate(
  method: "get" | "put",
  role: "owner" | "admin" | "manager" | "user" | "viewer",
) {
  let statusCode = 200;
  let responseBody: unknown;
  let nextCalled = false;
  const req = { currentMembership: { role } } as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;

  settingsRoleGate(method)(req, res, () => {
    nextCalled = true;
  });
  return { statusCode, responseBody, nextCalled };
}

for (const method of ["get", "put"] as const) {
  test(`${method.toUpperCase()} commission settings is owner-only`, () => {
    for (const role of ["admin", "manager", "user", "viewer"] as const) {
      const result = runGate(method, role);
      assert.equal(result.statusCode, 403, `${role} should be rejected`);
      assert.deepEqual(result.responseBody, { error: "Insufficient role" });
      assert.equal(result.nextCalled, false, `${role} should not reach the handler`);
    }

    const owner = runGate(method, "owner");
    assert.equal(owner.statusCode, 200);
    assert.equal(owner.responseBody, undefined);
    assert.equal(owner.nextCalled, true);
  });
}