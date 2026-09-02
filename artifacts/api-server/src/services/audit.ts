import type { Request } from "express";
import { auditEvents, db } from "@workspace/db";
import { getClientIp } from "../lib/clientIp";

export type AuditEventInput = {
  orgId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  actorApiTokenId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Inserts one immutable audit event. Audit records are never updated/deleted. */
export async function appendAuditEvent(input: AuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    orgId: input.orgId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.actorUserId,
    actorApiTokenId: input.actorApiTokenId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: input.requestId,
    metadata: input.metadata ?? {},
  });
}

export function auditContext(req: Request) {
  const userAgent = req.get("user-agent")?.slice(0, 1000) ?? null;
  return {
    actorUserId: req.currentUser?.id ?? null,
    ipAddress: getClientIp(req),
    userAgent,
    requestId: req.id === undefined ? null : String(req.id),
  };
}