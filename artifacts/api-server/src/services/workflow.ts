import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  accounts,
  aiRecommendations,
  automationEvents,
  db,
  leads,
  opportunities,
  opportunityStageHistory,
  tasks,
  workflowExecutions,
  workflows,
  type Workflow,
} from "@workspace/db";
import { logger } from "../lib/logger";

export type WorkflowTrigger = {
  type: "record_created" | "field_change" | "time_based";
  entityType: "lead" | "opportunity" | "account";
  field?: string;
  schedule?: "hourly" | "daily";
};
export type WorkflowCondition = {
  field: string;
  operator: "equals" | "not_equals" | "gt" | "gte" | "lt" | "lte" | "contains";
  value: string | number | boolean;
};
export type WorkflowAction = {
  type: "create_task" | "create_recommendation" | "create_opportunity" | "update_field";
  config: Record<string, unknown>;
};

const ALLOWED_UPDATE_FIELDS: Record<string, Set<string>> = {
  lead: new Set(["status", "score"]),
  opportunity: new Set(["nextAction", "probability"]),
  account: new Set(["healthScore", "riskLevel"]),
};

function valueAt(record: Record<string, unknown>, field: string): unknown {
  if (field === "days_in_stage" || field === "daysInStage") return record.daysInStage;
  return record[field];
}

function matches(record: Record<string, unknown>, condition: WorkflowCondition): boolean {
  const left = valueAt(record, condition.field);
  const right = condition.value;
  switch (condition.operator) {
    case "equals": return String(left ?? "").toLowerCase() === String(right).toLowerCase();
    case "not_equals": return String(left ?? "").toLowerCase() !== String(right).toLowerCase();
    case "gt": return Number(left) > Number(right);
    case "gte": return Number(left) >= Number(right);
    case "lt": return Number(left) < Number(right);
    case "lte": return Number(left) <= Number(right);
    case "contains": return String(left ?? "").toLowerCase().includes(String(right).toLowerCase());
  }
}

async function loadEntity(orgId: string, type: string, id: string) {
  if (type === "lead") return db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, id))).then((r) => r[0]);
  if (type === "opportunity") {
    const row = await db.select().from(opportunities).where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, id))).then((r) => r[0]);
    if (!row) return undefined;
    const latest = await db.select({ createdAt: opportunityStageHistory.createdAt }).from(opportunityStageHistory)
      .where(and(eq(opportunityStageHistory.orgId, orgId), eq(opportunityStageHistory.opportunityId, id)))
      .orderBy(desc(opportunityStageHistory.createdAt)).limit(1).then((r) => r[0]);
    const calculated = latest ? Math.floor((Date.now() - latest.createdAt.getTime()) / 86400000) : Math.floor((Date.now() - row.updatedAt.getTime()) / 86400000);
    return { ...row, daysInStage: Math.max(row.daysInStage ?? 0, calculated) };
  }
  if (type === "account") return db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, id))).then((r) => r[0]);
  return undefined;
}

export async function planWorkflow(workflow: Workflow, entityType: string, entityId: string) {
  const entity = await loadEntity(workflow.orgId, entityType, entityId);
  if (!entity) throw new Error("Workflow entity not found in organization");
  const conditions = (workflow.conditions ?? []) as WorkflowCondition[];
  const conditionsMatched = conditions.every((condition) => matches(entity as unknown as Record<string, unknown>, condition));
  const actions = ((workflow.actions ?? []) as WorkflowAction[]).map((action, index) => ({
    index,
    type: action.type,
    config: action.config,
    status: conditionsMatched ? "planned" : "skipped",
  }));
  return { conditionsMatched, actions, entity };
}

async function executeAction(
  workflow: Workflow,
  entityType: string,
  entity: Record<string, unknown>,
  action: WorkflowAction,
  actorUserId?: string,
) {
  const config = action.config;
  if (action.type === "create_task") {
    const accountId = entityType === "account" ? String(entity.id) : (entity.accountId ? String(entity.accountId) : null);
    const opportunityId = entityType === "opportunity" ? String(entity.id) : null;
    const [task] = await db.insert(tasks).values({
      orgId: workflow.orgId,
      accountId,
      opportunityId,
      title: String(config.title ?? "Follow up"),
      description: typeof config.description === "string" ? config.description : `Created by workflow: ${workflow.name ?? workflow.id}`,
      type: String(config.type ?? "follow_up"),
      assignedToUserId: (entity.ownerUserId ?? entity.assignedToUserId ?? actorUserId) as string | undefined,
      dueDate: typeof config.dueDate === "string" ? config.dueDate : new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      createdByUserId: actorUserId,
    }).returning();
    return { taskId: task.id };
  }
  if (action.type === "create_recommendation") {
    const sourceKey = `workflow:${workflow.id}:${entity.id}:${workflow.version}:${String(config.key ?? "recommendation")}`;
    const [row] = await db.insert(aiRecommendations).values({
      orgId: workflow.orgId,
      userId: (entity.ownerUserId ?? entity.assignedToUserId ?? actorUserId) as string | undefined,
      accountId: entityType === "account" ? String(entity.id) : (entity.accountId ? String(entity.accountId) : undefined),
      opportunityId: entityType === "opportunity" ? String(entity.id) : undefined,
      type: String(config.recommendationType ?? "next_action"),
      title: String(config.title ?? "Workflow recommendation"),
      description: String(config.description ?? ""),
      suggestedAction: String(config.suggestedAction ?? ""),
      source: "workflow",
      sourceKey,
    }).onConflictDoNothing().returning();
    return { recommendationId: row?.id ?? null };
  }
  if (action.type === "create_opportunity") {
    if (entityType !== "lead") throw new Error("create_opportunity is only valid for leads");
    let accountId = typeof config.accountId === "string" ? config.accountId : null;
    if (accountId) {
      const valid = await loadEntity(workflow.orgId, "account", accountId);
      if (!valid) throw new Error("Action accountId is outside organization");
    } else {
      const [account] = await db.insert(accounts).values({
        orgId: workflow.orgId,
        name: String(entity.company ?? `${entity.firstName ?? ""} ${entity.lastName ?? ""}`).trim(),
        ownerUserId: (entity.assignedToUserId ?? actorUserId) as string | undefined,
      }).returning();
      accountId = account.id;
    }
    const [opportunity] = await db.insert(opportunities).values({
      orgId: workflow.orgId,
      accountId,
      name: String(config.name ?? `${entity.company ?? "Lead"} - New Business`),
      stage: "prospecting",
      probability: 10,
      ownerUserId: (entity.assignedToUserId ?? actorUserId) as string | undefined,
      value: config.value == null ? undefined : String(config.value),
    }).returning();
    await db.insert(opportunityStageHistory).values({
      orgId: workflow.orgId, opportunityId: opportunity.id, fromStage: null,
      toStage: opportunity.stage, changedByUserId: actorUserId,
    });
    return { opportunityId: opportunity.id };
  }
  if (action.type === "update_field") {
    const field = String(config.field ?? "");
    if (!ALLOWED_UPDATE_FIELDS[entityType]?.has(field)) throw new Error(`Field '${field}' is not safely allowlisted`);
    const value = config.value;
    if (entityType === "lead") await db.update(leads).set({ [field]: value }).where(and(eq(leads.orgId, workflow.orgId), eq(leads.id, String(entity.id))));
    if (entityType === "opportunity") await db.update(opportunities).set({ [field]: value }).where(and(eq(opportunities.orgId, workflow.orgId), eq(opportunities.id, String(entity.id))));
    if (entityType === "account") await db.update(accounts).set({ [field]: value }).where(and(eq(accounts.orgId, workflow.orgId), eq(accounts.id, String(entity.id))));
    return { updatedField: field };
  }
  throw new Error("Unsupported workflow action");
}

export async function executeWorkflow(
  workflow: Workflow,
  entityType: string,
  entityId: string,
  idempotencyKey: string,
  triggerData: Record<string, unknown>,
  actorUserId?: string,
) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  // A transaction-scoped advisory lock serializes quota check + durable claim
  // for one workflow/day. Duplicate keys are claimed first and consume no quota.
  const [execution] = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${workflow.id}:${dayStart.toISOString().slice(0, 10)}`}))`);
    const [alreadyClaimed] = await tx.select({ id: workflowExecutions.id }).from(workflowExecutions)
      .where(and(eq(workflowExecutions.orgId, workflow.orgId), eq(workflowExecutions.idempotencyKey, idempotencyKey)));
    if (alreadyClaimed) return [];
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(workflowExecutions)
      .where(and(eq(workflowExecutions.workflowId, workflow.id), gte(workflowExecutions.createdAt, dayStart)));
    if (count >= 100) throw new Error("Workflow daily execution limit reached");
    return tx.insert(workflowExecutions).values({
      orgId: workflow.orgId, workflowId: workflow.id, idempotencyKey, entityType, entityId,
      triggerData, status: "running", claimedAt: new Date(), executedAt: new Date(),
    }).returning();
  });
  if (!execution) return null;
  try {
    const plan = await planWorkflow(workflow, entityType, entityId);
    const results: unknown[] = [];
    if (plan.conditionsMatched) {
      for (const action of (workflow.actions ?? []) as WorkflowAction[]) {
        results.push({ type: action.type, status: "success", result: await executeAction(workflow, entityType, plan.entity as unknown as Record<string, unknown>, action, actorUserId) });
      }
    }
    await db.update(workflowExecutions).set({ status: "success", actionResults: results, completedAt: new Date() }).where(eq(workflowExecutions.id, execution.id));
    await db.update(workflows).set({ executionCount: sql`${workflows.executionCount} + 1`, lastExecutedAt: new Date() }).where(eq(workflows.id, workflow.id));
    return { ...execution, status: "success", actionResults: results };
  } catch (error) {
    await db.update(workflowExecutions).set({ status: "failed", errorMessage: (error as Error).message, completedAt: new Date() }).where(eq(workflowExecutions.id, execution.id));
    throw error;
  }
}

export async function publishAutomationEvent(input: {
  orgId: string; eventKey: string; eventType: string; entityType: string; entityId: string;
  payload?: Record<string, unknown>; actorUserId?: string;
}) {
  let eventId: string | undefined;
  try {
    const [event] = await db.insert(automationEvents).values({ ...input, payload: input.payload ?? {} }).onConflictDoNothing().returning();
    if (!event) return;
    eventId = event.id;
    const candidates = await db.select().from(workflows).where(and(eq(workflows.orgId, input.orgId), eq(workflows.active, true)));
    for (const workflow of candidates) {
      const trigger = workflow.trigger as WorkflowTrigger | null;
      if (!trigger || trigger.type !== input.eventType || trigger.entityType !== input.entityType) continue;
      if (trigger.type === "field_change" && trigger.field && input.payload?.field !== trigger.field) continue;
      await executeWorkflow(workflow, input.entityType, input.entityId, `${workflow.id}:${input.eventKey}`, input.payload ?? {}, input.actorUserId);
    }
    await db.update(automationEvents).set({ status: "processed", processedAt: new Date() }).where(eq(automationEvents.id, event.id));
  } catch (error) {
    if (eventId) {
      void db.update(automationEvents).set({ status: "failed", lastError: (error as Error).message })
        .where(eq(automationEvents.id, eventId)).catch((updateError) =>
          logger.error({ err: updateError, eventId }, "Automation event failure could not be persisted"),
        );
    }
    logger.error({ err: error, eventKey: input.eventKey }, "Automation event processing failed");
  }
}

let scheduler: NodeJS.Timeout | undefined;
export function startWorkflowScheduler() {
  if (scheduler) return;
  scheduler = setInterval(() => void runTimeBasedWorkflows().catch((err) => logger.error({ err }, "Workflow scheduler failed")), 60_000);
  scheduler.unref();
}

async function runTimeBasedWorkflows() {
  const rows = await db.select().from(workflows).where(eq(workflows.active, true));
  for (const workflow of rows) {
    const trigger = workflow.trigger as WorkflowTrigger | null;
    if (!trigger || trigger.type !== "time_based") continue;
    let entities: { id: string }[] = [];
    if (trigger.entityType === "opportunity") entities = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.orgId, workflow.orgId));
    if (trigger.entityType === "account") entities = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.orgId, workflow.orgId));
    if (trigger.entityType === "lead") entities = await db.select({ id: leads.id }).from(leads).where(eq(leads.orgId, workflow.orgId));
    const bucket = trigger.schedule === "hourly" ? new Date().toISOString().slice(0, 13) : new Date().toISOString().slice(0, 10);
    for (const entity of entities) {
      await executeWorkflow(workflow, trigger.entityType, entity.id, `${workflow.id}:time:${bucket}:${entity.id}`, { schedule: trigger.schedule ?? "daily" });
    }
  }
}