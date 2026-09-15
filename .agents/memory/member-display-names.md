---
name: Workspace member display names
description: Why Owner-managed names are separate from global authentication identities.
---

Owner-managed member names belong to the workspace, not the global user or Clerk identity.

**Why:** A person may belong to multiple workspaces with different Owners. Allowing one Owner to rename the global identity would change other workspaces without their consent.

**How to apply:** Use the workspace override for member-facing labels and new commission snapshots. Preserve global login/profile identity and existing financial snapshots when a workspace label changes.