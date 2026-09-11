---
name: Invitation compatibility
description: Why email invitations retain pre-provisioned membership semantics.
---

Invitation email delivery preserves the existing pre-provisioned memberships rather than introducing an acceptance-gated membership lifecycle. Seven-day expiry applies to the invitation link, not the underlying membership.

**Why:** The email-delivery request explicitly required preserving membership creation on delivery failure. Keeping that behavior also avoids a separate production schema migration for this fix. Do not describe these memberships as pending access or imply that link expiry revokes access.

**How to apply:** A future acceptance-gated lifecycle must be treated as an explicit authorization change with a legacy-membership migration, not as a cosmetic invitation-email update.

Legacy offline lead drafts cannot safely be assigned to whichever account next signs in. Preserve unidentified drafts without exposing or automatically syncing them.

**Why:** Earlier drafts recorded only an organization, and owners and employees can share an organization and browser. Inferring authorship from the organization would risk disclosing or submitting someone else's unsynced work; deleting the drafts would lose data.

**How to apply:** Any future recovery UI for those drafts needs an explicit, trusted ownership decision rather than an automatic account migration.