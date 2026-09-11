# GET row-access audit

**Scope:** the 60 registered API `GET` handlers in the current checkout,
mounted under `/api`. This report consolidates the inventory, core CRM pass,
derived-data pass, remaining-route pass, and the current access-control
implementation. It is a code audit, not a production-data report.

**Result:** the current implementation has a consistent organization boundary,
shared CRM row predicates, parent-row checks for derived data, and a second
logical-row check for private object bytes. The findings below distinguish
employee CRM rows from organization configuration, operational metadata,
public capabilities, and aggregate responses.

## Executive summary

The effective CRM policy is:

| Membership role | CRM row visibility |
|---|---|
| `owner`, `admin`, `manager` | All rows in the current organization. |
| `user` | Rows with a non-null owner/assignee where the current user is the owner/assignee **or** the creator. This creator fallback survives reassignment. |
| `viewer` | Rows with a non-null owner/assignee where the current user is the current owner/assignee only. Viewer creator access is not granted. |

`attachUser` requires a signed-in Clerk session and loads the local user.
`attachOrg` requires membership in the requested organization and applies the
organization IP policy. Feature and role middleware then apply the route's
product boundary. The Clerk middleware installed before `/api` does not itself
replace those route-level checks.

Viewers remain read-only. `isViewerMutation` allows `GET`, `HEAD`, and
`OPTIONS`, while `attachOrg` rejects viewer `POST`, `PUT`, `PATCH`, and
`DELETE` requests. The document gate is deliberately `requireRole("viewer")`:
viewers can read documents subject to the derived-document predicate, but they
cannot mutate them.

### Inventory accounting

The inventory below contains every registered API `GET` path exactly once:

* **Core CRM:** 7
* **Derived data:** 17
* **Remaining routes:** 36
* **Total:** 60

The production SPA fallback accepts browser `GET`/`HEAD` requests outside
`/api`; it is not part of this API count and does not expose database rows.
The mounted invitation and public API-token routers are POST-only and have no
additional `GET` handler beyond the paths listed below. Their token-authenticated
lead batch write is not an employee-row `GET` feed.

## Complete GET inventory and finding index

The ID in this table is used by the detailed findings later in the report.
Paths are listed only in this inventory so that coverage is auditable without
repeating endpoint strings in the narrative.

| ID | GET path | Source module | Gate / classification | Finding |
|---:|---|---|---|---|
| G01 | `/api/healthz` | `routes/health.ts` | Public · remaining | Constant health response; no tenant or employee data. **Pass.** |
| G02 | `/api/auth/me` | `routes/auth.ts` | `attachUser` · remaining | Returns the signed-in local user and memberships, and organizations reached through those memberships. This is intentionally cross-organization for that user, not an employee-row feed. **Pass.** |
| G03 | `/api/billing/catalog` | `routes/billing.ts` | Public catalog · remaining | Static plans and feature metadata; no tenant rows. **Pass.** |
| G04 | `/api/orgs/:orgId/api-tokens` | `routes/enterprise.ts` | `attachUser`, `attachOrg`, admin · remaining | Organization token metadata is organization/admin scoped and omits token hashes. It is shared configuration, not employee CRM data. **Pass.** |
| G05 | `/api/orgs/:orgId/security-policy` | `routes/enterprise.ts` | `attachUser`, `attachOrg`, admin · remaining | One organization security-policy/status row or a server-derived default. **Pass.** |
| G06 | `/api/orgs/:orgId/audit-events` | `routes/enterprise.ts` | `attachUser`, `attachOrg`, admin · remaining | Organization-filtered audit ledger, intentionally admin-wide. **Pass.** |
| G07 | `/api/orgs/:orgId/industry-templates` | `routes/enterprise.ts` | `attachUser`, `attachOrg`, admin · remaining | Static template catalog with no database rows. **Pass.** |
| G08 | `/api/orgs/:orgId/reports` | `routes/reports.ts` | `attachUser`, `attachOrg`, manager · derived | Manager-only organization report definitions. Report access is intentionally management-wide. **Pass.** |
| G09 | `/api/orgs/:orgId/reports/:reportId` | `routes/reports.ts` | `attachUser`, `attachOrg`, manager · derived | Report ID and current organization are both required. **Pass.** |
| G10 | `/api/orgs/:orgId/reports/:reportId/runs` | `routes/reports.ts` | `attachUser`, `attachOrg`, manager · derived | Resolves the organization-scoped parent report before returning its runs. **Pass.** |
| G11 | `/api/orgs/:orgId/reports/exports/:exportId/download` | `routes/reports.ts` | `attachUser`, `attachOrg`, manager · derived | Requires a current organization export with `completed` status, then redirects to authenticated storage for the second binding check. **Pass after fix.** |
| G12 | `/api/orgs/:orgId/reports/:reportId/schedules` | `routes/reports.ts` | `attachUser`, `attachOrg`, manager · derived | Schedule query is constrained by organization and report ID. **Pass.** |
| G13 | `/api/orgs/:orgId/documents` | `routes/documents.ts` | `attachUser`, `attachOrg`, viewer · derived | Management sees organization documents; users need visible parents or, only when entirely unlinked, creator fallback; viewers get owned-parent visibility and no creator fallback. **Pass after fix.** |
| G14 | `/api/orgs/:orgId/documents/:documentId` | `routes/documents.ts` | `attachUser`, `attachOrg`, viewer · derived | The same document predicate protects the detail row; returned versions remain organization-scoped. **Pass after fix.** |
| G15 | `/api/orgs/:orgId/documents/:documentId/download` | `routes/documents.ts` | `attachUser`, `attachOrg`, viewer · derived | The document is checked before redirect and the current version is constrained by document, version, and organization. Storage checks the binding again. **Pass after fix.** |
| G16 | `/api/signatures/:token` | `routes/documents.ts` | Public bearer capability · derived | Hashes the token and requires a matching pending, non-expired signer request. Returns signer/request metadata only; it does not return the document or CRM parents. **Pass.** |
| G17 | `/api/orgs/:orgId/webhooks` | `routes/webhooks.ts` | `attachUser`, `attachOrg`, manager · remaining | Shared organization integration configuration; encrypted secret fields are removed. **Pass.** |
| G18 | `/api/orgs/:orgId/webhooks/:webhookId/deliveries` | `routes/webhooks.ts` | `attachUser`, `attachOrg`, manager · remaining | Delivery rows require both the current organization and webhook ID. **Pass.** |
| G19 | `/api/orgs/:orgId/accounts` | `routes/crm.ts` | `attachUser`, `attachOrg`, CRM feature · core | Account list uses the shared CRM predicate. A `segmentId` lookup uses the segment creator/management scope before conditions are applied. **Pass after fix.** |
| G20 | `/api/orgs/:orgId/accounts/:accountId` | `routes/crm.ts` | `attachUser`, `attachOrg`, CRM feature · core | Detail lookup requires organization and shared account visibility; related contacts and opportunities are filtered before serialization. **Pass after fix.** |
| G21 | `/api/orgs/:orgId/accounts/:accountId/contacts` | `routes/crm.ts` | `attachUser`, `attachOrg`, CRM feature · core | Visible account parent is required; contacts use their own shared predicate, and an inaccessible reporting contact is nulled. **Pass after fix.** |
| G22 | `/api/orgs/:orgId/contacts/:contactId` | `routes/crm.ts` | `attachUser`, `attachOrg`, CRM feature · core | Contact visibility and parent-account visibility are both required; nested reporting-contact data is sanitized. **Pass after fix.** |
| G23 | `/api/orgs/:orgId/accounts/:accountId/timeline` | `routes/crm.ts` | `attachUser`, `attachOrg`, CRM feature · remaining | Visible account parent and organization-scoped activities are required; contact/opportunity relationship IDs are retained only when visible. **Pass after fix.** |
| G24 | `/api/orgs/:orgId/segments` | `routes/crm.ts` | `attachUser`, `attachOrg`, CRM feature · derived | Management sees all organization segments; other members see only segments they created. Live account match counts independently apply CRM row visibility. **Pass after fix.** |
| G25 | `/api/orgs/:orgId/providers` | `routes/communications.ts` | `attachUser`, `attachOrg`, CRM feature · remaining | Provider availability, organization sync state, and binding status are shared operational metadata, not employee CRM rows. **Pass.** |
| G26 | `/api/orgs/:orgId/communication-settings` | `routes/communications.ts` | `attachUser`, `attachOrg`, CRM feature · remaining | Returns one shared organization communication setting. **Pass.** |
| G27 | `/api/orgs/:orgId/accounts/:accountId/email-threads` | `routes/communications.ts` | `attachUser`, `attachOrg`, CRM feature, visible account · remaining | Account visibility is checked before organization/account-scoped threads are read. **Pass.** |
| G28 | `/api/orgs/:orgId/email-threads/:threadId` | `routes/communications.ts` | `attachUser`, `attachOrg`, CRM feature, thread account check · remaining | Thread is organization-scoped and its account is checked before messages are returned; inaccessible threads are 404. **Pass.** |
| G29 | `/api/orgs/:orgId/accounts/:accountId/calendar-events` | `routes/communications.ts` | `attachUser`, `attachOrg`, CRM feature, visible account · remaining | Account visibility precedes organization/account-scoped calendar events. **Pass.** |
| G30 | `/api/orgs/:orgId/accounts/:accountId/notes` | `routes/communications.ts` | `attachUser`, `attachOrg`, CRM feature, visible account · remaining | Visible account, non-deleted rows, and private-note authorship are all enforced. **Pass.** |
| G31 | `/api/orgs/:orgId/pipelines` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · remaining | Shared organization sales configuration; no CRM owner column is being exposed. **Pass.** |
| G32 | `/api/orgs/:orgId/opportunities` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · core | Shared opportunity visibility is followed by a parent-account visibility check before serialization. **Pass after fix.** |
| G33 | `/api/orgs/:orgId/opportunities/:opportunityId` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · core | Detail requires visible opportunity and visible account; account name, owner membership, and stage history are organization/policy scoped. **Pass after fix.** |
| G34 | `/api/orgs/:orgId/leads` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · core | Assigned-owner/creator predicate applies; a converted opportunity ID is returned only when that opportunity is visible. **Pass after fix.** |
| G35 | `/api/orgs/:orgId/lead-scoring-rules` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · remaining | Shared organization scoring configuration, not an employee CRM row feed. **Pass.** |
| G36 | `/api/orgs/:orgId/quotes` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · derived | Quote rows require both visible opportunity and visible account; related names use policy-aware lookups. **Pass after fix.** |
| G37 | `/api/orgs/:orgId/quotes/:quoteId` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · derived | Detail requires both linked parents and returns 404 when the child or either parent is inaccessible. **Pass after fix.** |
| G38 | `/api/orgs/:orgId/quotes/:quoteId/pdf` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · derived | PDF source rows use the same linked-parent predicate; the alternate representation cannot bypass detail access. **Pass after fix.** |
| G39 | `/api/orgs/:orgId/territories` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · remaining | Shared routing configuration; owner display is joined through current organization membership. **Pass after fix.** |
| G40 | `/api/orgs/:orgId/territories/coverage` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · remaining | Shared territory metadata; account/opportunity aggregate inputs and owner display are organization/policy scoped. **Pass.** |
| G41 | `/api/orgs/:orgId/forecast` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · derived | Forecast rows use shared opportunity visibility and visible parent accounts before month aggregation. **Pass.** |
| G42 | `/api/orgs/:orgId/forecast/weighted` | `routes/sales.ts` | `attachUser`, `attachOrg`, sales feature · derived | Date-bounded rows use shared opportunity visibility and are dropped when their parent account is not visible before revenue/count aggregation. **Pass.** |
| G43 | `/api/storage/public-objects/*filePath` | `routes/storage.ts` | Public-object handler · remaining | Reads only configured public search paths. This is an intentional public asset endpoint, not a private-row ACL bypass. **Pass.** |
| G44 | `/api/storage/objects/*path` | `routes/storage.ts` | Clerk session, object ACL, logical binding · remaining | Private bytes require the storage ACL and a current document/report binding. Known unauthorized bindings fail closed; report exports require management membership and completed status. **Pass after fix.** |
| G45 | `/api/orgs/:orgId/dashboard` | `routes/dashboard.ts` | router-level `attachUser`, `attachOrg` · derived | CRM counts use shared visibility and visible parent accounts; member/features are org metadata; recent activity is management-wide or current-user-only. **Pass after fix.** |
| G46 | `/api/orgs/:orgId/usage` | `routes/dashboard.ts` | router-level `attachUser`, `attachOrg` · derived | Usage activity is organization-scoped for management and current-user-scoped for other roles. **Pass.** |
| G47 | `/api/orgs/:orgId/ai/copilot/budget` | `routes/automation.ts` | user/org, AI feature · remaining | Consent, plan budget, and aggregate usage metadata; no CRM row list. **Pass.** |
| G48 | `/api/orgs/:orgId/predictions/churn` | `routes/automation.ts` | user/org, AI feature and consent · remaining | Organization prediction rows are filtered by visible account before response. **Pass after fix.** |
| G49 | `/api/orgs/:orgId/predictions/churn/:accountId` | `routes/automation.ts` | user/org, AI feature and consent · remaining | Account visibility is required before calculation; inaccessible IDs return the same 404 as missing rows. **Pass.** |
| G50 | `/api/orgs/:orgId/predictions/conversion/:leadId` | `routes/automation.ts` | user/org, AI feature and consent · remaining | Lead visibility is required before calculation; inaccessible IDs return 404. **Pass.** |
| G51 | `/api/orgs/:orgId/predictions/close/:opportunityId` | `routes/automation.ts` | user/org, AI feature and consent · remaining | Opportunity visibility is required; stakeholder count is filtered by visible contacts and visible parent account. **Pass after fix.** |
| G52 | `/api/orgs/:orgId/workflows` | `routes/automation.ts` | user/org, automation feature · remaining | Shared organization automation definitions. **Pass.** |
| G53 | `/api/orgs/:orgId/workflow-executions` | `routes/automation.ts` | user/org, automation feature · remaining | Management sees organization history; other roles see only executions linked to visible account/lead/opportunity rows; unknown or unscoped entities are hidden. **Pass after fix.** |
| G54 | `/api/orgs/:orgId/tasks` | `routes/automation.ts` | user/org, tasks feature · remaining | Management sees organization tasks; `user` sees assigned-or-created tasks; `viewer` is assignee-only. Linked CRM parents must also be visible. **Pass after fix.** |
| G55 | `/api/orgs/:orgId/agents` | `routes/automation.ts` | user/org, automation feature · remaining | Shared organization agent definitions. **Pass.** |
| G56 | `/api/orgs/:orgId/agent-executions` | `routes/automation.ts` | user/org, automation feature · remaining | Management sees organization history; other roles see only executions linked to visible CRM entities. **Pass after fix.** |
| G57 | `/api/orgs/:orgId/commands/history` | `routes/automation.ts` | user/org, AI feature and consent · remaining | Transcript/result history is filtered by current organization and initiating user. **Pass.** |
| G58 | `/api/orgs/:orgId` | `routes/orgs.ts` | router-level user/org · remaining | Current organization metadata after membership verification. **Pass.** |
| G59 | `/api/orgs/:orgId/members` | `routes/orgs.ts` | router-level user/org · remaining | Members and user fields are joined through the current organization membership. This is org membership metadata, not employee CRM rows. **Pass.** |
| G60 | `/api/orgs/:orgId/features` | `routes/orgs.ts` | router-level user/org · remaining | Enabled feature keys are derived from the current organization. **Pass.** |

## Detailed findings

### Shared CRM predicate and role behavior

`artifacts/api-server/src/services/crmAccess.ts` is the source of truth for
accounts, contacts, opportunities, and leads. `crmRecordCondition` always
includes record ID and organization ID. For contacts and opportunities,
`canAccessCrmRecord` additionally checks the parent account, so a visible child
cannot disclose an inaccessible parent.

The current predicate is intentionally explicit:

```ts
if (hasCrmManagementAccess(req)) return undefined;

const userId = req.currentUser!.id;
if (req.currentMembership?.role === "viewer") {
  return and(isNotNull(ownerColumn), eq(ownerColumn, userId));
}
if (req.currentMembership?.role !== "user") return sql`false`;
return and(
  isNotNull(ownerColumn),
  or(eq(ownerColumn, userId), eq(createdByColumn, userId)),
);
```

This is the important post-fix distinction: a `viewer` is **owned-only**, not
owner-or-creator. A regular `user` retains creator access after reassignment,
but only while the row has a non-null owner. Leads use
`assignedToUserId` as their owner column.

#### Core CRM findings (G19–G22, G32–G34)

* Account list/detail and contact list/detail use the shared predicate rather
  than a bare organization filter.
* Account detail serializes only visible related contacts and opportunities.
  Contact detail also requires its parent account. An inaccessible
  `reportsToContactId` is not disclosed.
* Opportunity list/detail requires both opportunity visibility and parent
  account visibility. Related account names, owner membership, and stage
  history are scoped to the current organization and policy.
* Leads use assigned-owner/creator visibility. A `convertedOpportunityId` is
  null unless the linked opportunity is visible.

#### Child and aggregate findings (G23, G40–G42, G45–G46)

* Timeline first resolves a visible account, then adds the organization
  predicate to activities. Relationship identifiers for hidden contacts or
  opportunities are suppressed.
* Territory coverage remains shared territory configuration, but its account
  and opportunity aggregate inputs use CRM visibility; owner display joins
  organization membership.
* Forecast and weighted forecast calculate only from visible opportunities with
  visible parent accounts. The weighted endpoint selects the account ID
  internally only to enforce the check and does not return it.
* Dashboard account and opportunity counts use the shared helper. For
  non-management callers, opportunity count adds a correlated visible-account
  predicate. Member count, plan, enabled features, and usage metadata are
  organization/usage data rather than employee CRM rows. Recent activity is
  organization-wide for management and current-user-only for other roles.

### Segments and saved conditions (G19, G24)

Segments are saved configuration that can contain sensitive CRM conditions.
`segmentVisibilityScope` combines organization scope with the current creator
for non-management roles; management has organization-wide segment access.
The same scope is used for:

1. the segment `GET` list;
2. the `segmentId` lookup used while filtering the account list;
3. the segment lookup used by `PATCH`; and
4. the segment lookup and update/delete predicate used by `DELETE`.

Thus an employee cannot apply, edit, or delete another member's hidden saved
segment by guessing its ID. A segment with a null creator remains
management-only. Each returned segment's live match count is computed through
the account query path, which applies CRM row visibility independently of
segment-definition visibility.

### Quotes and alternate representations (G36–G38)

Quotes have no owner column and depend on both an opportunity and an account.
The list, detail, and PDF paths all require both linked parents to be visible.
`quoteOut` and the PDF builder use `crmRecordCondition` for related names and
source rows. This closes the former gap in which a visible quote or detail
could cause an unscoped account/opportunity lookup in a secondary
representation.

### Documents, versions, and signatures (G13–G16)

Documents are derived records. Their predicate is an intersection, not an OR:
every populated account/opportunity parent must be visible. The current
implementation is equivalent to:

```ts
const allLinkedParentsVisible = and(
  or(isNull(documents.accountId), accountAccess),
  or(isNull(documents.opportunityId), opportunityAccess),
  or(isNotNull(documents.accountId), isNotNull(documents.opportunityId)),
)!;

if (req.currentMembership?.role === "viewer") {
  return allLinkedParentsVisible;
}

return or(
  and(
    isNull(documents.accountId),
    isNull(documents.opportunityId),
    eq(documents.createdByUserId, req.currentUser!.id),
  ),
  allLinkedParentsVisible,
)!;
```

The creator fallback is therefore limited to an **entirely unlinked document**
and regular `user` roles. A linked document cannot be rescued by creator
authorship when either parent is hidden. Viewer creator fallback is disabled;
viewers see only documents whose populated parents are currently owned by the
viewer. Management remains organization-wide. Detail versions and download
lookups remain subordinate to the visible document and organization.

The public signature capability is deliberately different from an
authenticated CRM read. Possession of the high-entropy bearer token is the
capability; the handler hashes it, requires a matching signer and pending
request, checks expiry, and returns only signer name/email and request
message/expiry. It does not expose the document or its CRM parents.

### Reports and private object storage (G08–G12, G44)

Reports are manager-only. Their definitions, runs, schedules, previews, and
exports are intentionally organization-wide within the management gate; the
report execution function reads organization CRM rows only behind that
trusted manager boundary. Regular users and viewers do not receive report
definitions, run histories, or exports.

Scheduled execution is a trusted server-side operation with no request
principal and is used by manager-owned schedules. If report previews, runs, or
exports are ever opened to non-management callers, the execution function
must accept a request context and apply the shared CRM predicate before it is
used for that caller.

The export download handler first requires the current organization, export ID,
and `completed` status. It redirects only to the authenticated private-object
handler. The storage binding check then requires:

* a live `customReports` row joined to the export's organization;
* the export binding to be current rather than stale;
* `reportExports.status === "completed"`; and
* a membership in that binding organization with role `owner`, `admin`, or
  `manager`.

The storage ACL's `ORG_MEMBER` read permission is intentionally not sufficient
for report bytes. This is the completed/current-binding management check that
prevents an organization member from turning a broad object ACL into a report
export read.

Document object paths use the same second boundary: the private object ACL must
pass and the bound document must satisfy the document predicate. A known
binding that fails its logical-row predicate cannot fall back to the broader
ACL. An unbound object can be read by the exact ACL owner; a shared unbound
object may additionally be read by a management member of an ACL-listed
organization. That unbound-object behavior is not an employee CRM row feed.

Public objects (G43) are separate by design and are searched only in
configured public paths. They do not authorize private object bytes.

### Automation and task rows (G47–G57)

AI budget, workflow definitions, and agent definitions are shared
organization configuration/usage metadata. They are not employee CRM row
feeds. History rows are different because payloads may contain CRM data:
non-management workflow and agent execution responses require a linked,
visible account, lead, or opportunity. Unknown and unscoped entities are
hidden rather than treated as organization-wide.

Task access has a dedicated predicate shared by list and mutation paths:

```ts
const ownership =
  req.currentMembership?.role === "viewer"
    ? eq(tasks.assignedToUserId, userId)
    : or(
        eq(tasks.assignedToUserId, userId),
        eq(tasks.createdByUserId, userId),
      );
return and(ownership, accountVisible, opportunityVisible);
```

The creator fallback is for regular `user` members, **not viewers**. Viewers
are assignee-only. Management sees organization tasks. Optional account and
opportunity links are independently checked with the CRM helper. The same
visibility predicate is placed in `UPDATE` conditions for task edits and
completion, avoiding an ID-only mutation race.

Prediction access is also row-aware:

* the churn list filters every prediction by visible account;
* churn detail requires visible account;
* conversion detail requires visible lead;
* close detail requires visible opportunity; and
* the close prediction's stakeholder `count(*)` is restricted to visible
  contacts whose parent account is visible.

The last item matters because a filtered prediction row could still leak a
hidden stakeholder count if the calculation query were organization-only.
The current `closeContactVisibilityCondition` applies both contact and
account visibility.

### Communications and CRM-linked operational data (G25–G30)

Provider status, binding status, and communication settings are shared
organization configuration. They may describe connector state but do not
return employee CRM rows. Account-linked threads, messages, calendar events,
and notes first pass the visible-account check and then add organization and
parent identifiers. Notes additionally exclude deleted rows and hide private
notes from non-authors. An inaccessible thread or parent returns 404 rather
than a cross-user response.

### Shared configuration and public capability boundaries (G01–G07,
G17–G18, G31, G35, G39, G43, G47, G52, G55, G58–G60)

The following responses are intentionally shared, static, public, or
organization metadata rather than employee row feeds:

* health and public billing catalog;
* the signed-in user's own membership/org list;
* admin-only token metadata, security policy, audit ledger, and templates;
* manager-only webhook definitions and same-organization deliveries;
* pipelines, lead scoring rules, and territories;
* provider/communication settings;
* AI budget, workflows, and agents;
* current organization metadata, members, and enabled feature keys; and
* public assets under the configured public-object search paths.

The public API-token mount is POST-only. Its token authorizes a scoped lead
batch write and is not a public employee-row read. The only public
token-shaped `GET` in this inventory is the signature capability in G16; it
returns signer/request metadata rather than a document or CRM parent.

These endpoints still have their documented authentication, membership, and
role/feature gates. “Shared” means the object is configuration or metadata
whose organization-wide visibility is intentional; it does not mean that
employee-owned account/contact/opportunity/lead rows are organization-wide.

## Findings fixed in the current implementation

The post-fix code and the route inventory support these concrete conclusions:

1. Viewer CRM access is explicitly current-owner/assignee-only; creator access
   belongs to regular `user` members, not viewers.
2. Account, contact, opportunity, and lead detail/list paths enforce shared
   visibility, organization scope, and relevant parent checks.
3. Nested account/contact/timeline and converted-opportunity fields are
   filtered or sanitized rather than copied from raw IDs.
4. Dashboard and forecast opportunity aggregates reject hidden parent
   accounts.
5. Segment list, account segment lookup, and segment mutations share creator
   or management scope.
6. Documents use every-populated-parent visibility with creator fallback only
   for entirely unlinked regular-user documents; viewers are owned-only.
7. Quote list/detail/PDF all use both linked-parent checks and scoped related
   lookups.
8. Private storage requires both object ACL and logical binding authorization;
   report bindings require a live report, completed export, and management
   membership.
9. Workflow/agent histories, tasks, and prediction lists no longer treat
   organization scope alone as sufficient where payloads can carry CRM data.
10. Territory owner lookups and all reviewed related-user joins are constrained
    to the current organization where appropriate.

## Checks and verification evidence

### Source-level checks present

The current checkout includes focused checks for:

* management visibility, regular-user owner-or-creator visibility, viewer
  owned-only visibility, reassignment creator access, and viewer lead
  ownership in `services/crmAccess.test.ts`;
* segment list/lookup/update/delete SQL scope in
  `services/crmAccess.test.ts`;
* viewer task mutation assignee-only SQL and close-prediction visible contact
  and account predicates in `services/visibility-regression.test.ts`;
* linked-document parent intersection, unlinked regular-user creator fallback,
  viewer no-creator-fallback behavior, and management document access in
  `routes/documents.test.ts`; and
* private-object owner and malformed-ACL fail-closed behavior in
  `services/objectAcl.test.ts`.

The tests are still being finished. This report deliberately does **not** claim
final test totals, a final pass count, or a completed end-to-end test run.

### Development database boundary

The integration case in `services/crmAccess.test.ts` is designed to use the
development `DATABASE_URL` and a real Drizzle transaction. It creates synthetic
UUID users, memberships, and CRM rows with `example.invalid` addresses, checks
role predicates and denied details, and then throws a private rollback
sentinel. The transaction is expected to roll back all synthetic organization,
user, membership, and CRM rows.

That is development verification of predicates, not a query against user
production data and not a production row-count report. In particular, this
audit makes no claim that an owner has exactly six or four rows, or any other
production count. No user production counts are inferred from the synthetic
fixtures.

### Production role boundary

No production role assignments, role definitions, or membership data were
changed by this report. The implementation continues to treat `owner`,
`admin`, and `manager` as CRM-management roles; `user` as owner-or-creator
with a non-null owner; and `viewer` as read-only and owned-only. The document
read gate is widened to include viewers without widening document mutation
access.

## Reviewed source modules

The audit used the current implementations in:

* `artifacts/api-server/src/app.ts` and `src/routes/index.ts`;
* `src/middlewares/auth.ts`;
* `src/services/crmAccess.ts`, `taskAccess.ts`, `predictive.ts`, and
  `objectAccess.ts`;
* route modules for auth, billing, enterprise, reports, documents, webhooks,
  CRM, communications, sales, storage, dashboard, automation, and orgs; and
* the focused access-control test sources listed above.

The report files are the only outputs of this documentation task. No workflow,
production data, role assignment, commit, or application code change is
claimed here.