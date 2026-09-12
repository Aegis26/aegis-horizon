import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Account deletion state is deliberately independent of users.  A completed
 * row is the tombstone that prevents Clerk attach/provisioning from recreating
 * an identity after its local user row is gone.  It contains only opaque
 * identifiers and operation state, never email/name or other PII.
 */
export const accountDeletionLedger = pgTable(
  "account_deletion_ledger",
  {
    id: uuid("id").primaryKey(),
    // Needed while a deletion is in progress; cleared when completed so the
    // retained tombstone does not retain a local user UUID.
    userId: uuid("user_id"),
    userOpaqueHash: text("user_opaque_hash").notNull(),
    status: text("status").notNull().default("pending"),
    phase: text("phase").notNull().default("organizations"),
    currentOrganizationId: uuid("current_organization_id"),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("account_deletion_ledger_user_uq").on(table.userId),
    uniqueIndex("account_deletion_ledger_hash_uq").on(table.userOpaqueHash),
  ],
);

export type AccountDeletionLedger = typeof accountDeletionLedger.$inferSelect;