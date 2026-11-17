import express, { Router, type IRouter } from "express";
import { db, inboundLeadLog, organizations } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { acquireOrganizationMutationLock } from "../middlewares/auth";
import { inboundLeadInput, ingestLead, resolveInboundPrincipal } from "../services/inboundLeads";

const router: IRouter = Router();
const json = express.json({ limit: "64kb", strict: true });

// Mounted BEFORE global JSON and Clerk middleware: bad JSON, wrong keys and
// health checks receive the same safe error/audit treatment without a session.
router.use(async (req, res): Promise<void> => {
  let logId: string | undefined;
  const finish = async (status: number, result: string, body: object, error: string | null = null) => {
    if (logId) await db.update(inboundLeadLog).set({ result, error }).where(eq(inboundLeadLog.id, logId));
    res.status(status).json(body);
  };
  try {
    const [log] = await db.insert(inboundLeadLog).values({ result: "received" }).returning();
    logId = log.id;
    const principal = resolveInboundPrincipal(req.get("X-API-Key"));
    if (!principal) {
      await finish(401, "unauthorized", { error: "Missing or invalid API key" }, "unauthorized");
      return;
    }
    if (!(await acquireOrganizationMutationLock(req, res, principal.orgId))) {
      await db.update(inboundLeadLog).set({ result: "unavailable", error: "organization_unavailable" }).where(eq(inboundLeadLog.id, logId));
      return;
    }
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, principal.orgId));
    if (!org) {
      await finish(503, "unavailable", { error: "Intake organization is unavailable" }, "organization_unavailable");
      return;
    }
    await db.update(inboundLeadLog).set({ orgId: org.id }).where(eq(inboundLeadLog.id, logId));
    // Atomic fixed 60-second window, shared across replicas/restarts.
    const rate = await db.execute(sql`
      INSERT INTO inbound_lead_rate (org_id, key_id, window_start, count)
      VALUES (${org.id}, ${principal.keyId}, now(), 1)
      ON CONFLICT (org_id, key_id) DO UPDATE SET
        count = CASE WHEN inbound_lead_rate.window_start <= now() - interval '60 seconds'
          THEN 1 ELSE LEAST(inbound_lead_rate.count + 1, 121) END,
        window_start = CASE WHEN inbound_lead_rate.window_start <= now() - interval '60 seconds'
          THEN now() ELSE inbound_lead_rate.window_start END
      RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + interval '60 seconds' - now())))) AS retry_after
    `);
    if (Number(rate.rows[0].count) > 120) {
      res.setHeader("Retry-After", String(rate.rows[0].retry_after));
      await finish(429, "rate_limited", { error: "Limit is 120 requests per minute" }, "rate_limited");
      return;
    }
    if (req.method === "GET" && req.path === "/health") {
      await finish(200, "healthy", { ok: true });
      return;
    }
    if (req.method !== "POST" || req.path !== "/leads") {
      await finish(404, "not_found", { error: "Endpoint not found" }, "not_found");
      return;
    }
    if (!req.is("application/json")) {
      await finish(400, "invalid_body", { errors: [{ field: "body", message: "Content-Type must be application/json" }] }, "invalid_content_type");
      return;
    }
    const parseError = await new Promise<unknown>((resolve) => json(req, res, (error) => resolve(error)));
    if (parseError) {
      await finish(400, "invalid_body", { errors: [{ field: "body", message: "Invalid JSON or body exceeds 64 KB" }] }, "invalid_json");
      return;
    }
    const parsed = inboundLeadInput.safeParse(req.body);
    // Only persist a valid external identifier; never persist raw bodies,
    // unknown fields, authorization headers, or parser/DB exception text.
    if (typeof req.body?.external_id === "string" && req.body.external_id.length <= 200) {
      await db.update(inboundLeadLog).set({ externalId: req.body.external_id }).where(eq(inboundLeadLog.id, logId));
    }
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({
        field: issue.code === "unrecognized_keys" ? "body" : issue.path.join("."),
        message: issue.code === "unrecognized_keys" ? "Unknown fields are not allowed" : issue.message,
      }));
      await finish(400, "invalid_body", { errors }, "validation_failed");
      return;
    }
    const result = await ingestLead(principal, parsed.data, logId);
    res.status(result.status === "created" ? 201 : 200).json(result);
  } catch {
    // Never log raw errors: SQL parameters may contain contact data or user text.
    req.log?.error({ event: "inbound_lead_failed", logId }, "Lead intake failed");
    try {
      if (logId) await db.update(inboundLeadLog).set({ result: "error", error: "intake_unavailable" }).where(eq(inboundLeadLog.id, logId));
    } catch { /* DB outage: request fails closed; structured server event above remains. */ }
    if (!res.headersSent) res.status(503).json({ error: "Lead intake unavailable; retry later" });
  }
});

export default router;
