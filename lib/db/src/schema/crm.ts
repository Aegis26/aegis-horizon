import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  industry: text("industry"),
  annualRevenue: numeric("annual_revenue"),
  employeeCount: integer("employee_count"),
  website: text("website"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  zip: text("zip"),
  parentAccountId: uuid("parent_account_id"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  healthScore: text("health_score").default("green"),
  ltv: numeric("ltv"),
  riskLevel: text("risk_level").default("low"),
  churnPredictionScore: numeric("churn_prediction_score", {
    precision: 3,
    scale: 2,
  }),
  nextRenewalDate: date("next_renewal_date", { mode: "string" }),
  files: jsonb("files").default([]),
  metadata: jsonb("metadata").default({}),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  department: text("department"),
  roleInDeal: text("role_in_deal"),
  seniority: text("seniority"),
  engagementLevel: integer("engagement_level"),
  relationshipStrength: integer("relationship_strength"),
  reportsToContactId: uuid("reports_to_contact_id"),
  metadata: jsonb("metadata").default({}),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pipelineId: uuid("pipeline_id"),
  stage: text("stage").notNull(),
  probability: integer("probability").default(0),
  value: numeric("value"),
  expectedCloseDate: date("expected_close_date", { mode: "string" }),
  actualCloseDate: date("actual_close_date", { mode: "string" }),
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  products: jsonb("products").default([]),
  competitors: text("competitors").array().default([]),
  blockers: text("blockers").array().default([]),
  requiredApprovals: uuid("required_approvals").array().default([]),
  forecastCategory: text("forecast_category"),
  lossReason: text("loss_reason"),
  nextAction: text("next_action"),
  activityCount: integer("activity_count").default(0),
  daysInStage: integer("days_in_stage").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  subject: text("subject"),
  body: text("body"),
  participants: jsonb("participants").default([]),
  direction: text("direction"),
  externalMessageId: text("external_message_id"),
  callRecordingUrl: text("call_recording_url"),
  callTranscript: text("call_transcript"),
  sentiment: text("sentiment"),
  keywords: text("keywords").array().default([]),
  attachments: jsonb("attachments").default([]),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type"),
  status: text("status").default("open"),
  priority: text("priority").default("medium"),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  dueDate: date("due_date", { mode: "string" }),
  dueTime: time("due_time"),
  reminderAt: timestamp("reminder_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  estimatedDurationMinutes: integer("estimated_duration_minutes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const segments = pgTable("segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Array of condition objects: { field, operator, value }
  conditions: jsonb("conditions").default([]).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  // Array of stage objects: { key, name, probability, forecastCategory, order, isClosedWon, isClosedLost }
  stages: jsonb("stages").default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const opportunityStageHistory = pgTable("opportunity_stage_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const territories = pgTable("territories", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  countries: text("countries").array().default([]),
  states: text("states").array().default([]),
  products: text("products").array().default([]),
  quota: numeric("quota"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  title: text("title"),
  industry: text("industry"),
  companySize: integer("company_size"),
  annualRevenue: numeric("annual_revenue"),
  intentScore: integer("intent_score"),
  country: text("country"),
  state: text("state"),
  productInterest: text("product_interest"),
  source: text("source"),
  status: text("status").default("new").notNull(),
  score: integer("score").default(0).notNull(),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  territoryId: uuid("territory_id").references(() => territories.id, {
    onDelete: "set null",
  }),
  convertedOpportunityId: uuid("converted_opportunity_id"),
  metadata: jsonb("metadata").default({}),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const leadScoringRules = pgTable("lead_scoring_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Array of condition objects: { field, operator, value }
  conditions: jsonb("conditions").default([]).notNull(),
  // Action: { type: "add" | "set", points: number }
  actionType: text("action_type").default("add").notNull(),
  points: integer("points").default(0).notNull(),
  priority: integer("priority").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  quoteNumber: text("quote_number").notNull(),
  status: text("status").default("draft").notNull(),
  // Array of line item objects: { name, description, quantity, unitPriceCents, discountPercent }
  lineItems: jsonb("line_items").default([]).notNull(),
  discountPercent: numeric("discount_percent").default("0"),
  validUntil: date("valid_until", { mode: "string" }),
  recipientEmail: text("recipient_email"),
  notes: text("notes"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Pipeline = typeof pipelines.$inferSelect;
export type OpportunityStageHistory = typeof opportunityStageHistory.$inferSelect;
export type Territory = typeof territories.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadScoringRule = typeof leadScoringRules.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Task = typeof tasks.$inferSelect;
