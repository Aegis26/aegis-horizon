import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

/** Database time defines the boundary; exactly 90-day-old rows are retained. */
export async function cleanupInboundLeadLogs(
  client: Pick<PoolClient, "query"> = pool,
): Promise<number> {
  const result = await client.query(`
    DELETE FROM inbound_lead_log
    WHERE timestamp < now() - interval '90 days'
  `);
  return result.rowCount ?? 0;
}

/** Like the other API schedulers, run once on startup and then periodically. */
export function startInboundLeadRetention(): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const deletedRows = await cleanupInboundLeadLogs();
      logger.info({ deletedRows, retentionDays: 90 }, "Inbound lead log cleanup completed");
    } catch {
      // No request payloads, keys, or raw database exception parameters in logs.
      logger.error({ retentionDays: 90 }, "Inbound lead log cleanup failed; next daily run will retry");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 24 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
