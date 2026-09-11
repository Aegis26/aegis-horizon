---
name: Invitation compatibility
description: Why email invitations retain pre-provisioned membership semantics.
---

Invitation email delivery preserves the existing pre-provisioned memberships rather than introducing an acceptance-gated membership lifecycle. Seven-day expiry applies to the invitation link, not the underlying membership.

**Why:** The email-delivery request explicitly required preserving membership creation on delivery failure. Keeping that behavior also avoids a separate production schema migration for this fix. Do not describe these memberships as pending access or imply that link expiry revokes access.

**How to apply:** A future acceptance-gated lifecycle must be treated as an explicit authorization change with a legacy-membership migration, not as a cosmetic invitation-email update.