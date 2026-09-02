import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, webhookDeliveries, webhooks } from "@workspace/db";
import { attachOrg, attachUser, requireRole } from "../middlewares/auth";
import { appendAuditEvent, auditContext } from "../services/audit";
import { encryptWebhookSecret, testWebhook, validateWebhookUrl } from "../services/webhooks";

const router: IRouter = Router(); const gate = [attachUser, attachOrg, requireRole("manager")] as const;
const input = z.object({ name: z.string().min(1).max(100), url: z.string().url().max(2048), events: z.array(z.enum(["lead.created", "lead.updated", "opportunity.created", "opportunity.updated"])).min(1).max(4), enabled: z.boolean().optional() }).strict();
const safe = ({ secretCiphertext: _a, secretIv: _b, secretTag: _c, ...hook }: typeof webhooks.$inferSelect) => hook;
router.get("/orgs/:orgId/webhooks", ...gate, async (req, res) => res.json((await db.select().from(webhooks).where(eq(webhooks.orgId, req.currentOrg!.id))).map(safe)));
router.post("/orgs/:orgId/webhooks", ...gate, async (req, res): Promise<void> => { const parsed = input.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; } try { await validateWebhookUrl(parsed.data.url); } catch (err) { res.status(400).json({ error: (err as Error).message }); return; } const secret = randomBytes(32).toString("base64url"); const [hook] = await db.insert(webhooks).values({ ...parsed.data, orgId: req.currentOrg!.id, enabled: parsed.data.enabled ?? true, ...encryptWebhookSecret(secret), createdByUserId: req.currentUser!.id }).returning(); await appendAuditEvent({ orgId: hook.orgId, action: "webhook.created", entityType: "webhook", entityId: hook.id, ...auditContext(req) }); res.status(201).json({ ...safe(hook), secret }); });
router.patch("/orgs/:orgId/webhooks/:webhookId", ...gate, async (req, res): Promise<void> => { const parsed = input.partial().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; } if (parsed.data.url) try { await validateWebhookUrl(parsed.data.url); } catch (err) { res.status(400).json({ error: (err as Error).message }); return; } const [hook] = await db.update(webhooks).set(parsed.data).where(and(eq(webhooks.id, req.params.webhookId as string), eq(webhooks.orgId, req.currentOrg!.id))).returning(); if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; } res.json(safe(hook)); });
router.delete("/orgs/:orgId/webhooks/:webhookId", ...gate, async (req, res) => { await db.delete(webhooks).where(and(eq(webhooks.id, req.params.webhookId as string), eq(webhooks.orgId, req.currentOrg!.id))); res.status(204).end(); });
router.post("/orgs/:orgId/webhooks/:webhookId/test", ...gate, async (req, res): Promise<void> => { const [hook] = await db.select().from(webhooks).where(and(eq(webhooks.id, req.params.webhookId as string), eq(webhooks.orgId, req.currentOrg!.id))); if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; } res.json(await testWebhook(hook)); });
router.get("/orgs/:orgId/webhooks/:webhookId/deliveries", ...gate, async (req, res) => res.json(await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.orgId, req.currentOrg!.id), eq(webhookDeliveries.webhookId, req.params.webhookId as string))).orderBy(desc(webhookDeliveries.createdAt)).limit(200)));
export default router;