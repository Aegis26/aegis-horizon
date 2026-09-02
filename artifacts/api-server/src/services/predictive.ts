import { and, desc, eq, sql } from "drizzle-orm";
import {
  accounts,
  activities,
  aiRecommendations,
  churnPredictions,
  closePredictions,
  contacts,
  conversionPredictions,
  db,
  leads,
  opportunities,
  quotes,
} from "@workspace/db";

type Factor = { factor: string; weight: number; detail: string };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export async function calculateChurn(orgId: string, accountId: string) {
  const [account] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId)));
  if (!account) throw new Error("Account not found");
  const [lastActivity] = await db.select({ createdAt: activities.createdAt }).from(activities)
    .where(and(eq(activities.orgId, orgId), eq(activities.accountId, accountId)))
    .orderBy(desc(activities.createdAt)).limit(1);
  const daysInactive = lastActivity ? Math.floor((Date.now() - lastActivity.createdAt.getTime()) / 86400000) : 180;
  const factors: Factor[] = [];
  let score = 0.1;
  if (daysInactive >= 90) { score += 0.45; factors.push({ factor: "no_activity_90_days", weight: 0.45, detail: `${daysInactive} days since activity` }); }
  else if (daysInactive >= 30) { score += 0.2; factors.push({ factor: "low_recent_engagement", weight: 0.2, detail: `${daysInactive} days since activity` }); }
  if (account.nextRenewalDate) {
    const days = Math.ceil((new Date(`${account.nextRenewalDate}T00:00:00Z`).getTime() - Date.now()) / 86400000);
    if (days >= 0 && days <= 30) { score += 0.25; factors.push({ factor: "renewal_within_30_days", weight: 0.25, detail: `${days} days to renewal` }); }
  }
  if (account.healthScore === "red") { score += 0.25; factors.push({ factor: "red_health_score", weight: 0.25, detail: "Account health is red" }); }
  score = clamp(score);
  const level = score >= 0.85 ? "critical" : score >= 0.65 ? "high" : score >= 0.35 ? "medium" : "low";
  const [previous] = await db.select().from(churnPredictions).where(and(eq(churnPredictions.orgId, orgId), eq(churnPredictions.accountId, accountId)));
  const materiallyChanged = !previous || previous.riskLevel !== level || Math.abs(Number(previous.riskScore) - score) >= 0.1;
  const version = materiallyChanged ? (previous?.version ?? 0) + 1 : previous!.version;
  const recommendation = daysInactive >= 30 ? "Contact the account owner and schedule a customer check-in." : "Review renewal goals with the account owner.";
  const [prediction] = await db.insert(churnPredictions).values({
    orgId, accountId, version, riskScore: String(score), riskLevel: level, riskFactors: factors,
    daysUntilChurn: level === "critical" ? 30 : level === "high" ? 60 : null, recommendedAction: recommendation,
  }).onConflictDoUpdate({
    target: [churnPredictions.orgId, churnPredictions.accountId],
    set: { version, riskScore: String(score), riskLevel: level, riskFactors: factors, recommendedAction: recommendation, updatedAt: new Date() },
  }).returning();
  if (["high", "critical"].includes(level)) {
    const sourceKey = `churn:${accountId}:v${version}`;
    const [alert] = await db.insert(aiRecommendations).values({
      orgId, userId: account.ownerUserId, accountId, type: "risk_alert",
      title: `${account.name} has ${level} churn risk`, description: factors.map((f) => f.detail).join("; "),
      suggestedAction: recommendation, confidence: String(Math.min(0.95, 0.55 + factors.length * 0.1)), source: "predictive", sourceKey,
    }).onConflictDoNothing().returning();
    if (alert && !prediction.alertedAt) {
      await db.update(churnPredictions).set({ alertedAt: new Date() }).where(eq(churnPredictions.id, prediction.id));
      prediction.alertedAt = new Date();
    }
  }
  return prediction;
}

export async function calculateConversion(orgId: string, leadId: string) {
  const [lead] = await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, leadId)));
  if (!lead) throw new Error("Lead not found");
  let score = 0.15;
  const factors: Factor[] = [];
  if ((lead.score ?? 0) >= 60) { score += 0.3; factors.push({ factor: "strong_lead_score", weight: 0.3, detail: `Lead score ${lead.score}` }); }
  if ((lead.intentScore ?? 0) >= 60) { score += 0.25; factors.push({ factor: "high_intent", weight: 0.25, detail: `Intent score ${lead.intentScore}` }); }
  if (lead.email && lead.phone) { score += 0.1; factors.push({ factor: "complete_contact_data", weight: 0.1, detail: "Email and phone available" }); }
  if ((lead.companySize ?? 0) >= 10) { score += 0.1; factors.push({ factor: "company_fit", weight: 0.1, detail: `${lead.companySize} employees` }); }
  if (lead.status === "qualified") score += 0.1;
  score = clamp(score);
  const predictedCloseDate = new Date(Date.now() + (score >= 0.7 ? 45 : 90) * 86400000).toISOString().slice(0, 10);
  const [row] = await db.insert(conversionPredictions).values({
    orgId, leadId, conversionProbability: String(score), predictedCloseDate, factors,
  }).onConflictDoUpdate({
    target: [conversionPredictions.orgId, conversionPredictions.leadId],
    set: { conversionProbability: String(score), predictedCloseDate, factors, updatedAt: new Date() },
  }).returning();
  return row;
}

export async function calculateClose(orgId: string, opportunityId: string) {
  const [opportunity] = await db.select().from(opportunities).where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, opportunityId)));
  if (!opportunity) throw new Error("Opportunity not found");
  const baselineMap: Record<string, number> = { prospecting: 0.1, qualified: 0.25, proposal: 0.5, negotiation: 0.75, closed_won: 1, closed_lost: 0 };
  const baseline = baselineMap[opportunity.stage.toLowerCase()] ?? clamp((opportunity.probability ?? 20) / 100);
  // This baseline is an always-applicable explanation of the starting
  // probability, not a fabricated adjustment. Keeping it in the persisted
  // factor array guarantees every close prediction is explainable even when
  // no quote, staleness, or stakeholder signal applies.
  const factors: Factor[] = [{
    factor: "stage_probability_baseline",
    weight: baseline,
    detail: `Stage "${opportunity.stage}" establishes a ${(baseline * 100).toFixed(0)}% baseline probability`,
  }];
  let score = baseline;
  const [acceptedQuote] = await db.select({ id: quotes.id }).from(quotes)
    .where(and(eq(quotes.orgId, orgId), eq(quotes.opportunityId, opportunityId), eq(quotes.status, "accepted"))).limit(1);
  if (acceptedQuote) { score += 0.2; factors.push({ factor: "quote_accepted", weight: 0.2, detail: "Customer accepted a quote" }); }
  else {
    const [sentQuote] = await db.select({ id: quotes.id }).from(quotes)
      .where(and(eq(quotes.orgId, orgId), eq(quotes.opportunityId, opportunityId), eq(quotes.status, "sent"))).limit(1);
    if (sentQuote) { score += 0.08; factors.push({ factor: "quote_sent", weight: 0.08, detail: "Quote sent" }); }
  }
  if ((opportunity.daysInStage ?? 0) > 14) { score -= 0.15; factors.push({ factor: "stalled_stage", weight: -0.15, detail: `${opportunity.daysInStage} days in stage` }); }
  const [{ count: contactCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.accountId, opportunity.accountId)));
  if (contactCount >= 2) { score += 0.1; factors.push({ factor: "multiple_stakeholders", weight: 0.1, detail: `${contactCount} contacts` }); }
  score = clamp(score);
  const [row] = await db.insert(closePredictions).values({
    orgId, opportunityId, predictedProbability: String(score), baselineByStage: String(baseline),
    adjustmentFactors: factors, expectedCloseDate: opportunity.expectedCloseDate, confidence: String(Math.min(0.95, 0.6 + factors.length * 0.08)),
  }).onConflictDoUpdate({
    target: [closePredictions.orgId, closePredictions.opportunityId],
    set: { predictedProbability: String(score), baselineByStage: String(baseline), adjustmentFactors: factors, expectedCloseDate: opportunity.expectedCloseDate, confidence: String(Math.min(0.95, 0.6 + factors.length * 0.08)), updatedAt: new Date() },
  }).returning();
  return row;
}