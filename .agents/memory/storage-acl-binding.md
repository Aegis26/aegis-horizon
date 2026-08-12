---
name: Private object storage ACL binding
description: How private file access control works in this CRM and the pitfall in the storage template.
---

The copied object-storage template serves `/storage/objects/*` with auth/ACL checks commented out — every fresh copy is an unauthenticated tenant-data leak until wired up.

**Why:** Code review caught that any party with an object URL could download private CRM attachments across tenants.

**How to apply:** Objects are bound to an org at attach time (activity create / attach-file) via an ACL policy `{owner: clerkId, visibility: private, aclRules: [ORG_MEMBER(orgId) READ]}`; the download route requires a Clerk session and checks that policy (ORG_MEMBER membership is resolved clerkId → users → orgUsers). Any new endpoint accepting a client-supplied `objectPath` must validate the `/objects/` prefix and call the same binding helper, rejecting objects already bound to another org.
