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