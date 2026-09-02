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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

/** Connector-owned credentials are deliberately never persisted here. */
export const providerSyncStates = pgTable(
  "provider_sync_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerEmail: text("provider_email"),
    status: text("status").default("connected").notNull(),
    cursor: text("cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    syncLockedAt: timestamp("sync_locked_at", { withTimezone: true }),
    syncLockToken: text("sync_lock_token"),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("provider_sync_org_provider_account_uq").on(t.orgId, t.provider, t.providerAccountId),
    uniqueIndex("provider_sync_org_provider_uq").on(t.orgId, t.provider),
  ],
);

/** A connector is deployment-global, so its provider can be claimed by one org only. */
export const providerBindings = pgTable(
  "provider_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    boundByUserId: uuid("bound_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    providerAccountId: text("provider_account_id").notNull(),
    providerAccountEmail: text("provider_account_email").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("provider_bindings_provider_uq").on(t.provider),
    uniqueIndex("provider_bindings_org_provider_uq").on(t.orgId, t.provider),
  ],
);

export const communicationSettings = pgTable(
  "communication_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    aiAnalysisEnabled: boolean("ai_analysis_enabled").default(false).notNull(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("communication_settings_org_uq").on(t.orgId)],
);

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    participants: jsonb("participants").default([]).notNull(),
    summary: text("summary"),
    sentiment: text("sentiment"),
    keywords: text("keywords").array(),
    objections: text("objections").array(),
    leaning: text("leaning"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("email_threads_org_provider_external_uq").on(t.orgId, t.provider, t.externalThreadId)],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => emailThreads.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalMessageId: text("external_message_id").notNull(),
    sender: text("sender"),
    recipients: jsonb("recipients").default([]).notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    direction: text("direction"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("email_messages_org_provider_external_uq").on(t.orgId, t.provider, t.externalMessageId)],
);

export const callRecordings = pgTable(
  "call_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    callSid: text("call_sid").notNull(),
    recordingSid: text("recording_sid"),
    status: text("status").default("initiated").notNull(),
    fromNumber: text("from_number"),
    toNumber: text("to_number").notNull(),
    recordingObjectPath: text("recording_object_path"),
    transcript: text("transcript"),
    summary: text("summary"),
    sentiment: text("sentiment"),
    keywords: text("keywords").array(),
    objections: text("objections").array(),
    leaning: text("leaning"),
    correlationTokenHash: text("correlation_token_hash").notNull(),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("call_recordings_org_call_sid_uq").on(t.orgId, t.callSid),
    uniqueIndex("call_recordings_correlation_uq").on(t.correlationTokenHash),
  ],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    attendees: jsonb("attendees").default([]).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    meetingUrl: text("meeting_url"),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("calendar_events_org_provider_external_uq").on(t.orgId, t.provider, t.externalEventId)],
);

export const internalNotes = pgTable(
  "internal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    mentionedUserIds: uuid("mentioned_user_ids").array().default([]).notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("internal_notes_org_id_uq").on(t.orgId, t.id)],
);

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
  threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
  callRecordingId: uuid("call_recording_id").references(() => callRecordings.id, { onDelete: "set null" }),
  calendarEventId: uuid("calendar_event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
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
}, (t) => [
  uniqueIndex("activities_org_external_message_uq").on(t.orgId, t.externalMessageId)
    .where(sql`${t.externalMessageId} is not null`),
]);

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
export type ProviderSyncState = typeof providerSyncStates.$inferSelect;
export type EmailThread = typeof emailThreads.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type CallRecording = typeof callRecordings.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InternalNote = typeof internalNotes.$inferSelect;
export type ProviderBinding = typeof providerBindings.$inferSelect;
export type CommunicationSettings = typeof communicationSettings.$inferSelect;
