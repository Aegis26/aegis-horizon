---
name: AI automation safety
description: Durable Phase 5 scope and safety rules for Copilot, workflows, agents, and commands
---

Rule: Phase 5 voice input uses browser speech recognition with a typed fallback; Twilio voice and embeddings/vector search are out of scope.

**Why:** The user explicitly chose browser speech and deferred embeddings. Automated call recording was already deferred separately.

**How to apply:** Keep backend commands transcript-based. Do not add audio storage, telephony, or vector infrastructure unless the user explicitly expands scope.

Rule: AI agents must validate entitlement, explicit organization consent, and token budget and complete a bounded Claude planning call before any CRM mutation. Agents may draft emails but never send them.

**Why:** Partial mutations before AI access checks can change customer data even when consent is disabled or the budget is exhausted.

**How to apply:** Order agent execution as access check → token reservation/model plan → schema validation → idempotent allowlisted writes → concise audit. Never persist hidden chain-of-thought.

Rule: Workflow activation requires a successful dry-run of the current version, execution is idempotent, and the 100-runs-per-workflow daily limit must be reserved atomically.

**Why:** Stale tests, retries, and concurrent events can otherwise activate untested actions or exceed safety limits.

**How to apply:** Any workflow edit invalidates prior dry-run approval. Claim idempotency and daily quota under the same database lock before actions.

Rule: Mutating natural-language commands always require confirmation of the exact persisted interpretation.

**Why:** Inferring approval from wording can execute unintended tasks.

**How to apply:** Parsing has no side effects. Confirm by command ID with an atomic one-time claim; repeated confirmation returns the prior result or a conflict without duplicating work.