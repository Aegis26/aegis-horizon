import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCommissionAmount,
  normalizeCommissionPercentage,
} from "./commissionMath";

test("commission math preserves decimal precision and rounds to cents", () => {
  assert.deepEqual(calculateCommissionAmount("10000.00", "10.50"), {
    opportunityValue: "10000.00",
    commissionAmount: "1050.00",
  });
  assert.deepEqual(calculateCommissionAmount("100.005", "10.00"), {
    opportunityValue: "100.01",
    commissionAmount: "10.00",
  });
  assert.deepEqual(calculateCommissionAmount("0.01", "33.33"), {
    opportunityValue: "0.01",
    commissionAmount: "0.00",
  });
  assert.deepEqual(calculateCommissionAmount("0.005", "50"), {
    opportunityValue: "0.01",
    commissionAmount: "0.01",
  });
});

test("commission rate validation is exact and bounded", () => {
  assert.equal(normalizeCommissionPercentage("0"), "0.00");
  assert.equal(normalizeCommissionPercentage("10.5"), "10.50");
  assert.equal(normalizeCommissionPercentage("100.00"), "100.00");
  assert.throws(
    () => normalizeCommissionPercentage("10.001"),
    /at most 2 decimal places/,
  );
  assert.throws(
    () => normalizeCommissionPercentage("100.01"),
    /between 0 and 100/,
  );
  assert.throws(
    () => calculateCommissionAmount("-1", "10"),
    /non-negative decimal/,
  );
});
