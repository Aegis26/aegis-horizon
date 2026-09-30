import assert from "node:assert/strict";
import { test } from "node:test";
import { opportunityValueError } from "./opportunityValue";

test("open deals may clear value, but won deals require an explicit valid value", () => {
  assert.equal(opportunityValueError(null), null);
  assert.match(opportunityValueError(null, true)!, /required/);
  assert.match(opportunityValueError("", true)!, /required/);
  assert.equal(opportunityValueError("0", true), null);
  assert.equal(opportunityValueError("125.50", true), null);
  for (const value of ["-1", "abc", "Infinity", "1e4", " 12 ", "1.2.3"]) {
    assert.match(opportunityValueError(value, true)!, /non-negative/);
  }
});