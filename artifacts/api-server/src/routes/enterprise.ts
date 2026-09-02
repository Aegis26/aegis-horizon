import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  apiTokens, auditEvents, db, industryTemplateApplications, orgCustomFields,
  orgCustomRoles, orgSecurityPolicies, pipelines,
} from "@workspace/db";
import { attachOrg, attachUser, requireRole } from "../middlewares/auth";
import { sha256 } from "../middlewares/apiToken";
import { appendAuditEvent, auditContext } from "../services/audit";

const router: IRouter = Router();
const gate = [attachUser, attachOrg, requireRole("admin")] as const;
const cidr = z.string().regex(/^[0-9a-fA-F:.]+(?:\/(?:[0-9]|[12][0-9]|3[0-2]|1[01][0-9]|12[0-8]))?$/, "Invalid CIDR");

router.get("/orgs/:orgId/api-tokens", ...gate, async (req, res) => {
  const rows = await db.select().from(apiTokens).where(eq(apiTokens.orgId, req.currentOrg!.id)).orderBy(desc(apiTokens.createdAt));
  res.json(rows.map(({ tokenHash: _hash, ...token }) => token));
});
router.post("/orgs/:orgId/api-tokens", ...gate, async (req, res): Promise<void> => {
  const parsed = z.object({ name: z.string().min(1).max(100), permissions: z.array(z.enum(["leads:write"])).min(1), rateLimitPerMinute: z.number().int().min(1).max(10000).optional(), expiresAt: z.string().datetime().optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const plaintext = `aegis_${randomBytes(32).toString("base64url")}`;
  const [token] = await db.insert(apiTokens).values({
    orgId: req.currentOrg!.id, name: parsed.data.name, permissions: parsed.data.permissions,
    rateLimitPerMinute: parsed.data.rateLimitPerMinute, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    tokenPrefix: plaintext.slice(0, 14), tokenHash: sha256(plaintext), createdByUserId: req.currentUser!.id,
  }).returning();
  await appendAuditEvent({ orgId: token.orgId, action: "api_token.created", entityType: "api_token", entityId: token.id, ...auditContext(req) });
  const { tokenHash: _hash, ...safe } = token;
  res.status(201).json({ ...safe, token: plaintext }); // only response containing plaintext
});
router.delete("/orgs/:orgId/api-tokens/:tokenId", ...gate, async (req, res): Promise<void> => {
  const [token] = await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, req.params.tokenId as string), eq(apiTokens.orgId, req.currentOrg!.id))).returning();
  if (!token) { res.status(404).json({ error: "API token not found" }); return; }
  await appendAuditEvent({ orgId: token.orgId, action: "api_token.revoked", entityType: "api_token", entityId: token.id, ...auditContext(req) });
  res.status(204).end();
});

router.get("/orgs/:orgId/security-policy", ...gate, async (req, res) => {
  const [policy] = await db.select().from(orgSecurityPolicies).where(eq(orgSecurityPolicies.orgId, req.currentOrg!.id));
  res.json(policy ?? { orgId: req.currentOrg!.id, mfaRequired: false, clerkMfaStatus: "not_configured", ssoRequired: false, clerkSsoStatus: "not_configured", ipAllowlistEnabled: false, allowedCidrs: [] });
});
router.put("/orgs/:orgId/security-policy", ...gate, async (req, res): Promise<void> => {
  const parsed = z.object({ mfaRequired: z.boolean().optional(), ssoRequired: z.boolean().optional(), ipAllowlistEnabled: z.boolean().optional(), allowedCidrs: z.array(cidr).max(100).optional(), clerkMfaStatus: z.enum(["not_configured", "configured"]).optional(), clerkSsoStatus: z.enum(["not_configured", "configured"]).optional() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  if (parsed.data.ipAllowlistEnabled && !parsed.data.allowedCidrs?.length) { res.status(400).json({ error: "An enabled IP policy requires at least one CIDR" }); return; }
  const values = { ...parsed.data, orgId: req.currentOrg!.id, updatedByUserId: req.currentUser!.id };
  const [policy] = await db.insert(orgSecurityPolicies).values(values).onConflictDoUpdate({ target: orgSecurityPolicies.orgId, set: values }).returning();
  await appendAuditEvent({ orgId: policy.orgId, action: "security_policy.updated", entityType: "security_policy", entityId: policy.id, ...auditContext(req) });
  res.json(policy);
});
router.get("/orgs/:orgId/audit-events", ...gate, async (req, res) => {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.orgId, req.currentOrg!.id)).orderBy(desc(auditEvents.createdAt)).limit(500);
  res.json(rows);
});

const templates = {
  k12: { pipeline: "Enrollment", roles: ["admissions_manager"], fields: ["student_count", "district"] },
  construction: { pipeline: "Projects", roles: ["estimator"], fields: ["project_type", "bid_due_date"] },
  healthcare: { pipeline: "Care Partnerships", roles: ["provider_relations"], fields: ["facility_type", "patient_volume"] },
} as const;
router.get("/orgs/:orgId/industry-templates", ...gate, (_req, res) => res.json(Object.entries(templates).map(([key, value]) => ({ key, ...value, version: 1 }))));
router.post("/orgs/:orgId/industry-templates/:templateKey/apply", ...gate, async (req, res): Promise<void> => {
  const key = req.params.templateKey as keyof typeof templates;
  const template = templates[key];
  if (!template) { res.status(404).json({ error: "Unknown industry template" }); return; }
  const orgId = req.currentOrg!.id;
  const result = await db.transaction(async (tx) => {
    const [application] = await tx.insert(industryTemplateApplications).values({ orgId, templateKey: key, templateVersion: 1, appliedByUserId: req.currentUser!.id }).onConflictDoNothing().returning();
    if (!application) return { applied: false };
    await tx.insert(pipelines).values({ orgId, name: template.pipeline, stages: [] }).onConflictDoNothing();
    await tx.insert(orgCustomRoles).values(template.roles.map((roleKey) => ({ orgId, roleKey, name: roleKey.replaceAll("_", " "), permissions: [], templateKey: key }))).onConflictDoNothing();
    await tx.insert(orgCustomFields).values(template.fields.map((fieldKey) => ({ orgId, entityType: "account", fieldKey, label: fieldKey.replaceAll("_", " "), dataType: "text", templateKey: key }))).onConflictDoNothing();
    return { applied: true };
  });
  await appendAuditEvent({ orgId, action: "industry_template.applied", entityType: "industry_template", entityId: key, ...auditContext(req), metadata: result });
  res.json({ key, ...result });
});
export default router;