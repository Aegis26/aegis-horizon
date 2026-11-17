import { pgTable, uuid, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const inboundLeadLog = pgTable("inbound_lead_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  externalId: text("external_id"),
  result: text("result").notNull(),
  error: text("error"),
});

export const inboundLeadRate = pgTable("inbound_lead_rate", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  keyId: text("key_id").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, (t) => [primaryKey({ columns: [t.orgId, t.keyId] })]);
