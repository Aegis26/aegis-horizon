import { and, eq, isNull, lte } from "drizzle-orm";
import { db, reportSchedules } from "@workspace/db";
import { logger } from "../lib/logger";
import { executeScheduledReport } from "../routes/reports";

let timer: NodeJS.Timeout | undefined;

export function startReportScheduler() {
  if (timer) return;
  timer = setInterval(() => void runDueReports().catch((err) => logger.error({ err }, "Report scheduler failed")), 60_000);
  timer.unref();
}

async function runDueReports() {
  const now = new Date();
  const due = await db.select({ id: reportSchedules.id }).from(reportSchedules)
    .where(and(eq(reportSchedules.enabled, true), lte(reportSchedules.nextRunAt, now), isNull(reportSchedules.claimToken))).limit(25);
  for (const item of due) {
    const claimToken = crypto.randomUUID();
    // Compare-and-set claim makes concurrent interval workers safe without
    // holding a network/email transaction lock.
    const [claimed] = await db.update(reportSchedules).set({ claimToken, claimedAt: now })
      .where(and(eq(reportSchedules.id, item.id), isNull(reportSchedules.claimToken), lte(reportSchedules.nextRunAt, now))).returning({ id: reportSchedules.id });
    if (!claimed) continue;
    try { await executeScheduledReport(item.id, claimToken); }
    catch (err) { logger.error({ err, scheduleId: item.id }, "Scheduled report delivery failed"); }
  }
}