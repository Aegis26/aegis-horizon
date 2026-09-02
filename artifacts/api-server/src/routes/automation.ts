import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agentExecutions,
  accounts,
  aiAgents,
  churnPredictions,
  commandHistory,
  db,
  opportunities,
  orgUsers,
  tasks,
  workflowExecutions,
  workflows,
} from "@workspace/db";
import { attachOrg, attachUser, requireFeature, requireRole } from "../middlewares/auth";
import { draftEmail, nextAction, summarize } from "../services/copilot";
import { getAiBudgetStatus, callClaude, parseClaudeJson } from "../services/claude";
import { calculateChurn, calculateClose, calculateConversion } from "../services/predictive";
import { executeWorkflow, planWorkflow, type WorkflowAction, type WorkflowCondition, type WorkflowTrigger } from "../services/workflow";
import { runAgent } from "../services/agents";
import { isOrgAccountId, isOrgMemberId, isOrgOpportunityId } from "../services/orgValidation";

const router: IRouter = Router();
const base = [attachUser, attachOrg] as const;
const aiGate = [...base, requireFeature("ai_copilot")] as const;
async function requireAiConsent(req: Request, res: Response, next: NextFunction) {
  const status = await getAiBudgetStatus(req.currentOrg!.id);
  if (!status.consentEnabled) {
    res.status(403).json({ error: "AI consent is disabled for this organization" });
    return;
  }
  next();
}
const aiConsentGate = [...aiGate, requireAiConsent] as const;
const automationGate = [...base, requireFeature("automation")] as const;
const automationAdmin = [...automationGate, requireRole("manager")] as const;
const uuid = z.string().uuid();

function fail(res: Response, error: unknown) {
  const status = Number((error as { status?: number }).status) || (/not found/i.test((error as Error).message) ? 404 : 500);
  res.status(status).json({ error: (error as Error).message });
}

router.get("/orgs/:orgId/ai/copilot/budget", ...aiGate, async (req, res) => {
  res.json(await getAiBudgetStatus(req.currentOrg!.id));
});

router.post("/orgs/:orgId/ai/copilot/summarize", ...aiConsentGate, async (req, res): Promise<void> => {
  const parsed = z.object({ entityType: z.enum(["account", "opportunity", "email_thread"]), entityId: uuid, style: z.enum(["short", "long"]).default("short") }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    const row = await summarize(req.currentOrg!.id, req.currentUser!.id, parsed.data.entityType, parsed.data.entityId);
    res.json({ summaryShort: row.summaryShort, summaryLong: row.summaryLong, nextBestAction: row.nextBestAction, topics: row.topics, sentiment: row.sentiment, cached: row.cached, generatedAt: row.generatedAt.toISOString() });
  } catch (error) { fail(res, error); }
});

router.post("/orgs/:orgId/ai/copilot/next-action", ...aiConsentGate, async (req, res): Promise<void> => {
  const parsed = z.object({ accountId: uuid }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Valid accountId is required" }); return; }
  try { res.json(await nextAction(req.currentOrg!.id, req.currentUser!.id, parsed.data.accountId)); } catch (error) { fail(res, error); }
});

router.post("/orgs/:orgId/ai/copilot/draft-email", ...aiConsentGate, async (req, res): Promise<void> => {
  const parsed = z.object({ accountId: uuid, context: z.string().min(1).max(20_000), tone: z.enum(["professional", "casual"]).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try { res.json(await draftEmail(req.currentOrg!.id, req.currentUser!.id, parsed.data.accountId, parsed.data.context, parsed.data.tone)); } catch (error) { fail(res, error); }
});

router.get("/orgs/:orgId/predictions/churn", ...aiConsentGate, async (req, res) => {
  const rows = await db.select().from(churnPredictions).where(eq(churnPredictions.orgId, req.currentOrg!.id)).orderBy(desc(churnPredictions.riskScore));
  res.json(rows);
});
router.get("/orgs/:orgId/predictions/churn/:accountId", ...aiConsentGate, async (req, res): Promise<void> => {
  try { res.json(await calculateChurn(req.currentOrg!.id, String(req.params.accountId))); } catch (error) { fail(res, error); }
});
router.post("/orgs/:orgId/predictions/churn/:accountId/recompute", ...aiConsentGate, async (req, res): Promise<void> => {
  try { res.json(await calculateChurn(req.currentOrg!.id, String(req.params.accountId))); } catch (error) { fail(res, error); }
});
router.get("/orgs/:orgId/predictions/conversion/:leadId", ...aiConsentGate, async (req, res): Promise<void> => {
  try { res.json(await calculateConversion(req.currentOrg!.id, String(req.params.leadId))); } catch (error) { fail(res, error); }
});
router.post("/orgs/:orgId/predictions/conversion/:leadId/recompute", ...aiConsentGate, async (req, res): Promise<void> => {
  try { res.json(await calculateConversion(req.currentOrg!.id, String(req.params.leadId))); } catch (error) { fail(res, error); }
});
router.get("/orgs/:orgId/predictions/close/:opportunityId", ...aiConsentGate, async (req, res): Promise<void> => {
  try { res.json(await calculateClose(req.currentOrg!.id, String(req.params.opportunityId))); } catch (error) { fail(res, error); }
});
router.post("/orgs/:orgId/predictions/close/:opportunityId/recompute", ...aiConsentGate, async (req, res): Promise<void> => {
  try { res.json(await calculateClose(req.currentOrg!.id, String(req.params.opportunityId))); } catch (error) { fail(res, error); }
});

const workflowShapeBase = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  trigger: z.object({ type: z.enum(["record_created", "field_change", "time_based"]), entityType: z.enum(["lead", "opportunity", "account"]), field: z.string().optional(), schedule: z.enum(["hourly", "daily"]).optional() }),
  conditions: z.array(z.object({ field: z.string().min(1), operator: z.enum(["equals", "not_equals", "gt", "gte", "lt", "lte", "contains"]), value: z.union([z.string(), z.number(), z.boolean()]) })).default([]),
  actions: z.array(z.object({ type: z.enum(["create_task", "create_recommendation", "create_opportunity", "update_field"]), config: z.record(z.string(), z.unknown()).default({}) })).min(1),
});
const workflowShape = workflowShapeBase.superRefine((value, ctx) => {
  if (value.trigger.type === "field_change" && !value.trigger.field) {
    ctx.addIssue({ code: "custom", path: ["trigger", "field"], message: "field_change triggers require a field" });
  }
  if (value.trigger.type === "time_based" && !value.trigger.schedule) {
    ctx.addIssue({ code: "custom", path: ["trigger", "schedule"], message: "time_based triggers require an hourly or daily schedule" });
  }
});

router.get("/orgs/:orgId/workflows", ...automationGate, async (req, res) => {
  res.json(await db.select().from(workflows).where(eq(workflows.orgId, req.currentOrg!.id)).orderBy(desc(workflows.createdAt)));
});
router.post("/orgs/:orgId/workflows", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = workflowShape.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [row] = await db.insert(workflows).values({ ...parsed.data, orgId: req.currentOrg!.id, createdBy: req.currentUser!.id, active: false }).returning();
  res.status(201).json(row);
});
router.patch("/orgs/:orgId/workflows/:workflowId", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = workflowShapeBase.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [existing] = await db.select().from(workflows).where(and(eq(workflows.orgId, req.currentOrg!.id), eq(workflows.id, String(req.params.workflowId))));
  if (!existing) { res.status(404).json({ error: "Workflow not found" }); return; }
  const merged = workflowShape.safeParse({
    name: parsed.data.name ?? existing.name,
    description: parsed.data.description ?? existing.description,
    trigger: parsed.data.trigger ?? existing.trigger,
    conditions: parsed.data.conditions ?? existing.conditions,
    actions: parsed.data.actions ?? existing.actions,
  });
  if (!merged.success) { res.status(400).json({ error: merged.error.issues[0]?.message }); return; }
  const [row] = await db.update(workflows).set({ ...merged.data, active: false, version: existing.version + 1, lastDryRunVersion: null }).where(eq(workflows.id, existing.id)).returning();
  res.json(row);
});
router.delete("/orgs/:orgId/workflows/:workflowId", ...automationAdmin, async (req, res): Promise<void> => {
  const [row] = await db.update(workflows).set({ active: false }).where(and(eq(workflows.orgId, req.currentOrg!.id), eq(workflows.id, String(req.params.workflowId)))).returning();
  if (!row) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.status(204).end();
});
router.post("/orgs/:orgId/workflows/:workflowId/test", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = z.object({ entityType: z.enum(["lead", "opportunity", "account"]), entityId: uuid }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [workflow] = await db.select().from(workflows).where(and(eq(workflows.orgId, req.currentOrg!.id), eq(workflows.id, String(req.params.workflowId))));
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  const trigger = workflow.trigger as WorkflowTrigger | null;
  if (!trigger || trigger.entityType !== parsed.data.entityType) {
    res.status(400).json({ error: "dry-run entityType must match the workflow trigger entityType" });
    return;
  }
  try {
    const plan = await planWorkflow(workflow, parsed.data.entityType, parsed.data.entityId);
    await db.update(workflows).set({ lastDryRunVersion: workflow.version }).where(eq(workflows.id, workflow.id));
    res.json({ dryRun: true, sideEffects: 0, conditionsMatched: plan.conditionsMatched, plannedActions: plan.actions });
  } catch (error) { fail(res, error); }
});
router.post("/orgs/:orgId/workflows/:workflowId/toggle", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "active must be boolean" }); return; }
  const [workflow] = await db.select().from(workflows).where(and(eq(workflows.orgId, req.currentOrg!.id), eq(workflows.id, String(req.params.workflowId))));
  if (!workflow) { res.status(404).json({ error: "Workflow not found" }); return; }
  if (parsed.data.active && workflow.lastDryRunVersion !== workflow.version) { res.status(409).json({ error: "A successful dry-run is required after the latest edit" }); return; }
  const [row] = await db.update(workflows).set({ active: parsed.data.active }).where(eq(workflows.id, workflow.id)).returning();
  res.json(row);
});
router.get("/orgs/:orgId/workflow-executions", ...automationGate, async (req, res) => {
  res.json(await db.select().from(workflowExecutions).where(eq(workflowExecutions.orgId, req.currentOrg!.id)).orderBy(desc(workflowExecutions.createdAt)).limit(500));
});

const taskShape = z.object({
  accountId: uuid.nullable().optional(), opportunityId: uuid.nullable().optional(), title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(), type: z.string().max(50).nullable().optional(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(), priority: z.enum(["low", "medium", "high"]).optional(),
  assignedToUserId: uuid.nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
});
const taskGate = [...base, requireFeature("tasks")] as const;
async function validateTaskForeignIds(orgId: string, data: z.infer<typeof taskShape>) {
  if (data.accountId) {
    if (!(await isOrgAccountId(orgId, data.accountId))) return "accountId must reference an account in this organization";
  }
  if (data.opportunityId) {
    if (!(await isOrgOpportunityId(orgId, data.opportunityId))) return "opportunityId must reference an opportunity in this organization";
  }
  if (data.assignedToUserId) {
    if (!(await isOrgMemberId(orgId, data.assignedToUserId))) return "assignedToUserId must reference a member of this organization";
  }
  return null;
}
router.get("/orgs/:orgId/tasks", ...taskGate, async (req, res) => {
  res.json(await db.select().from(tasks).where(eq(tasks.orgId, req.currentOrg!.id)).orderBy(desc(tasks.createdAt)));
});
router.post("/orgs/:orgId/tasks", ...taskGate, async (req, res): Promise<void> => {
  const parsed = taskShape.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const foreignError = await validateTaskForeignIds(req.currentOrg!.id, parsed.data);
  if (foreignError) { res.status(400).json({ error: foreignError }); return; }
  const [row] = await db.insert(tasks).values({ ...parsed.data, orgId: req.currentOrg!.id, createdByUserId: req.currentUser!.id, assignedToUserId: parsed.data.assignedToUserId ?? req.currentUser!.id }).returning();
  res.status(201).json(row);
});
router.patch("/orgs/:orgId/tasks/:taskId", ...taskGate, async (req, res): Promise<void> => {
  const parsed = taskShape.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const foreignError = await validateTaskForeignIds(req.currentOrg!.id, parsed.data as z.infer<typeof taskShape>);
  if (foreignError) { res.status(400).json({ error: foreignError }); return; }
  const updates = { ...parsed.data, completedAt: parsed.data.status === "completed" ? new Date() : undefined };
  const [row] = await db.update(tasks).set(updates).where(and(eq(tasks.orgId, req.currentOrg!.id), eq(tasks.id, String(req.params.taskId)))).returning();
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(row);
});
router.post("/orgs/:orgId/tasks/:taskId/complete", ...taskGate, async (req, res): Promise<void> => {
  const [row] = await db.update(tasks).set({ status: "completed", completedAt: new Date() }).where(and(eq(tasks.orgId, req.currentOrg!.id), eq(tasks.id, String(req.params.taskId)))).returning();
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(row);
});

const agentShape = z.object({
  name: z.string().min(1).max(120), type: z.enum(["lead_qualifier", "follow_up_sequencer", "renewal_monitor"]),
  systemPrompt: z.string().max(10_000).nullable().optional(), config: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(false), executionFrequency: z.enum(["realtime", "hourly", "daily"]).default("realtime"),
});
router.get("/orgs/:orgId/agents", ...automationGate, async (req, res) => {
  res.json(await db.select().from(aiAgents).where(eq(aiAgents.orgId, req.currentOrg!.id)).orderBy(desc(aiAgents.createdAt)));
});
router.post("/orgs/:orgId/agents", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = agentShape.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const tools = parsed.data.type === "lead_qualifier" ? ["create_opportunity", "draft_email", "schedule_task"] : ["draft_email", "schedule_task"];
  const [row] = await db.insert(aiAgents).values({ ...parsed.data, tools, orgId: req.currentOrg!.id, createdBy: req.currentUser!.id }).returning();
  res.status(201).json(row);
});
router.patch("/orgs/:orgId/agents/:agentId", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = agentShape.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [row] = await db.update(aiAgents).set(parsed.data).where(and(eq(aiAgents.orgId, req.currentOrg!.id), eq(aiAgents.id, String(req.params.agentId)))).returning();
  if (!row) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(row);
});
router.delete("/orgs/:orgId/agents/:agentId", ...automationAdmin, async (req, res): Promise<void> => {
  const [row] = await db.update(aiAgents).set({ active: false }).where(and(eq(aiAgents.orgId, req.currentOrg!.id), eq(aiAgents.id, String(req.params.agentId)))).returning();
  if (!row) { res.status(404).json({ error: "Agent not found" }); return; }
  res.status(204).end();
});
router.post("/orgs/:orgId/agents/:agentId/run", ...automationAdmin, async (req, res): Promise<void> => {
  const parsed = z.object({ entityType: z.enum(["lead", "account", "opportunity"]), entityId: uuid }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try { res.json(await runAgent(req.currentOrg!.id, String(req.params.agentId), parsed.data.entityType, parsed.data.entityId, req.currentUser!.id)); } catch (error) { fail(res, error); }
});
router.get("/orgs/:orgId/agent-executions", ...automationGate, async (req, res) => {
  res.json(await db.select().from(agentExecutions).where(eq(agentExecutions.orgId, req.currentOrg!.id)).orderBy(desc(agentExecutions.executedAt)).limit(500));
});

type ParsedCommand = { commands: { action: "query_largest_open_deal" | "schedule_call_task"; date?: string; time?: string }[] };
function tomorrowChicago() {
  const chicagoNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  chicagoNow.setDate(chicagoNow.getDate() + 1);
  return `${chicagoNow.getFullYear()}-${String(chicagoNow.getMonth() + 1).padStart(2, "0")}-${String(chicagoNow.getDate()).padStart(2, "0")}`;
}
router.post("/orgs/:orgId/commands/process", ...aiConsentGate, async (req, res): Promise<void> => {
  const input = z.object({ transcript: z.string().min(1).max(5000) }).safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.issues[0]?.message }); return; }
  const orgId = req.currentOrg!.id; const userId = req.currentUser!.id;
  const [history] = await db.insert(commandHistory).values({ orgId, userId, transcript: input.data.transcript, status: "processing" }).returning();
  try {
    const { text } = await callClaude({
      orgId, userId, purpose: "command_parser", maxTokens: 400,
      system: `Parse CRM text commands. Return JSON only: {"commands":[{"action":"query_largest_open_deal"|"schedule_call_task","date":"YYYY-MM-DD optional","time":"HH:mm optional"}]}. Only those two actions are allowed. Resolve relative dates in America/Chicago. Current date there is ${new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}.`,
      prompt: input.data.transcript,
    });
    const parsed = parseClaudeJson<ParsedCommand>(text);
    if (!Array.isArray(parsed.commands) || parsed.commands.some((c) => !["query_largest_open_deal", "schedule_call_task"].includes(c.action))) throw new Error("Command interpretation contained an unsupported action");
    await db.update(commandHistory).set({
      status: "awaiting_confirmation", confirmationRequired: true, interpretation: parsed,
      action: parsed.commands.map((c) => c.action).join(","),
    }).where(eq(commandHistory.id, history.id));
    res.status(202).json({ commandId: history.id, requiresConfirmation: true, interpretation: parsed });
  } catch (error) {
    await db.update(commandHistory).set({ status: "failed", errorMessage: (error as Error).message, completedAt: new Date() }).where(eq(commandHistory.id, history.id));
    fail(res, error);
  }
});
router.post("/orgs/:orgId/commands/:commandId/confirm", ...aiConsentGate, async (req, res): Promise<void> => {
  const orgId = req.currentOrg!.id; const userId = req.currentUser!.id;
  const [history] = await db.select().from(commandHistory).where(and(
    eq(commandHistory.id, String(req.params.commandId)), eq(commandHistory.orgId, orgId), eq(commandHistory.userId, userId),
  ));
  if (!history) { res.status(404).json({ error: "Command not found" }); return; }
  if (history.status === "completed") { res.json({ commandId: history.id, confirmationRequired: false, result: history.result }); return; }
  if (history.status !== "awaiting_confirmation" || !history.interpretation) { res.status(409).json({ error: "Command cannot be confirmed" }); return; }
  const parsed = history.interpretation as ParsedCommand;
  if (!Array.isArray(parsed.commands) || parsed.commands.some((c) => !["query_largest_open_deal", "schedule_call_task"].includes(c.action))) {
    res.status(409).json({ error: "Persisted command interpretation is invalid" }); return;
  }
  const mutates = parsed.commands.some((c) => c.action === "schedule_call_task");
  if (mutates && !req.currentOrg!.enabledFeatures.includes("tasks")) {
    res.status(403).json({ error: "Feature 'tasks' is not enabled for this organization", featureKey: "tasks" }); return;
  }
  const [claimed] = await db.update(commandHistory).set({ status: "executing" })
    .where(and(eq(commandHistory.id, history.id), eq(commandHistory.status, "awaiting_confirmation"))).returning();
  if (!claimed) {
    const [current] = await db.select().from(commandHistory).where(eq(commandHistory.id, history.id));
    if (current?.status === "completed") { res.json({ commandId: history.id, confirmationRequired: false, result: current.result }); return; }
    res.status(409).json({ error: "Command confirmation is already being processed" }); return;
  }
  try {
    const [deal] = await db.select().from(opportunities).where(and(
      eq(opportunities.orgId, orgId), eq(opportunities.ownerUserId, userId),
      or(sql`${opportunities.forecastCategory} is null`, and(ne(opportunities.forecastCategory, "closed_won"), ne(opportunities.forecastCategory, "closed_lost"))),
    )).orderBy(desc(sql`coalesce(${opportunities.value}, 0)::numeric`)).limit(1);
    const result: Record<string, unknown> = { largestOpenDeal: deal ? { id: deal.id, name: deal.name, value: deal.value, stage: deal.stage } : null };
    const schedule = parsed.commands.find((c) => c.action === "schedule_call_task");
    if (schedule) {
      if (!deal) throw new Error("No open deal owned by the current user was found");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(schedule.date ?? "") ? schedule.date! : (/tomorrow/i.test(history.transcript) ? tomorrowChicago() : undefined);
      if (!date) throw new Error("A valid call date is required");
      const timeMatch = schedule.time?.match(/^([01]\d|2[0-3]):[0-5]\d/) ?? history.transcript.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
      let dueTime = schedule.time;
      if (timeMatch && timeMatch.length >= 4) { let hour = Number(timeMatch[1]); if (timeMatch[3].toLowerCase() === "pm" && hour < 12) hour += 12; if (timeMatch[3].toLowerCase() === "am" && hour === 12) hour = 0; dueTime = `${String(hour).padStart(2, "0")}:${timeMatch[2] ?? "00"}`; }
      const [task] = await db.insert(tasks).values({
        orgId, accountId: deal.accountId, opportunityId: deal.id, title: `Call - ${deal.name}`,
        description: "Manual sales call scheduled from a text command. This task does not place a phone call.",
        type: "call", dueDate: date, dueTime: dueTime ?? null, assignedToUserId: userId, createdByUserId: userId,
      }).returning();
      result.scheduledTask = task;
    }
    await db.update(commandHistory).set({ status: "completed", result, completedAt: new Date() })
      .where(eq(commandHistory.id, history.id));
    res.json({ commandId: history.id, confirmationRequired: false, result });
  } catch (error) {
    await db.update(commandHistory).set({ status: "failed", errorMessage: (error as Error).message, completedAt: new Date() }).where(eq(commandHistory.id, history.id));
    fail(res, error);
  }
});
router.get("/orgs/:orgId/commands/history", ...aiConsentGate, async (req, res) => {
  res.json(await db.select().from(commandHistory).where(and(eq(commandHistory.orgId, req.currentOrg!.id), eq(commandHistory.userId, req.currentUser!.id))).orderBy(desc(commandHistory.createdAt)).limit(200));
});

export default router;