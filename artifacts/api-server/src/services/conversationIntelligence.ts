import { logger } from "../lib/logger";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** AI is enrichment only: this function always resolves, returning null on failure. */
export async function analyzeConversation(text: string): Promise<ConversationAnalysis | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey || !text.trim()) return null;

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
          max_tokens: 8192,
          system:
            "Analyze the CRM conversation. Return ONLY JSON with exactly: summary (string), sentiment (positive|neutral|negative|mixed), keywords (string[]), objections (string[]), leaning (positive|neutral|negative|unknown).",
          messages: [{ role: "user", content: text.slice(0, 100_000) }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
      const payload = (await response.json()) as { content?: { type?: string; text?: string }[] };
      const raw = payload.content?.find((b) => b.type === "text")?.text;
      if (!raw) throw new Error("Anthropic returned no text");
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
      if (!valid(parsed)) throw new Error("Anthropic response did not match required schema");
      return parsed;
    } catch (error) {
      if (attempt === 2) {
        logger.warn({ err: error }, "Conversation analysis failed");
        return null;
      }
      await sleep(500 * 2 ** attempt);
    }
  }
  return null;
}