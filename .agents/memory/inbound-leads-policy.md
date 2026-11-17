---
name: Lead Radar intake policy
description: User-approved organization binding, visibility and future multi-key scope.
---

Bind the single Lead Radar key only to Aegis Cyber Defense, Inc via server-side
`INBOUND_LEADS_ORG_ID`; never accept tenant identity from request data.
New leads remain unassigned and management-only.

**Why:** The user explicitly chose this isolation and visibility policy.

**How to apply:** Keep the single-org release scoped to environment configuration.
Structure authentication for a future table of hashed API keys, each tied to
one organization, but do not implement multi-customer key management until asked.
