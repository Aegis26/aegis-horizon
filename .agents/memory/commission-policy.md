---
name: Commission access and ledger policy
description: Owner-only commission controls and deliberate limits on historical recalculation.
---

Commission configuration and team-wide earnings are Owner-only; every other role, including Admin and Manager, sees only its own earnings.

**Why:** The supplied commission specification allowed Admin access, but the user explicitly chose to preserve the newer Owner-only Settings rule when asked about the conflict.

**How to apply:** Do not restore Admin access when reusing examples from the original attachment.

Earned commissions are snapshots, not a live recalculation of the current deal or employee rate. Reopening/reclosing must not pay the same deal twice, and existing closed deals are not automatically backfilled.

**Why:** Retroactive rate changes and duplicate close events would otherwise silently change earned financial amounts. Historical backfill and commission reversals were not requested.

**How to apply:** Treat backfill, reversals, and retrospective adjustments as explicit future business decisions rather than side effects of ordinary deal editing. Complete account deletion must also remove the deleted person's commission snapshots from surviving workspaces.

Product names are Owner-defined, with a separately configured rate for every employee/product pair—not one shared percentage for all employees.

**Why:** The user explicitly clarified that the Owner classifies the products and that rates can differ by employee for each product.

**How to apply:** Preserve legacy General rates for unclassified deals, but never silently apply them to a classified deal lacking a matching product rate. Avoid inventing default product names or copying rates into new categories.

Product references must not become null through deletion.

**Why:** Null means General in commission tiers. SET NULL would silently reclassify product rates and can collide with the existing General rate during organization cascades.

**How to apply:** Keep products deactivatable rather than individually deletable, preserve ledger product-name snapshots, and maintain foreign-key behavior that rejects individual deletion while allowing complete organization cleanup.