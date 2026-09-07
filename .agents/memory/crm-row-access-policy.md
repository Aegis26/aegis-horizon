---
name: CRM row access policy
description: Product decisions governing non-management CRM visibility, reassignment, unassigned rows, and legacy ownership.
---

Regular users and viewers may access a CRM record when they currently own it or originally created it. Creator access persists after reassignment. Owners, admins, and managers may access every record in their organization. Unassigned CRM records remain management-only.

**Why:** The product owner explicitly chose durable creator access so reassignment does not remove access from the employee who originated the relationship, while preventing unassigned records from becoming organization-wide by default.

**How to apply:** Use this policy for accounts, contacts, opportunities, leads, and any derived or child data. Backfill legacy missing ownership and creator attribution to a deterministic organization owner. Keep viewers read-only and internal UUID users as database identities while Clerk remains authoritative for authentication.