import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, lte } from "drizzle-orm";
import { db, webhookDeliveries, webhooks } from "@workspace/db";
import { logger } from "../lib/logger";

function key() {
  const dedicated = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (dedicated) {
    const value = Buffer.from(dedicated, "base64");
    if (value.length !== 32) throw new Error("WEBHOOK_ENCRYPTION_KEY must be a 32-byte base64 key");
    return value;
  }
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error("WEBHOOK_ENCRYPTION_KEY or SESSION_SECRET is required");
  return createHash("sha256")
    .update("aegis-horizon:webhook-encryption:v1\0", "utf8")
    .update(sessionSecret, "utf8")
    .digest();
}
export function encryptWebhookSecret(secret: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]); return { secretCiphertext: ciphertext.toString("base64"), secretIv: iv.toString("base64"), secretTag: cipher.getAuthTag().toString("base64") }; }
function decrypt(row: typeof webhooks.$inferSelect) { const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(row.secretIv, "base64")); decipher.setAuthTag(Buffer.from(row.secretTag, "base64")); return Buffer.concat([decipher.update(Buffer.from(row.secretCiphertext, "base64")), decipher.final()]).toString("utf8"); }
function forbiddenIp(ip: string) { if (ip === "::1" || ip === "::" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true; if (isIP(ip) !== 4) return false; const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224; }
export async function validateWebhookUrl(raw: string) { let url: URL; try { url = new URL(raw); } catch { throw new Error("Invalid webhook URL"); } if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Webhook URL must be HTTPS without credentials or custom port"); const addresses = await lookup(url.hostname, { all: true, verbatim: true }); if (!addresses.length || addresses.some(({ address }) => forbiddenIp(address))) throw new Error("Webhook URL resolves to a prohibited address"); return url; }
export async function publishWebhookEvent(orgId: string, eventType: "lead.created" | "lead.updated" | "opportunity.created" | "opportunity.updated", entityId: string, data: Record<string, unknown>) {
  try { const targets = await db.select().from(webhooks).where(and(eq(webhooks.orgId, orgId), eq(webhooks.enabled, true))); const eventId = randomUUID(); await db.insert(webhookDeliveries).values(targets.filter((hook) => hook.events.includes(eventType)).map((hook) => ({ orgId, webhookId: hook.id, eventId, eventType, payload: { id: eventId, type: eventType, entityId, data } }))); }
  catch (err) { logger.error({ err, orgId, eventType }, "Webhook enqueue failed"); }
}
async function deliver(id: string) {
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)); if (!delivery || delivery.status === "delivered") return;
  const [hook] = await db.select().from(webhooks).where(and(eq(webhooks.id, delivery.webhookId), eq(webhooks.enabled, true))); if (!hook) return;
  const now = new Date(); const payload = JSON.stringify(delivery.payload); const timestamp = Math.floor(now.getTime() / 1000).toString();
  try { await validateWebhookUrl(hook.url); const signature = createHmac("sha256", decrypt(hook)).update(`${timestamp}.${payload}`).digest("hex"); const response = await fetch(hook.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Aegis-Horizon-Webhooks/1.0", "x-aegis-timestamp": timestamp, "x-aegis-signature": `sha256=${signature}` }, body: payload, signal: AbortSignal.timeout(10_000), redirect: "error" }); if (!response.ok) throw new Error(`Endpoint returned ${response.status}`); await db.update(webhookDeliveries).set({ status: "delivered", attemptCount: delivery.attemptCount + 1, responseStatus: response.status, deliveredAt: now }).where(eq(webhookDeliveries.id, id)); await db.update(webhooks).set({ lastDeliveredAt: now }).where(eq(webhooks.id, hook.id)); }
  catch (err) { const attempt = delivery.attemptCount + 1; await db.update(webhookDeliveries).set({ status: attempt >= 5 ? "failed" : "pending", attemptCount: attempt, lastError: (err as Error).message, nextAttemptAt: new Date(Date.now() + Math.min(3600_000, 60_000 * 2 ** attempt)) }).where(eq(webhookDeliveries.id, id)); }
}
let scheduler: NodeJS.Timeout | undefined;
export function startWebhookScheduler() { if (scheduler) return; scheduler = setInterval(() => void (async () => { const rows = await db.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date()))).limit(25); await Promise.all(rows.map((row) => deliver(row.id))); })().catch((err) => logger.error({ err }, "Webhook worker failed")), 60_000); scheduler.unref(); }
export async function testWebhook(hook: typeof webhooks.$inferSelect) { const [delivery] = await db.insert(webhookDeliveries).values({ orgId: hook.orgId, webhookId: hook.id, eventId: randomUUID(), eventType: "webhook.test", payload: { type: "webhook.test", data: { message: "Aegis Horizon webhook test" } } }).returning(); await deliver(delivery.id); return db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id)).then((rows) => rows[0]); }