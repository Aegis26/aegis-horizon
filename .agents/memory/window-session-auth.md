---
name: Independent window authentication
description: Security boundaries and browser constraints behind independent CRM window sessions.
---

Clerk remains the identity authority, but its shared browser session must not
grant CRM access. Each window requires explicit authentication and independently
revocable access. Provider recovery must not implicitly grant CRM access.

**Why:** The user explicitly requires logout in one window to leave another
window active. Cookie-based authentication and cosmetic local logout cannot
satisfy that requirement.

**How to apply:** Preserve the separation when adding sign-in methods, recovery,
downloads, invitations, or background synchronization. Logout success requires
confirmed server revocation, not just clearing browser state.

Browser lock names are observable across same-origin windows. Never include
credentials in lock names, even when using locks to reject cloned tab storage.

**Why:** A raw-token lock name exposed another window's bearer capability during
review. Storage isolation alone also fails when browsers copy tab storage.

**How to apply:** Use non-secret lock identifiers; retain duplicate-window and
refresh coverage when changing browser session ownership.

Identity-level revocation must serialize with authentication before password
verification through session issuance, even when no local user exists yet.

**Why:** Password reset or account deletion can otherwise miss a session issued
by an already-verified login, including first-time local provisioning.

**How to apply:** Lock by provider identity before checking whether local records
exist. Revoke all app sessions on completed recovery or account deletion while
ordinary logout revokes only the requesting window.