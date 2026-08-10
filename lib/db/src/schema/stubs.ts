// Placeholder tables created now, populated in later phases.
// These stubs allow migrations to run cleanly without blocking Phases 2-6.
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

function stub(tableName: string) {
  return pgTable(tableName, {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });
}

export const quotes = stub("quotes");
export const cases = stub("cases");
export const contracts = stub("contracts");
export const documents = stub("documents");
export const workflows = stub("workflows");
export const aiPredictions = stub("ai_predictions");
export const recommendations = stub("recommendations");
export const integrations = stub("integrations");
export const webhooks = stub("webhooks");
