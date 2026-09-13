export type CommissionPeriod = "today" | "7days" | "month" | "year";

export function datePeriod(period: CommissionPeriod, now = new Date()): {
  start: Date;
  end: Date;
} {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  let start: Date;
  let end: Date;
  switch (period) {
    case "today":
      start = startOfToday;
      end = new Date(startOfToday);
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case "7days":
      // Seven UTC calendar dates including today.
      start = new Date(startOfToday);
      start.setUTCDate(start.getUTCDate() - 6);
      end = new Date(startOfToday);
      end.setUTCDate(end.getUTCDate() + 1);
      break;
    case "month":
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      break;
    case "year":
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
      break;
  }
  return { start, end };
}
