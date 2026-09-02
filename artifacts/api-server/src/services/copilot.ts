import { and, desc, eq, gt } from "drizzle-orm";
import {
  accounts,
  activities,
  aiRecommendations,
  aiSummaries,
  db,
  emailMessages,
  emailThreads,
  opportunities,
} from "@workspace/db";
import { callClaude, getAiBudgetStatus, parseClaudeJson } from "./claude";

type EntityType = "account" | "opportunity" | "email_thread";

function exactlyTwoSentences(value: string): string {
  const sentences = value.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sentences.length >= 2) return `${sentences[0]} ${sentences[1]}`;
  const first = sentences[0] ?? "There is not enough CRM activity to summarize.";
  return `${/[.!?]$/.test(first) ? first : `${first}.`} Review the latest CRM activity before contacting this customer.`;
}

async function contextFor(orgId: string, entityType: EntityType, entityId: string) {
  if (entityType === "account") {
    const [account] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, entityId)));
    if (!account) throw new Error("Account not found");
    const [timeline, deals] = await Promise.all([
      db.select().from(activities).where(and(eq(activities.orgId, orgId), eq(activities.accountId, entityId))).orderBy(desc(activities.createdAt)).limit(20),
      db.select().from(opportunities).where(and(eq(opportunities.orgId, orgId), eq(opportunities.accountId, entityId))).orderBy(desc(opportunities.updatedAt)).limit(10),
    ]);
    return { account, timeline, opportunities: deals };
  }
  if (entityType === "opportunity") {
    const [opportunity] = await db.select().from(opportunities).where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, entityId)));
    if (!opportunity) throw new Error("Opportunity not found");
    const [account] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, opportunity.accountId)));
    const timeline = await db.select().from(activities).where(and(eq(activities.orgId, orgId), eq(activities.opportunityId, entityId))).orderBy(desc(activities.createdAt)).limit(20);
    return { account, opportunity, timeline };
  }
  const [thread] = await db.select().from(emailThreads).where(and(eq(emailThreads.orgId, orgId), eq(emailThreads.id, entityId)));
  if (!thread) throw new Error("Email thread not found");
  const messages = await db.select().from(emailMessages).where(and(eq(emailMessages.orgId, orgId), eq(emailMessages.threadId, entityId))).orderBy(desc(emailMessages.sentAt)).limit(20);
  return { thread, messages };
}

export async function summarize(orgId: string, userId: string, entityType: EntityType, entityId: string) {
  const budget = await getAiBudgetStatus(orgId);
  if (!budget.consentEnabled) {
    const error = new Error("AI consent is disabled for this organization") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
  const [cached] = await db.select().from(aiSummaries).where(and(
    eq(aiSummaries.orgId, orgId), eq(aiSummaries.entityType, entityType),
    eq(aiSummaries.entityId, entityId), gt(aiSummaries.expiresAt, new Date()),
  ));
  if (cached) return { ...cached, cached: true };
  const context = await contextFor(orgId, entityType, entityId);
  const { text } = await callClaude({
    orgId, userId, purpose: `copilot_summary_${entityType}`, maxTokens: 900,
    system: "You are a concise CRM copilot. Return JSON only: summaryShort (exactly two concise sentences), summaryLong (one concise paragraph), nextBestAction (one concrete action), topics (up to 5 strings), sentiment (positive|neutral|negative). Do not invent facts.",
    prompt: JSON.stringify(context),
  });
  const parsed = parseClaudeJson<Record<string, unknown>>(text);
  if (typeof parsed.summaryShort !== "string" || typeof parsed.nextBestAction !== "string") throw new Error("Claude summary response was invalid");
  const values = {
    orgId, entityType, entityId, summaryShort: exactlyTwoSentences(parsed.summaryShort),
    summaryLong: typeof parsed.summaryLong === "string" ? parsed.summaryLong : null,
    nextBestAction: parsed.nextBestAction,
    topics: Array.isArray(parsed.topics) ? parsed.topics.filter((x): x is string => typeof x === "string").slice(0, 5) : [],
    sentiment: ["positive", "neutral", "negative"].includes(String(parsed.sentiment)) ? String(parsed.sentiment) : "neutral",
    generatedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  const [row] = await db.insert(aiSummaries).values(values).onConflictDoUpdate({
    target: [aiSummaries.orgId, aiSummaries.entityType, aiSummaries.entityId],
    set: values,
  }).returning();
  return { ...row, cached: false };
}

export async function draftEmail(orgId: string, userId: string, accountId: string, context: string, tone?: string) {
  const [account] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId)));
  if (!account) throw new Error("Account not found");
  const recent = await db.select({ body: emailMessages.bodyText, snippet: emailMessages.snippet, direction: emailMessages.direction })
    .from(emailMessages).innerJoin(emailThreads, eq(emailMessages.threadId, emailThreads.id))
    .where(and(eq(emailMessages.orgId, orgId), eq(emailThreads.accountId, accountId)))
    .orderBy(desc(emailMessages.sentAt)).limit(8);
  const { text } = await callClaude({
    orgId, userId, purpose: "copilot_email_draft", maxTokens: 800,
    system: "Draft an editable CRM email only; never send it. Match the style of recent outbound messages. Return plain email body with no markdown, analysis, subject line, or JSON. Keep it concise and include a clear call to action.",
    prompt: JSON.stringify({ account: { name: account.name, industry: account.industry }, requestedTone: tone ?? "match recent email", context, recentMessages: recent }),
  });
  return { draft: text.trim(), editable: true, sent: false };
}

export async function nextAction(orgId: string, userId: string, accountId: string) {
  const result = await summarize(orgId, userId, "account", accountId);
  const sourceKey = `copilot:next:${accountId}:${result.generatedAt.toISOString()}`;
  await db.insert(aiRecommendations).values({
    orgId, userId, accountId, type: "next_action", title: "Next best action",
    description: result.summaryShort, suggestedAction: result.nextBestAction,
    confidence: "0.750", source: "copilot", sourceKey,
  }).onConflictDoNothing();
  return { action: result.nextBestAction, rationale: result.summaryShort, confidence: 0.75 };
}