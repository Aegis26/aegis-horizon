import { logger } from "../lib/logger";
import { callClaude, parseClaudeJson } from "./claude";

export type ConversationAnalysis = {
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  keywords: string[];
  objections: string[];
  leaning: "positive" | "neutral" | "negative" | "unknown";
};

function valid(value: unknown): value is ConversationAnalysis {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.summary === "string" &&
    ["positive", "neutral", "negative", "mixed"].includes(String(v.sentiment)) &&
    Array.isArray(v.keywords) &&
    v.keywords.every((x) => typeof x === "string") &&
    Array.isArray(v.objections) &&
    v.objections.every((x) => typeof x === "string") &&
    ["positive", "neutral", "negative", "unknown"].includes(String(v.leaning))
  );
}

/** AI is enrichment only: this function always resolves, returning null on failure. */
export async function analyzeConversation(orgId: string, text: string): Promise<ConversationAnalysis | null> {
  if (!text.trim()) return null;
  try {
      const { text: raw } = await callClaude({
        orgId,
        purpose: "conversation_analysis",
        maxTokens: 1000,
        system: "Analyze the CRM conversation. Return ONLY JSON with exactly: summary (string), sentiment (positive|neutral|negative|mixed), keywords (string[]), objections (string[]), leaning (positive|neutral|negative|unknown).",
        prompt: text,
      });
      const parsed = parseClaudeJson<unknown>(raw);
      if (!valid(parsed)) throw new Error("Anthropic response did not match required schema");
      return parsed;
  } catch (error) {
    logger.warn({ err: error, orgId }, "Conversation analysis failed");
    return null;
  }
}