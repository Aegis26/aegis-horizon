---
name: CRM row access policy
description: Product decisions governing non-management CRM visibility, reassignment, unassigned rows, and legacy ownership.
---

Regular users may access a CRM record when they currently own it or originally created it. Creator access persists after reassignment for users. Viewers may access only records they currently own. Owners, admins, and managers may access every record in their organization. Unassigned CRM records remain management-only.

**Why:** The product owner chose durable creator access for regular users, while the subsequent GET endpoint audit requirements explicitly narrowed viewers to owned-only access. Unassigned records must not become organization-wide by default.

**How to apply:** Use this policy for accounts, contacts, opportunities, leads, and any derived or child data. Backfill legacy missing ownership and creator attribution to a deterministic organization owner. Keep viewers read-only and internal UUID users as database identities while Clerk remains authoritative for authentication.

The user explicitly excepted the inbound Lead Queue: all organization roles may
view, claim, and dismiss queued leads; only management may assign others or return
unworked assigned leads to queue. Dismissed queue records remain viewable through
a filter. This does not widen permissions for other CRM records.

**Why:** The shared queue lets every member pick up prospects without exposing
unrelated unassigned CRM records.

**How to apply:** Scope the exception to queue endpoints and transitions; preserve
organization isolation and ordinary ownership permissions elsewhere.