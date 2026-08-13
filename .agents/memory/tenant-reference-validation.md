---
name: Tenant-scoped reference validation
description: Cross-tenant ID injection risk in org-scoped CRM endpoints
---

Rule: In this multi-tenant CRM, any ID accepted in a request body that references another entity (owner/assignee user IDs, territory IDs, pipeline IDs, etc.) must be validated as belonging to `req.currentOrg` before writing. Serializer lookups (e.g. resolving an assignee's name) must also filter by the record's orgId, not just the referenced ID.

**Why:** Code review found endpoints that accepted arbitrary platform user/territory/pipeline IDs, letting one tenant bind records to another tenant's entities and leak their user names/emails.

**How to apply:** Use `isOrgMember(orgId, userId)` (via orgUsers) and org-scoped existence checks in the sales routes as the pattern; replicate for any new org-scoped endpoint that stores foreign keys from the request body.
