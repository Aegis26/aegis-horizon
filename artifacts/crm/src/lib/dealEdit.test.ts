import assert from "node:assert/strict";
import { test } from "node:test";
import { dealDraftFromOpportunity, parseDealDraft } from "./dealEdit";

test("editing preserves existing fields, converts blanks to null and accepts zero", () => {
  const draft = dealDraftFromOpportunity({
    name: "Original", value: "20", expectedCloseDate: "2026-12-01",
    probability: 45, nextAction: "Call",
  });
  assert.deepEqual(draft, {
    name: "Original", value: "20", expectedCloseDate: "2026-12-01",
    probability: "45", nextAction: "Call",
  });
  assert.deepEqual(parseDealDraft({
    ...draft, name: " Updated ", value: "0", expectedCloseDate: "",
    probability: "0", nextAction: " ",
  }, false), {
    data: { name: "Updated", value: "0", expectedCloseDate: null, probability: 0, nextAction: null },
  });
  assert.deepEqual(parseDealDraft({ ...draft, value: "", probability: "" }, false).data, {
    name: "Original", value: null, expectedCloseDate: "2026-12-01", probability: null, nextAction: "Call",
  });
});

test("rejects invalid edits and missing value on won deals", () => {
  const draft = dealDraftFromOpportunity({ name: "Deal" });
  assert.match(parseDealDraft(draft, true).error!, /requires a value/);
  assert.match(parseDealDraft({ ...draft, name: " " }, false).error!, /name/);
  for (const value of ["-1", "NaN", "1e3"]) {
    assert.match(parseDealDraft({ ...draft, value }, false).error!, /non-negative/);
  }
  for (const probability of ["-1", "101", "1.5"]) {
    assert.match(parseDealDraft({ ...draft, probability }, false).error!, /whole number/);
  }
});