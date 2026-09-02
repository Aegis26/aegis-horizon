import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { accounts, leads, opportunities } from "./crm";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date());

export const aiRecommendations = pgTable("ai_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title"),
  description: text("description"),
  suggestedAction: text("suggested_action"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  source: text("source").notNull(),
  sourceKey: text("source_key"),
  dismissed: boolean("dismissed").default(false).notNull(),
  actedOn: boolean("acted_on").default(false).notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("ai_recommendations_org_created_idx").on(t.orgId, t.createdAt),
  uniqueIndex("ai_recommendations_org_source_key_uq").on(t.orgId, t.sourceKey),
]);

export const aiSummaries = pgTable("ai_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  summaryShort: text("summary_short").notNull(),
  summaryLong: text("summary_long"),
  nextBestAction: text("next_best_action").notNull(),
  topics: text("topics").array().default([]).notNull(),
  sentiment: text("sentiment"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("ai_summaries_org_entity_uq").on(t.orgId, t.entityType, t.entityId),
  index("ai_summaries_org_expiry_idx").on(t.orgId, t.expiresAt),
]);

export const churnPredictions = pgTable("churn_predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  riskScore: numeric("risk_score", { precision: 4, scale: 3 }).notNull(),
  riskLevel: text("risk_level").notNull(),
  riskFactors: jsonb("risk_factors").default([]).notNull(),
  daysUntilChurn: integer("days_until_churn"),
  recommendedAction: text("recommended_action").notNull(),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("churn_predictions_org_account_uq").on(t.orgId, t.accountId),
  index("churn_predictions_org_risk_idx").on(t.orgId, t.riskLevel),
]);

export const conversionPredictions = pgTable("conversion_predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  conversionProbability: numeric("conversion_probability", { precision: 4, scale: 3 }).notNull(),
  predictedCloseDate: date("predicted_close_date", { mode: "string" }),
  factors: jsonb("factors").default([]).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("conversion_predictions_org_lead_uq").on(t.orgId, t.leadId)]);

export const closePredictions = pgTable("close_predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  predictedProbability: numeric("predicted_probability", { precision: 4, scale: 3 }).notNull(),
  baselineByStage: numeric("baseline_by_stage", { precision: 4, scale: 3 }).notNull(),
  adjustmentFactors: jsonb("adjustment_factors").default([]).notNull(),
  expectedCloseDate: date("expected_close_date", { mode: "string" }),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("close_predictions_org_opportunity_uq").on(t.orgId, t.opportunityId)]);

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name"),
  description: text("description"),
  trigger: jsonb("trigger"),
  conditions: jsonb("conditions").default([]).notNull(),
  actions: jsonb("actions").default([]).notNull(),
  active: boolean("active").default(false).notNull(),
  version: integer("version").default(1).notNull(),
  lastDryRunVersion: integer("last_dry_run_version"),
  executionCount: integer("execution_count").default(0).notNull(),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("workflows_org_active_idx").on(t.orgId, t.active)]);

export const workflowExecutions = pgTable("workflow_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  triggerData: jsonb("trigger_data").default({}).notNull(),
  actionResults: jsonb("action_results").default([]).notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("workflow_executions_org_key_uq").on(t.orgId, t.idempotencyKey),
  index("workflow_executions_workflow_created_idx").on(t.workflowId, t.createdAt),
  index("workflow_executions_status_idx").on(t.status, t.createdAt),
]);

export const automationEvents = pgTable("automation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  status: text("status").default("pending").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("automation_events_org_key_uq").on(t.orgId, t.eventKey),
  index("automation_events_status_created_idx").on(t.status, t.createdAt),
]);

export const aiAgents = pgTable("ai_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  systemPrompt: text("system_prompt"),
  config: jsonb("config").default({}).notNull(),
  tools: text("tools").array().default([]).notNull(),
  active: boolean("active").default(false).notNull(),
  executionFrequency: text("execution_frequency").default("realtime").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("ai_agents_org_active_idx").on(t.orgId, t.active),
  uniqueIndex("ai_agents_org_name_uq").on(t.orgId, t.name),
]);

export const agentExecutions = pgTable("agent_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => aiAgents.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  input: jsonb("input").default({}).notNull(),
  decisionRationale: text("decision_rationale"),
  actions: jsonb("actions").default([]).notNull(),
  output: text("output"),
  status: text("status").notNull(),
  tokensUsed: integer("tokens_used").default(0).notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("agent_executions_org_key_uq").on(t.orgId, t.idempotencyKey),
  index("agent_executions_org_executed_idx").on(t.orgId, t.executedAt),
]);

export const commandHistory = pgTable("command_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  transcript: text("transcript").notNull(),
  interpretation: jsonb("interpretation"),
  action: text("action"),
  status: text("status").notNull(),
  confirmationRequired: boolean("confirmation_required").default(false).notNull(),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("command_history_org_user_created_idx").on(t.orgId, t.userId, t.createdAt)]);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  totalTokens: integer("total_tokens").default(0).notNull(),
  requestId: text("request_id"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
}, (t) => [
  index("ai_usage_org_created_idx").on(t.orgId, t.createdAt),
  uniqueIndex("ai_usage_org_request_uq").on(t.orgId, t.requestId),
]);

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowExecution = typeof workflowExecutions.$inferSelect;
export type AiAgent = typeof aiAgents.$inferSelect;
export type AgentExecution = typeof agentExecutions.$inferSelect;
export type AiSummary = typeof aiSummaries.$inferSelect;
export type ChurnPrediction = typeof churnPredictions.$inferSelect;