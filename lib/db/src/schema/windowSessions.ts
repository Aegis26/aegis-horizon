import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * CRM browser sessions are deliberately separate from Clerk sessions. Only a
 * SHA-256 digest of the random browser credential is persisted, so a database
 * read cannot be replayed as an authenticated CRM request.
 */
export const windowSessions = pgTable(
  "window_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("window_sessions_user_active_idx").on(table.userId, table.revokedAt),
    index("window_sessions_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * Database-backed login throttling makes brute-force protection consistent
 * across API instances. The key is a hash of an IP and normalized identifier;
 * no email address or password is retained.
 */
export const windowLoginAttempts = pgTable("window_login_attempts", {
  keyHash: text("key_hash").primaryKey(),
  failures: integer("failures").notNull().default(0),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WindowSession = typeof windowSessions.$inferSelect;