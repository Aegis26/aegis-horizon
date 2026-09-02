import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { accounts, activities, customReports, db, leads, opportunities, reportExports, reportRuns, reportSchedules, users } from "@workspace/db";
import { attachOrg, attachUser, requireRole } from "../middlewares/auth";
import { appendAuditEvent, auditContext } from "../services/audit";
import { ObjectAccessGroupType, ObjectPermission } from "../lib/objectAcl";
import { objectStorageClient, ObjectStorageService } from "../lib/objectStorage";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();
const gate = [attachUser, attachOrg, requireRole("manager")] as const;
const entityFields = {
  accounts: ["name", "industry", "country", "state", "annualRevenue", "employeeCount"] as const,
  leads: ["firstName", "lastName", "email", "company", "industry", "status", "score", "source", "country", "state"] as const,
  opportunities: ["id", "name", "stage", "probability", "value", "forecastCategory", "expectedCloseDate", "daysSinceLastTouch"] as const,
};
const condition = z.object({
  field: z.string(), operator: z.enum(["equals", "contains", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"]),
  value: z.union([z.string(), z.number()]).optional(),
}).strict();
const definition = z.object({
  fields: z.array(z.string()).min(1).max(20), conditions: z.array(condition).max(20).default([]),
  sort: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).optional(), limit: z.number().int().min(1).max(1000).default(100),
}).strict();
const body = z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).optional(), entityType: z.enum(["accounts", "leads", "opportunities"]), definition }).strict();

function validateDefinition(entity: keyof typeof entityFields, value: z.infer<typeof definition>): string | null {
  const fields = entityFields[entity] as readonly string[];
  if (value.fields.some((field) => !fields.includes(field))) return "Report field is not allowlisted";
  if (value.conditions.some((item) => !fields.includes(item.field))) return "Report condition field is not allowlisted";
  if (value.sort && !fields.includes(value.sort.field)) return "Report sort field is not allowlisted";
  return null;
}
function matches(row: Record<string, unknown>, conditions: z.infer<typeof condition>[]) {
  return conditions.every(({ field, operator, value }) => {
    const raw = row[field]; const text = raw == null ? "" : String(raw); const number = Number(raw); const target = Number(value);
    if (operator === "is_empty") return raw == null || text === "";
    if (operator === "is_not_empty") return raw != null && text !== "";
    if (operator === "contains") return text.toLowerCase().includes(String(value ?? "").toLowerCase());
    if (operator === "equals") return text === String(value ?? "");
    if (operator === "gt") return number > target; if (operator === "gte") return number >= target;
    if (operator === "lt") return number < target; return number <= target;
  });
}
export async function execute(orgId: string, entity: keyof typeof entityFields, value: z.infer<typeof definition>) {
  // Select known Drizzle tables only; definitions never become SQL identifiers.
  let source = entity === "accounts" ? await db.select().from(accounts).where(eq(accounts.orgId, orgId))
    : entity === "leads" ? await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.isActive, true)))
    : await db.select().from(opportunities).where(eq(opportunities.orgId, orgId));
  if (entity === "opportunities") {
    // Fetch every relevant activity in one org-scoped query, rather than once per opportunity.
    const opportunityRows = source as typeof opportunities.$inferSelect[];
    const opportunityIds = opportunityRows.map((opportunity) => opportunity.id);
    const activityRows = opportunityIds.length === 0 ? [] : await db
      .select({ opportunityId: activities.opportunityId, createdAt: activities.createdAt })
      .from(activities)
      .where(and(eq(activities.orgId, orgId), inArray(activities.opportunityId, opportunityIds)));
    const latestActivityByOpportunity = new Map<string, Date>();
    for (const activity of activityRows) {
      if (!activity.opportunityId) continue;
      const previous = latestActivityByOpportunity.get(activity.opportunityId);
      if (!previous || activity.createdAt > previous) latestActivityByOpportunity.set(activity.opportunityId, activity.createdAt);
    }
    const now = Date.now();
    source = opportunityRows.map((opportunity) => {
      const lastTouch = latestActivityByOpportunity.get(opportunity.id) ?? opportunity.createdAt;
      return {
        ...opportunity,
        daysSinceLastTouch: Math.max(0, Math.floor((now - lastTouch.getTime()) / 86_400_000)),
      };
    });
  }
  let rows = (source as unknown as Record<string, unknown>[]).filter((row) => matches(row, value.conditions));
  if (value.sort) rows = rows.sort((a, b) => String(a[value.sort!.field] ?? "").localeCompare(String(b[value.sort!.field] ?? "")) * (value.sort!.direction === "asc" ? 1 : -1));
  return rows.slice(0, value.limit).map((row) => Object.fromEntries(value.fields.map((field) => [field, row[field] ?? null])));
}
function csv(rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {}); const quote = (v: unknown) => `"${String(v ?? "").replaceAll("\"", "\"\"")}"`;
  return Buffer.from([keys.map(quote).join(","), ...rows.map((row) => keys.map((key) => quote(row[key])).join(","))].join("\n"));
}
function spreadsheet(rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {}); const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const cells = (values: unknown[]) => `<Row>${values.map((v) => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join("")}</Row>`;
  return Buffer.from(`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${cells(keys)}${rows.map((row) => cells(keys.map((key) => row[key]))).join("")}</Table></Worksheet></Workbook>`);
}
async function renderPdf(rows: Record<string, unknown>[]) {
  return new Promise<Buffer>((resolve, reject) => { const document = new PDFDocument(); const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk)); document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject);
    document.fontSize(16).text("Aegis Horizon report"); rows.forEach((row) => document.fontSize(9).text(Object.entries(row).map(([k, v]) => `${k}: ${v ?? ""}`).join(" | "))); document.end(); });
}
export async function saveExport(orgId: string, clerkUserId: string, rows: Record<string, unknown>[], format: "csv" | "pdf" | "xlsx") {
  const rendered = format === "pdf" ? { buffer: await renderPdf(rows), contentType: "application/pdf", extension: "pdf" }
    : format === "xlsx" ? { buffer: spreadsheet(rows), contentType: "application/vnd.ms-excel", extension: "xls" }
    : { buffer: csv(rows), contentType: "text/csv", extension: "csv" };
  const relative = `exports/${orgId}/${randomUUID()}.${rendered.extension}`; const base = new ObjectStorageService().getPrivateObjectDir().replace(/^\//, "").split("/");
  const bucket = base.shift(); if (!bucket) throw new Error("Invalid private object storage directory");
  const file = objectStorageClient.bucket(bucket).file([...base, relative].join("/"));
  await file.save(rendered.buffer, { contentType: rendered.contentType, resumable: false });
  await file.setMetadata({ metadata: { "custom:aclPolicy": JSON.stringify({ owner: clerkUserId, visibility: "private", aclRules: [{ group: { type: ObjectAccessGroupType.ORG_MEMBER, id: orgId }, permission: ObjectPermission.READ }] }) } });
  return { objectPath: `/objects/${relative}`, sizeBytes: rendered.buffer.length, contentType: rendered.contentType, fileName: `report.${rendered.extension}` };
}
async function reportFor(req: Parameters<typeof router.get>[1] extends never ? never : any) {
  const [report] = await db.select().from(customReports).where(and(eq(customReports.id, req.params.reportId), eq(customReports.orgId, req.currentOrg.id)));
  return report;
}

router.get("/orgs/:orgId/reports", ...gate, async (req, res) => res.json(await db.select().from(customReports).where(eq(customReports.orgId, req.currentOrg!.id)).orderBy(desc(customReports.updatedAt))));
router.post("/orgs/:orgId/reports", ...gate, async (req, res): Promise<void> => {
  const parsed = body.safeParse(req.body); const invalid = parsed.success ? validateDefinition(parsed.data.entityType, parsed.data.definition) : parsed.error.issues[0]?.message;
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const [report] = await db.insert(customReports).values({ ...parsed.data!, orgId: req.currentOrg!.id, createdByUserId: req.currentUser!.id }).returning();
  await appendAuditEvent({ orgId: report.orgId, action: "report.created", entityType: "report", entityId: report.id, ...auditContext(req) }); res.status(201).json(report);
});
router.get("/orgs/:orgId/reports/:reportId", ...gate, async (req, res): Promise<void> => { const report = await reportFor(req); if (!report) { res.status(404).json({ error: "Report not found" }); return; } res.json(report); });
router.patch("/orgs/:orgId/reports/:reportId", ...gate, async (req, res): Promise<void> => {
  const report = await reportFor(req); if (!report) { res.status(404).json({ error: "Report not found" }); return; }
  const parsed = body.partial().safeParse(req.body); const entity = parsed.success ? (parsed.data.entityType ?? report.entityType) as keyof typeof entityFields : null;
  const invalid = !parsed.success ? parsed.error.issues[0]?.message : parsed.data.definition ? validateDefinition(entity!, parsed.data.definition) : null;
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const [updated] = await db.update(customReports).set(parsed.data!).where(eq(customReports.id, report.id)).returning(); res.json(updated);
});
router.delete("/orgs/:orgId/reports/:reportId", ...gate, async (req, res): Promise<void> => { const report = await reportFor(req); if (!report) { res.status(404).json({ error: "Report not found" }); return; } await db.delete(customReports).where(eq(customReports.id, report.id)); res.status(204).end(); });
router.post("/orgs/:orgId/reports/:reportId/preview", ...gate, async (req, res): Promise<void> => { const report = await reportFor(req); if (!report) { res.status(404).json({ error: "Report not found" }); return; } res.json({ rows: await execute(req.currentOrg!.id, report.entityType as keyof typeof entityFields, definition.parse(report.definition)) }); });
router.post("/orgs/:orgId/reports/:reportId/run", ...gate, async (req, res): Promise<void> => {
  const report = await reportFor(req); if (!report) { res.status(404).json({ error: "Report not found" }); return; }
  const [run] = await db.insert(reportRuns).values({ orgId: report.orgId, reportId: report.id, startedByUserId: req.currentUser!.id }).returning();
  try { const rows = await execute(report.orgId, report.entityType as keyof typeof entityFields, definition.parse(report.definition)); const [done] = await db.update(reportRuns).set({ status: "completed", rowCount: rows.length, completedAt: new Date() }).where(eq(reportRuns.id, run.id)).returning(); await appendAuditEvent({ orgId: report.orgId, action: "report.run", entityType: "report", entityId: report.id, ...auditContext(req), metadata: { runId: run.id, rowCount: rows.length } }); res.json({ run: done, rows }); }
  catch (error) { await db.update(reportRuns).set({ status: "failed", errorMessage: (error as Error).message, completedAt: new Date() }).where(eq(reportRuns.id, run.id)); throw error; }
});
router.get("/orgs/:orgId/reports/:reportId/runs", ...gate, async (req, res) => { const report = await reportFor(req); if (!report) { res.status(404).json({ error: "Report not found" }); return; } res.json(await db.select().from(reportRuns).where(and(eq(reportRuns.orgId, report.orgId), eq(reportRuns.reportId, report.id))).orderBy(desc(reportRuns.startedAt))); });
router.post("/orgs/:orgId/reports/:reportId/exports", ...gate, async (req, res): Promise<void> => {
  const report = await reportFor(req); const parsed = z.object({ format: z.enum(["csv", "pdf", "xlsx"]) }).safeParse(req.body);
  if (!report) { res.status(404).json({ error: "Report not found" }); return; } if (!parsed.success) { res.status(400).json({ error: "format must be csv, pdf, or xlsx" }); return; }
  const [run] = await db.insert(reportRuns).values({ orgId: report.orgId, reportId: report.id, startedByUserId: req.currentUser!.id }).returning();
  try {
    const rows = await execute(report.orgId, report.entityType as keyof typeof entityFields, definition.parse(report.definition));
    const saved = await saveExport(report.orgId, getAuth(req).userId!, rows, parsed.data.format);
    const [exported] = await db.insert(reportExports).values({ orgId: report.orgId, reportId: report.id, format: parsed.data.format, status: "completed", ...saved, rowCount: rows.length, requestedByUserId: req.currentUser!.id, completedAt: new Date() }).returning();
    await db.update(reportRuns).set({ status: "completed", rowCount: rows.length, completedAt: new Date() }).where(eq(reportRuns.id, run.id));
    await appendAuditEvent({ orgId: report.orgId, action: "report.exported", entityType: "report_export", entityId: exported.id, ...auditContext(req), metadata: { format: parsed.data.format, rowCount: rows.length } });
    res.status(201).json({ ...exported, downloadUrl: `/api/orgs/${report.orgId}/reports/exports/${exported.id}/download` });
  } catch (error) { await db.update(reportRuns).set({ status: "failed", errorMessage: (error as Error).message, completedAt: new Date() }).where(eq(reportRuns.id, run.id)); throw error; }
});
router.get("/orgs/:orgId/reports/exports/:exportId/download", ...gate, async (req, res): Promise<void> => {
  const [item] = await db.select().from(reportExports).where(and(eq(reportExports.id, req.params.exportId as string), eq(reportExports.orgId, req.currentOrg!.id)));
  if (!item?.objectPath || item.status !== "completed") { res.status(404).json({ error: "Report export not found" }); return; }
  // Redirect only to the authenticated storage handler. The object's org-member ACL is independently checked there.
  res.redirect(302, `/api/storage${item.objectPath}`);
});
function nextRun(frequency: "daily" | "weekly" | "monthly", from = new Date()) {
  const next = new Date(from); next.setUTCSeconds(0, 0);
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (frequency === "monthly") { next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCDate(1); }
  next.setUTCHours(8, 0, 0, 0); return next;
}
const scheduleBody = z.object({ frequency: z.enum(["daily", "weekly", "monthly"]), format: z.enum(["csv", "pdf", "xlsx"]), recipientEmails: z.array(z.string().email()).min(1).max(20), enabled: z.boolean().optional() }).strict();
router.get("/orgs/:orgId/reports/:reportId/schedules", ...gate, async (req, res) => res.json(await db.select().from(reportSchedules).where(and(eq(reportSchedules.orgId, req.currentOrg!.id), eq(reportSchedules.reportId, req.params.reportId as string)))));
router.post("/orgs/:orgId/reports/:reportId/schedules", ...gate, async (req, res): Promise<void> => {
  const report = await reportFor(req); const parsed = scheduleBody.safeParse(req.body);
  if (!report) { res.status(404).json({ error: "Report not found" }); return; } if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [schedule] = await db.insert(reportSchedules).values({ orgId: report.orgId, reportId: report.id, cronExpression: `@${parsed.data.frequency}`, format: parsed.data.format, recipientEmails: parsed.data.recipientEmails, enabled: parsed.data.enabled ?? true, nextRunAt: nextRun(parsed.data.frequency), createdByUserId: req.currentUser!.id }).returning();
  await appendAuditEvent({ orgId: report.orgId, action: "report_schedule.created", entityType: "report_schedule", entityId: schedule.id, ...auditContext(req) }); res.status(201).json(schedule);
});
router.patch("/orgs/:orgId/reports/:reportId/schedules/:scheduleId", ...gate, async (req, res): Promise<void> => {
  const parsed = scheduleBody.partial().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const frequency = parsed.data.frequency; const [schedule] = await db.update(reportSchedules).set({ ...parsed.data, cronExpression: frequency ? `@${frequency}` : undefined, nextRunAt: frequency ? nextRun(frequency) : undefined, claimedAt: null, claimToken: null }).where(and(eq(reportSchedules.id, req.params.scheduleId as string), eq(reportSchedules.orgId, req.currentOrg!.id), eq(reportSchedules.reportId, req.params.reportId as string))).returning();
  if (!schedule) { res.status(404).json({ error: "Report schedule not found" }); return; } res.json(schedule);
});
router.delete("/orgs/:orgId/reports/:reportId/schedules/:scheduleId", ...gate, async (req, res): Promise<void> => { await db.delete(reportSchedules).where(and(eq(reportSchedules.id, req.params.scheduleId as string), eq(reportSchedules.orgId, req.currentOrg!.id), eq(reportSchedules.reportId, req.params.reportId as string))); res.status(204).end(); });

/** Called by the native scheduler. Claimed rows guarantee one delivery per due interval. */
export async function executeScheduledReport(scheduleId: string, claimToken: string) {
  const [schedule] = await db.select().from(reportSchedules).where(and(eq(reportSchedules.id, scheduleId), eq(reportSchedules.claimToken, claimToken)));
  if (!schedule) return;
  try {
    const [report] = await db.select().from(customReports).where(and(eq(customReports.id, schedule.reportId), eq(customReports.orgId, schedule.orgId)));
    const [creator] = schedule.createdByUserId ? await db.select({ clerkId: users.clerkId }).from(users).where(eq(users.id, schedule.createdByUserId)) : [];
    if (!report || !creator?.clerkId) throw new Error("Scheduled report owner unavailable");
    const rows = await execute(report.orgId, report.entityType as keyof typeof entityFields, definition.parse(report.definition));
    const [run] = await db.insert(reportRuns).values({ orgId: report.orgId, reportId: report.id, parameters: { scheduleId }, rowCount: rows.length, status: "completed", completedAt: new Date() }).returning();
    const saved = await saveExport(report.orgId, creator.clerkId, rows, schedule.format as "csv" | "pdf" | "xlsx");
    const [item] = await db.insert(reportExports).values({ orgId: report.orgId, reportId: report.id, format: schedule.format, status: "completed", ...saved, rowCount: rows.length, completedAt: new Date() }).returning();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    if (!domain) throw new Error("REPLIT_DOMAINS is required to deliver scheduled report links");
    const link = `https://${domain}/api/orgs/${report.orgId}/reports/exports/${item.id}/download`;
    for (const recipient of schedule.recipientEmails) await sendEmail({ to: recipient, subject: `Scheduled report: ${report.name}`, html: `<p>Your scheduled report is ready.</p><p><a href="${link}">Download securely</a></p>` });
    const frequency = schedule.cronExpression.slice(1) as "daily" | "weekly" | "monthly";
    await db.update(reportSchedules).set({ lastRunAt: new Date(), nextRunAt: nextRun(frequency), claimedAt: null, claimToken: null }).where(eq(reportSchedules.id, schedule.id));
    await appendAuditEvent({ orgId: report.orgId, action: "report_schedule.delivered", entityType: "report_schedule", entityId: schedule.id, metadata: { runId: run.id, exportId: item.id, recipients: schedule.recipientEmails.length } });
  } catch (error) {
    await db.update(reportSchedules).set({ claimedAt: null, claimToken: null, nextRunAt: new Date(Date.now() + 15 * 60_000) }).where(eq(reportSchedules.id, scheduleId));
    await appendAuditEvent({ orgId: schedule.orgId, action: "report_schedule.failed", entityType: "report_schedule", entityId: schedule.id, metadata: { error: (error as Error).message } });
    throw error;
  }
}
export default router;