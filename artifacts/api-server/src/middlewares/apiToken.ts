import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { apiTokenRateLimits, apiTokens, db } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      currentApiToken?: typeof apiTokens.$inferSelect;
    }
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** API-token authentication for explicitly public machine endpoints only. */
export async function requireApiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.length > 512) {
    res.status(401).json({ error: "A bearer API token is required" });
    return;
  }
  const now = new Date();
  const [apiToken] = await db.select().from(apiTokens).where(and(
    eq(apiTokens.tokenHash, sha256(token)),
    isNull(apiTokens.revokedAt),
    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
  ));
  if (!apiToken) {
    res.status(401).json({ error: "Invalid, expired, or revoked API token" });
    return;
  }
  const windowStartedAt = new Date(now);
  windowStartedAt.setUTCSeconds(0, 0);
  // A single INSERT...ON CONFLICT update is atomic under concurrent requests.
  const result = await db.execute(sql`
    insert into api_token_rate_limits (id, token_id, window_started_at, request_count, updated_at)
    values (gen_random_uuid(), ${apiToken.id}, ${windowStartedAt}, 1, ${now})
    on conflict (token_id, window_started_at)
    do update set request_count = api_token_rate_limits.request_count + 1, updated_at = ${now}
    returning request_count
  `);
  const count = Number((result.rows[0] as { request_count?: number } | undefined)?.request_count ?? 0);
  if (count > apiToken.rateLimitPerMinute) {
    res.status(429).set("Retry-After", String(60 - now.getUTCSeconds())).json({ error: "API token rate limit exceeded" });
    return;
  }
  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, apiToken.id));
  req.currentApiToken = apiToken;
  next();
}