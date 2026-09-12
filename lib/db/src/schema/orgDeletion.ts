import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Durable, deliberately org-independent deletion ledger.
 *
 * There is intentionally no foreign key to organizations (or users): the
 * completed row must remain after the organization and its audit rows are
 * purged, and it must not retain a PII payload.
 */
export const organizationDeletionLedger = pgTable(
  "organization_deletion_ledger",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    requestedByUserId: uuid("requested_by_user_id"),
    requestedByUserHash: text("requested_by_user_hash"),
    leaseOwnerUserId: uuid("lease_owner_user_id"),
    status: text("status").notNull().default("pending"),
    phase: text("phase").notNull().default("stripe"),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("organization_deletion_ledger_org_uq").on(table.organizationId),
  ],
);

export const organizationObjectBindings = pgTable(
  "organization_object_bindings",
  {
    id: uuid("id").primaryKey(),
    objectPath: text("object_path").notNull(),
    organizationId: uuid("organization_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_object_bindings_path_uq").on(table.objectPath),
    uniqueIndex("organization_object_bindings_org_path_uq").on(
      table.organizationId,
      table.objectPath,
    ),
  ],
);

export type OrganizationDeletionLedger =
  typeof organizationDeletionLedger.$inferSelect;