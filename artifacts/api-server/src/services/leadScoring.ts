import { and, eq } from "drizzle-orm";
import {
  db,
  leads,
  leadScoringRules,
  territories,
  type Lead,
  type LeadScoringRule,
  type Territory,
} from "@workspace/db";

/**
 * Rules-based lead scoring engine.
 *
 * Rules are admin-configured rows with an array of conditions
 * ({ field, operator, value }) that ALL must match, plus an action:
 *   - add: score += points
 *   - set: score = points (highest-priority matching "set" wins, applied last)
 * Rules run in ascending priority order; the final score is clamped 0..100.
 */

export type RuleCondition = {
  field: string;
  operator: string;
  value: string | null;
};

const NUMERIC_FIELDS = new Set([
  "companySize",
  "intentScore",
  "annualRevenue",
  "score",
]);

function leadFieldValue(lead: Lead, field: string): string | number | null {
  switch (field) {
    case "companySize":
      return lead.companySize;
    case "intentScore":
      return lead.intentScore;
    case "annualRevenue":
      return lead.annualRevenue === null ? null : Number(lead.annualRevenue);
    case "industry":
      return lead.industry;
    case "country":
      return lead.country;
    case "state":
      return lead.state;
    case "source":
      return lead.source;
    case "productInterest":
      return lead.productInterest;
    case "title":
      return lead.title;
    case "company":
      return lead.company;
    case "email":
      return lead.email;
    default:
      return null;
  }
}

export function conditionMatches(lead: Lead, cond: RuleCondition): boolean {
  const raw = leadFieldValue(lead, cond.field);

  if (cond.operator === "is_empty") {
    return raw === null || raw === "";
  }
  if (cond.operator === "is_not_empty") {
    return raw !== null && raw !== "";
  }
  if (raw === null) return false;

  if (NUMERIC_FIELDS.has(cond.field)) {
    const left = Number(raw);
    const right = Number(cond.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    switch (cond.operator) {
      case "equals":
        return left === right;
      case "not_equals":
        return left !== right;
      case "gt":
        return left > right;
      case "gte":
        return left >= right;
      case "lt":
        return left < right;
      case "lte":
        return left <= right;
      default:
        return false;
    }
  }

  const left = String(raw).toLowerCase();
  const right = (cond.value ?? "").toLowerCase();
  switch (cond.operator) {
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "contains":
      return left.includes(right);
    default:
      return false;
  }
}

export function computeScore(lead: Lead, rules: LeadScoringRule[]): number {
  const active = rules
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority);

  let score = 0;
  let setValue: number | null = null;
  for (const rule of active) {
    const conds = (rule.conditions ?? []) as RuleCondition[];
    if (conds.length === 0) continue;
    const matches = conds.every((c) => conditionMatches(lead, c));
    if (!matches) continue;
    if (rule.actionType === "set") {
      setValue = rule.points;
    } else {
      score += rule.points;
    }
  }
  const final = setValue !== null ? setValue : score;
  return Math.max(0, Math.min(100, final));
}

export async function scoreLead(orgId: string, lead: Lead): Promise<number> {
  const rules = await db
    .select()
    .from(leadScoringRules)
    .where(eq(leadScoringRules.orgId, orgId));
  return computeScore(lead, rules);
}

/**
 * Territory routing: match the lead's geography (state, then country) or
 * product interest against active territories. Returns the matched territory
 * (with its owner) or null.
 */
export function matchTerritory(
  lead: Lead,
  allTerritories: Territory[],
): Territory | null {
  const active = allTerritories.filter((t) => t.isActive);
  const state = lead.state?.toLowerCase();
  const country = lead.country?.toLowerCase();
  const product = lead.productInterest?.toLowerCase();

  const byState = state
    ? active.find((t) => (t.states ?? []).some((s) => s.toLowerCase() === state))
    : undefined;
  if (byState) return byState;

  const byCountry = country
    ? active.find((t) =>
        (t.countries ?? []).some((c) => c.toLowerCase() === country),
      )
    : undefined;
  if (byCountry) return byCountry;

  const byProduct = product
    ? active.find((t) =>
        (t.products ?? []).some((p) => p.toLowerCase() === product),
      )
    : undefined;
  return byProduct ?? null;
}

/** Score + route a lead, persisting the results. Returns the updated row. */
export async function scoreAndRouteLead(
  orgId: string,
  lead: Lead,
  opts: { reassign?: boolean; keepScore?: boolean } = {},
): Promise<Lead> {
  const [rules, orgTerritories] = await Promise.all([
    db.select().from(leadScoringRules).where(eq(leadScoringRules.orgId, orgId)),
    db
      .select()
      .from(territories)
      .where(and(eq(territories.orgId, orgId), eq(territories.isActive, true))),
  ]);

  const updates: Partial<typeof leads.$inferInsert> = {};
  if (!opts.keepScore) {
    updates.score = computeScore(lead, rules);
  }

  if (opts.reassign || !lead.assignedToUserId) {
    const territory = matchTerritory(lead, orgTerritories);
    if (territory) {
      updates.territoryId = territory.id;
      if (territory.ownerUserId) {
        updates.assignedToUserId = territory.ownerUserId;
      }
    }
  }

  if (Object.keys(updates).length === 0) return lead;
  const [row] = await db
    .update(leads)
    .set(updates)
    .where(eq(leads.id, lead.id))
    .returning();
  return row;
}
