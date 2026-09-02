import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  aiUsage,
  communicationSettings,
  db,
  organizations,
} from "@workspace/db";

export class AiConsentError extends Error {
  status = 403;
  constructor() { super("AI consent is disabled for this organization"); }
}
export class AiBudgetError extends Error {
  status = 429;
  constructor() { super("Organization monthly AI token budget is exhausted"); }
}

const DEFAULT_BUDGETS: Record<string, number> = {
  essential: 10_000,
  professional: 100_000,
  enterprise: 1_000_000,
  custom: 1_000_000,
};

export async function getAiBudgetStatus(orgId: string) {
  const [[org], [settings], [usage]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)),
    db.select().from(communicationSettings).where(eq(communicationSettings.orgId, orgId)),
    db.select({ used: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)::int` })
      .from(aiUsage)
      .where(and(
        eq(aiUsage.orgId, orgId),
        inArray(aiUsage.status, ["success", "reserved"]),
        gte(aiUsage.createdAt, sql`date_trunc('month', now())`),
      )),
  ]);
  if (!org) throw new Error("Organization not found");
  const config = (org.featuresConfig ?? {}) as Record<string, unknown>;
  const configured = Number(config.aiMonthlyTokenBudget);
  const budget = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : (DEFAULT_BUDGETS[org.plan] ?? DEFAULT_BUDGETS.enterprise);
  const used = Number(usage?.used ?? 0);
  return { consentEnabled: settings?.aiAnalysisEnabled === true, budget, used, remaining: Math.max(0, budget - used) };
}

type ClaudeOptions = {
  orgId: string;
  userId?: string | null;
  purpose: string;
  system: string;
  prompt: string;
  maxTokens?: number;
};

export async function callClaude(options: ClaudeOptions): Promise<{ text: string; tokensUsed: number }> {
  const budget = await getAiBudgetStatus(options.orgId);
  if (!budget.consentEnabled) throw new AiConsentError();
  const maxTokens = Math.min(options.maxTokens ?? 1200, 4096);
  // One token per UTF-16 code unit is intentionally conservative so a
  // concurrent request can never reserve less than its likely input usage.
  const estimatedInputTokens = options.system.length + options.prompt.length;
  const outputLimit = Math.min(maxTokens, budget.remaining - estimatedInputTokens);
  if (outputLimit < 100) throw new AiBudgetError();
  const reservedTokens = estimatedInputTokens + outputLimit;
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Anthropic integration is not configured");

  const [reservation] = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${options.orgId}))`);
    const [current] = await tx.select({ used: sql<number>`coalesce(sum(${aiUsage.totalTokens}), 0)::int` })
      .from(aiUsage)
      .where(and(
        eq(aiUsage.orgId, options.orgId),
        inArray(aiUsage.status, ["success", "reserved"]),
        gte(aiUsage.createdAt, sql`date_trunc('month', now())`),
      ));
    if (Number(current?.used ?? 0) + reservedTokens > budget.budget) {
      throw new AiBudgetError();
    }
    return tx.insert(aiUsage).values({
      orgId: options.orgId,
      userId: options.userId,
      purpose: options.purpose,
      model: "claude-sonnet-5",
      totalTokens: reservedTokens,
      status: "reserved",
    }).returning();
  });

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: outputLimit,
          system: options.system,
          messages: [{ role: "user", content: options.prompt.slice(0, 100_000) }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
      const payload = await response.json() as {
        id?: string;
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = payload.content?.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Anthropic returned no text");
      const inputTokens = payload.usage?.input_tokens ?? 0;
      const outputTokens = payload.usage?.output_tokens ?? 0;
      const totalTokens = inputTokens + outputTokens;
      await db.update(aiUsage).set({
        inputTokens,
        outputTokens,
        totalTokens,
        requestId: payload.id,
        status: "success",
      }).where(eq(aiUsage.id, reservation.id));
      return { text, tokensUsed: totalTokens };
    } catch (error) {
      lastError = error as Error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  await db.update(aiUsage).set({
    totalTokens: 0,
    status: "failed",
    errorMessage: lastError?.message ?? "Unknown AI error",
  }).where(eq(aiUsage.id, reservation.id));
  throw lastError ?? new Error("Claude request failed");
}

export function parseClaudeJson<T>(text: string): T {
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}