import assert from "node:assert/strict";
import test from "node:test";
import { datePeriod } from "./commissionPeriods";

test("commission periods use UTC calendar boundaries", () => {
  const now = new Date("2025-01-01T00:30:00-08:00");
  const today = datePeriod("today", now);
  assert.equal(today.start.toISOString(), "2025-01-01T00:00:00.000Z");
  assert.equal(today.end.toISOString(), "2025-01-02T00:00:00.000Z");

  const sevenDays = datePeriod("7days", now);
  assert.equal(sevenDays.start.toISOString(), "2024-12-26T00:00:00.000Z");
  assert.equal(sevenDays.end.toISOString(), "2025-01-02T00:00:00.000Z");

  const month = datePeriod("month", now);
  assert.equal(month.start.toISOString(), "2025-01-01T00:00:00.000Z");
  assert.equal(month.end.toISOString(), "2025-02-01T00:00:00.000Z");

  const year = datePeriod("year", now);
  assert.equal(year.start.toISOString(), "2025-01-01T00:00:00.000Z");
  assert.equal(year.end.toISOString(), "2026-01-01T00:00:00.000Z");
});
