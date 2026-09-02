import {
  boolean,
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
import { accounts, opportunities } from "./crm";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

/**
 * Report definitions contain only API field keys and operators. They are
 * intentionally data, never SQL identifiers; the report service maps every
 * key through a static allowlist before constructing a query.
 */
export const customReports = pgTable(
  "custom_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    entityType: text("entity_type").notNull(),
    definition: jsonb("definition").default({}).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("custom_reports_org_created_idx").on(t.orgId, t.createdAt),
    uniqueIndex("custom_reports_org_name_uq").on(t.orgId, t.name),
  ],
);

export const reportExports = pgTable(
  "report_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").references(() => customReports.id, { onDelete: "set null" }),
    format: text("format").notNull(),
    status: text("status").default("pending").notNull(),
    objectPath: text("object_path"),
    contentType: text("content_type"),
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    rowCount: integer("row_count"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("report_exports_org_created_idx").on(t.orgId, t.createdAt),
    index("report_exports_status_idx").on(t.status, t.createdAt),
  ],
);

/** Immutable execution history, retained independently from downloadable files. */
export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => customReports.id, { onDelete: "cascade" }),
    status: text("status").default("running").notNull(),
    rowCount: integer("row_count").default(0).notNull(),
    parameters: jsonb("parameters").default({}).notNull(),
    errorMessage: text("error_message"),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("report_runs_org_report_created_idx").on(t.orgId, t.reportId, t.startedAt)],
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => customReports.id, { onDelete: "cascade" }),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").default("UTC").notNull(),
    format: text("format").notNull(),
    recipientEmails: text("recipient_emails").array().default([]).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("report_schedules_due_idx").on(t.enabled, t.nextRunAt),
    index("report_schedules_org_idx").on(t.orgId),
  ],
);

/** Logical document; object bytes are represented by immutable versions. */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    signatureFields: jsonb("signature_fields").default([]).notNull(),
    currentVersion: integer("current_version").default(0).notNull(),
    status: text("status").default("active").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_org_account_idx").on(t.orgId, t.accountId),
    index("documents_org_opportunity_idx").on(t.orgId, t.opportunityId),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    objectPath: text("object_path").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    source: text("source").default("upload").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("document_versions_document_version_uq").on(t.documentId, t.version),
    uniqueIndex("document_versions_org_object_path_uq").on(t.orgId, t.objectPath),
  ],
);

export const signatureRequests = pgTable(
  "signature_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "restrict" }),
    status: text("status").default("pending").notNull(),
    message: text("message"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    signedDocumentVersionId: uuid("signed_document_version_id").references(() => documentVersions.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("signature_requests_org_status_idx").on(t.orgId, t.status)],
);

export const signatureSigners = pgTable(
  "signature_signers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    signatureRequestId: uuid("signature_request_id").notNull().references(() => signatureRequests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    signingOrder: integer("signing_order").default(0).notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").default("pending").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signingIp: text("signing_ip"),
    userAgent: text("user_agent"),
    signatureData: jsonb("signature_data"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("signature_signers_token_hash_uq").on(t.tokenHash),
    uniqueIndex("signature_signers_request_email_uq").on(t.signatureRequestId, t.email),
  ],
);

export const signatureAuditEvents = pgTable(
  "signature_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    signatureRequestId: uuid("signature_request_id").notNull().references(() => signatureRequests.id, { onDelete: "cascade" }),
    signerId: uuid("signer_id").references(() => signatureSigners.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("signature_audit_request_created_idx").on(t.signatureRequestId, t.createdAt)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    permissions: text("permissions").array().default([]).notNull(),
    rateLimitPerMinute: integer("rate_limit_per_minute").default(60).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_org_idx").on(t.orgId),
  ],
);

/** Fixed one-minute buckets; incremented transactionally by token auth. */
export const apiTokenRateLimits = pgTable(
  "api_token_rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id").notNull().references(() => apiTokens.id, { onDelete: "cascade" }),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("api_token_rate_window_uq").on(t.tokenId, t.windowStartedAt)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    events: text("events").array().default([]).notNull(),
    /** AES-GCM encrypted HMAC key; never returned by API responses. */
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhooks_org_enabled_idx").on(t.orgId, t.enabled)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("webhook_delivery_event_uq").on(t.webhookId, t.eventId),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

/**
 * Status/config metadata only. Clerk remains authoritative for MFA and SAML;
 * no MFA secrets, recovery codes, IdP certificates, or SAML config are stored.
 */
export const orgSecurityPolicies = pgTable(
  "org_security_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    mfaRequired: boolean("mfa_required").default(false).notNull(),
    clerkMfaStatus: text("clerk_mfa_status").default("not_configured").notNull(),
    ssoRequired: boolean("sso_required").default(false).notNull(),
    clerkSsoStatus: text("clerk_sso_status").default("not_configured").notNull(),
    clerkDashboardConfiguredAt: timestamp("clerk_dashboard_configured_at", { withTimezone: true }),
    ipAllowlistEnabled: boolean("ip_allowlist_enabled").default(false).notNull(),
    allowedCidrs: text("allowed_cidrs").array().default([]).notNull(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_security_policies_org_uq").on(t.orgId)],
);

/** Global, append-only security and business audit ledger. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorApiTokenId: uuid("actor_api_token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_events_org_entity_idx").on(t.orgId, t.entityType, t.entityId),
  ],
);

export const industryTemplateApplications = pgTable(
  "industry_template_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").default(1).notNull(),
    status: text("status").default("applied").notNull(),
    result: jsonb("result").default({}).notNull(),
    appliedByUserId: uuid("applied_by_user_id").references(() => users.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("industry_template_org_key_version_uq").on(t.orgId, t.templateKey, t.templateVersion)],
);

export const orgCustomFields = pgTable(
  "org_custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    dataType: text("data_type").notNull(),
    config: jsonb("config").default({}).notNull(),
    templateKey: text("template_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_custom_fields_entity_key_uq").on(t.orgId, t.entityType, t.fieldKey)],
);

export const orgCustomRoles = pgTable(
  "org_custom_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    name: text("name").notNull(),
    permissions: text("permissions").array().default([]).notNull(),
    templateKey: text("template_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_custom_roles_org_key_uq").on(t.orgId, t.roleKey)],
);

export type CustomReport = typeof customReports.$inferSelect;
export type ReportExport = typeof reportExports.$inferSelect;
export type ReportRun = typeof reportRuns.$inferSelect;
export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type SignatureRequest = typeof signatureRequests.$inferSelect;
export type SignatureSigner = typeof signatureSigners.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type OrgSecurityPolicy = typeof orgSecurityPolicies.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type IndustryTemplateApplication = typeof industryTemplateApplications.$inferSelect;