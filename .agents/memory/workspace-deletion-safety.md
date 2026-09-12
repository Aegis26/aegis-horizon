---
name: Workspace deletion safety
description: Cross-system deletion constraints and why deletion needs writer draining and independent audit retention.
---

Workspace deletion must drain admitted writers, not merely reject new requests. Hold per-organization locks across external side effects as well as database writes.

**Why:** A request admitted before a deletion flag can still create an uploaded object or subscription after cleanup has swept it. An atomic database cascade alone cannot prevent that.

**How to apply:** Include new background jobs and public/API-token mutation paths in the same writer admission mechanism. Keep advisory-lock connections separate from the ordinary query pool; long-lived lock holders still need query connections, so sharing one bounded pool can deadlock.

Retain only a minimal independent deletion audit after the tenant cascade; preserve global login accounts and other memberships.

**Why:** The requested permanent workspace deletion also requires a surviving audit and continued login access. Tenant-scoped audit rows cannot provide that because they cascade with the organization.

**How to apply:** Do not attach the deletion audit to a cascading organization foreign key or retain deleted workspace payloads in it. Failed external cleanup may already have irreversible effects; resume cleanup rather than promising rollback or restoring write access.

Complete account deletion is a separate operation from workspace deletion. Remove the Clerk identity only after owned-workspace cleanup, and keep resumable internal recovery for failures after Clerk invalidates the login.

**Why:** Deleting the local identity first can let just-in-time authentication recreate a ghost account; deleting Clerk first prevents the user from authenticating to retry workspace cleanup. Recovery cannot depend solely on a browser retry.

**How to apply:** Preserve an opaque completed identity tombstone that blocks the old Clerk identity without blocking a new signup with the same email. Serialize ownership grants against the target user's deletion claim; a check followed by a separate membership update is not a sufficient fence. User and organization lock admission must not compete for the same bounded connection pool.