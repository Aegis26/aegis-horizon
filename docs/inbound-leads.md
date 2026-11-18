# Lead Radar intake

## Configuration and rollout

This is a server-to-server integration, not a browser API.

Set these in the **API server's deployed environment** (Railway for this project):

- `INBOUND_LEADS_API_KEY`: a securely generated random secret of at least 32 bytes.
  Store the same value securely in Lead Radar. Never put it in frontend code,
  a URL, logs, or Git.
- `INBOUND_LEADS_ORG_ID`: the database UUID for **Aegis Cyber Defense, Inc**.
  Verify the organization record before setting it. Do not use the organization
  name, slug, Clerk ID, or a development database's UUID in production.

No real key or organization identifier is hardcoded. The request cannot choose
an organization: unknown fields, including organization IDs, are rejected.
Without a valid key intake returns 401; a valid key with invalid/unavailable
organization configuration returns 503.

The API startup runs the additive, idempotent migration in
`artifacts/api-server/src/lib/inboundLeadSchema.ts`. It creates
`inbound_lead_log`, `inbound_lead_rate`, and a tenant-scoped unique index over
the Radar external identifier in lead metadata. It does not replace existing
tables or require a broad schema push. The queue rollout also backfills eligible
active, unassigned, unworked Radar leads into `queued` and installs a trigger
that remembers work/stage changes after assignment. It never deletes Accounts.

Railway's `railway.json` starts `pnpm run start:railway`, which starts the
compiled API entry point. That entry point awaits this migration before
listening on its port, using the API service's production `DATABASE_URL`.
The migration uses a database advisory lock so concurrent replicas do not
interleave schema changes. **No separate migration command or `db:push` is
needed for this feature on the existing production database.** A migration
failure prevents the new API process from starting successfully.

To find the organization UUID, run this read-only query in production:

```sql
SELECT id AS organization_uuid, name, slug
FROM organizations
WHERE lower(trim(name)) = lower('Aegis Cyber Defense, Inc')
ORDER BY slug;
```

Verify the name and slug before using the UUID. If no row matches, inspect
the saved organization name rather than substituting a guessed ID.

Deploy the code and configure both variables before connecting Lead Radar.
Use HTTPS. A successful authenticated health request returns `{"ok":true}`.
No live configuration or production data was changed during implementation.

## Example

Set `HORIZON_BASE_URL` to your verified published Horizon origin and make
`INBOUND_LEADS_API_KEY` available securely in your shell environment.
The example creates a real test lead in the configured organization; use a
unique external ID, or repeat the same ID to test the update behavior.

```sh
curl --fail-with-body "$HORIZON_BASE_URL/api/v1/inbound/health" \
  -H "X-API-Key: $INBOUND_LEADS_API_KEY"

curl --fail-with-body "$HORIZON_BASE_URL/api/v1/inbound/leads" \
  -H "X-API-Key: $INBOUND_LEADS_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "external_id": "radar-test-001",
    "lead_type": "both",
    "company_name": "Lead Radar Test Company",
    "website": "https://example.com",
    "city": "Austin",
    "state": "TX",
    "industry": "Professional services",
    "employee_estimate": 12,
    "contact_name": "Test Contact",
    "contact_email": "test@example.com",
    "source": "manual_test",
    "source_url": "https://example.com",
    "signal_summary": "This is a synthetic intake test, not a real prospect.",
    "score": 8,
    "suggested_offer": "Website and security assessment",
    "talking_points": ["Confirm website needs", "Discuss security requirements"],
    "detected_at": "2026-11-16T14:00:00Z"
  }'
```

Responses:

- 201: `{"status":"created","lead_id":"<uuid>"}`
- 200 for an existing external ID: `{"status":"updated","lead_id":"<uuid>"}`
- 400: `{"errors":[{"field":"score","message":"..."}]}`
- 401: missing/wrong key
- 429: rate limit, with a `Retry-After` header
- 503: unavailable configuration, organization, or database

Invalid content type, invalid JSON, oversized payloads (64 KB maximum),
unknown fields, non-HTTP(S) URLs, malformed emails/dates and invalid numeric
values are rejected. Web URLs must be absolute HTTP(S) URLs without credentials.
URLs are stored, never fetched by this endpoint.

## CRM behavior

- Intake creates only a **queued**, unassigned lead with all submitted company
  and contact information in `leads.metadata.leadRadar`. It creates no Account,
  Contact, or Opportunity.
- The Lead Queue is visible to every role in the organization, including viewers.
  This is a narrow exception, not a change to ordinary CRM access permissions.
- A normalized website-domain match (ignoring `www`, case and paths) against an
  active Account in the same organization is flagged as an existing client.
- Claim assigns the current user and changes the lead to **working** atomically.
  A competing claim gets 409 with `Already claimed by <name>`.
- On claim or manager assignment, match an active Account by domain first, then
  exact company name. Create it only if absent. Reuse a Contact by email, phone
  or name on that Account; create one only when contact details exist.
  Existing Account/Contact fields and owners are never overwritten. New entities
  belong to the assignee. Links and original Radar context stay on the lead.
- Managers can assign other organization members, or return unworked assigned
  leads. A lead is worked if edited/progressed since assignment, converted, or
  its linked Account received activities/tasks since assignment. Moving a stage
  back does not erase work history. Return does not delete entities.
- Every member can dismiss queued prospects with `not a fit`, `duplicate`, or
  `existing client`; dismissed records remain available under the queue filter.
- Queue actions are immutable lead audit events, displayed as activity history
  in queue details. Existing activity/audit logging remains intact.
- Creates a retained creation note on the lead metadata, visible in lead details.
- Repeated IDs update **only** the lead score, Radar score, signal summary and
  talking points, preserving assignment, stage, links, source details and the
  original creation note. A soft-deleted lead is updated but not resurrected.
- No auto-routing, rule scoring, email, automation or enrichment side effects
  are triggered during intake.
- Queue page, dashboard card and sidebar count refresh every 15 seconds, and all
  related views refresh on actions/conflicts. The ordinary Leads page excludes
  queued/dismissed prospects; assigned leads appear there under normal permissions.
  Radar scores are on a 1–10 scale, separate from existing 0–100 rule scoring.

## Security and concurrency

Authentication compares SHA-256 digests with `timingSafeEqual`, avoiding
key-length-dependent comparison. No credential is stored in the database.
`resolveInboundPrincipal` produces an organization/key identity; the ingest
service only accepts that trusted identity. Later, this resolver can be
replaced by a hashed-key table with one organization per key, revocation and
rotation. That multi-key management system is intentionally not implemented.

The shared database rate counter allows 120 authenticated requests per
60-second fixed window, including health checks and invalid bodies. Limits
are enforced atomically across API replicas and survive restarts. Rotating
the configured secret does not reset this installation's quota.

Organization deletion admission locks are honored. Account/contact matching
and external-ID handling are serialized per organization inside a transaction;
the unique index additionally prevents duplicate external IDs.

Each inbound request gets a timestamped log row with result/error category.
Validated requests include the external ID. Requests rejected before body
parsing have a null external ID. No API key, raw payload, contact fields or
raw SQL/parser exception is logged. If the database is unavailable, intake
fails closed with 503 and emits a safe server event; a database log cannot
be guaranteed during a database outage.

### Log retention

The API runs log cleanup at startup and every 24 hours while running. It
permanently removes only `inbound_lead_log` rows whose timestamp is strictly
older than 90 days, using database time. It retains rows exactly on the
cutoff and all newer rows. Between daily sweeps an expired row can remain
for up to one additional day; a stopped service catches up on next startup.
The startup migration creates `inbound_lead_log_timestamp_idx` for cleanup.
Multiple replicas may safely perform the same cleanup; repeated runs are
idempotent. Failures are logged without payloads and retried on the next run.
CRM leads, companies, contacts, and the rate-limit counter are not deleted.

## Verification

`artifacts/api-server/src/routes/inboundLeads.integration.test.ts` includes
validation and opt-in development-only route integration tests. Set
`RUN_INBOUND_INTEGRATION=1` to run the synthetic database tests; never point
them at a production database. They verify create/update, tenant-scoped
matching, concurrency, auth, validation, request logs and rate limits.

`artifacts/api-server/src/routes/leadQueue.integration.test.ts` exercises the
real app with synthetic organization members and window sessions, restricted
to the local development database. It covers all five roles, simultaneous
claims, tenant isolation, assignment validation, dismissal/history, existing
Account reuse, safe return, legacy backfill and generic-write bypass protection.
