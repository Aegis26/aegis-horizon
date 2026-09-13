---
name: Railway schema compatibility
description: Diagnose account-detail failures against older Railway databases without weakening access checks.
---

Successful account creation does not prove account-detail schema compatibility.
Detail reads also query related contacts and opportunities, which may have
older schemas than the account table on an existing deployment.

**Why:** Development create/open/note tests passed while production logs showed
a failing related-contact SELECT. The visible UI had mislabeled all request
errors as “Account not found.” The log screenshot omitted the underlying
PostgreSQL cause, so the exact production missing field remained unconfirmed.

**How to apply:** Distinguish 404 from 401/403/500, inspect the underlying
database error, and test additive compatibility against a legacy schema.
Do not weaken tenant visibility, delete records, or use a broad schema push
to conceal a related-table failure. Confirm the deployed result separately
from a passing development reproduction.

Production contact user-reference columns can already exist as text while local
user IDs are UUIDs. Additive migrations must inspect existing types before
adding foreign keys; never assume `ADD COLUMN IF NOT EXISTS` normalized a column.

**Why:** A UUID foreign-key addition crashed Railway startup on an existing
text creator-reference column.

**How to apply:** Preserve legacy values and types during compatibility repairs,
skip incompatible foreign keys, and test both missing-column and text-column
layouts. Any future normalization requires an explicit data-mapping strategy.