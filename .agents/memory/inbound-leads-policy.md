---
name: Lead Radar intake policy
description: User-approved organization binding, visibility and future multi-key scope.
---

Bind the single Lead Radar key only to Aegis Cyber Defense, Inc via server-side
`INBOUND_LEADS_ORG_ID`; never accept tenant identity from request data.
New inbound leads must remain unassigned in a queue visible to every organization
role, including viewers. Do not create Accounts or Contacts until claim or manager
assignment. Flag existing-account domain matches and preserve existing Accounts.

**Why:** The user retained server-side organization isolation but replaced the
management-only intake policy with an all-role lead queue.

**How to apply:** Keep the single-org release scoped to environment configuration.
Structure authentication for a future table of hashed API keys, each tied to
one organization, but do not implement multi-customer key management until asked.

Retain inbound request logs for 90 days, with automatic cleanup.

**Why:** The user explicitly approved this retention period before the first push.

**How to apply:** Expire only request logs, never CRM records or idempotency data;
keep the production migration and retention instructions consistent.

Queue-provisioned Accounts and Contacts must follow the receiving assignee after
return/reclaim, while unrelated matched client entities keep their ownership.

**Why:** A rep who receives a returned lead must be able to work and qualify it
without widening the ordinary CRM row-access policy or duplicating a client.

**How to apply:** Require explicit provisioning provenance; a domain match alone
does not authorize ownership transfer. Preserve original creator attribution.
