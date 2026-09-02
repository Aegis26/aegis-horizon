import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, leads } from "@workspace/db";
import { requireApiToken } from "../middlewares/apiToken";
import { appendAuditEvent } from "../services/audit";

const router: IRouter = Router();
const leadInput = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  company: z.string().max(500).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  productInterest: z.string().max(500).nullable().optional(),
}).strict();

router.post("/orgs/:orgId/leads/batch", requireApiToken, async (req, res): Promise<void> => {
  const orgId = req.params.orgId as string;
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || req.currentApiToken!.orgId !== orgId) {
    res.status(403).json({ error: "API token is not authorized for this organization" });
    return;
  }
  if (!req.currentApiToken!.permissions.includes("leads:write")) {
    res.status(403).json({ error: "API token lacks leads:write permission" });
    return;
  }
  const parsed = z.object({ leads: z.array(leadInput).min(1).max(100) }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid batch" });
    return;
  }
  // Parsing completes before the transaction: invalid batches create no rows.
  const inserted = await db.transaction(async (tx) =>
    tx.insert(leads).values(parsed.data.leads.map((lead) => ({ ...lead, orgId }))).returning({ id: leads.id }),
  );
  await appendAuditEvent({
    orgId, actorApiTokenId: req.currentApiToken!.id, action: "lead.batch_created",
    entityType: "lead_batch", entityId: inserted[0]?.id, metadata: { count: inserted.length },
  });
  res.status(201).json({ count: inserted.length, leadIds: inserted.map((lead) => lead.id) });
});

export default router;