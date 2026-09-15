import { Router, type IRouter, type Request, type Response } from "express";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  accounts,
  contacts,
  activities,
  opportunities,
  orgUsers,
  segments,
  users,
  type Account,
  type Contact,
  type Activity,
  type Segment,
  type Opportunity,
} from "@workspace/db";
import {
  ListAccountsResponse,
  CreateAccountBody,
  UpdateAccountBody,
  CreateAccountResponse,
  GetAccountResponse,
  UpdateAccountResponse,
  BulkImportAccountsBody,
  BulkImportAccountsResponse,
  ListContactsResponse,
  CreateContactBody,
  CreateContactResponse,
  GetContactResponse,
  UpdateContactBody,
  UpdateContactResponse,
  CreateActivityBody,
  CreateActivityResponse,
  GetAccountTimelineResponse,
  AttachFileToActivityBody,
  AttachFileToActivityResponse,
  ListSegmentsResponse,
  CreateSegmentBody,
  CreateSegmentResponse,
  UpdateSegmentResponse,
  PreviewSegmentResponse,
  PreviewSegmentConditionsBody,
  PreviewSegmentConditionsResponse,
} from "@workspace/api-zod";
import { attachUser, attachOrg, requireFeature } from "../middlewares/auth";
import { appendAuditEvent, auditContext } from "../services/audit";
import {
  hasCrmManagementAccess,
  canAccessCrmRecord,
  withCrmVisibility,
} from "../services/crmAccess";
import { isOrgMemberId } from "../services/orgValidation";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { effectiveMemberDisplayName } from "../lib/memberDisplayName";
const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

/**
 * Log only stable PostgreSQL diagnostics. In particular, do not serialize a
 * Drizzle error's message/params because those can contain query values.
 */
function safeDatabaseErrorDetails(error: unknown): Record<string, string> {
  const values: Record<string, string> = {};
  const candidates: unknown[] = [error];

  for (let index = 0; index < candidates.length && index < 3; index += 1) {
    const candidate = candidates[index];
    if (typeof candidate !== "object" || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    if (record.cause !== undefined) candidates.push(record.cause);
    for (const key of [
      "code",
      "severity",
      "schema",
      "table",
      "column",
      "constraint",
      "routine",
    ]) {
      const value = record[key];
      if (typeof value === "string" && value.length <= 128) {
        values[key] ??= value;
      }
    }
  }

  return values;
}

/**
 * Bind an uploaded object to the current org (private ACL, org-member read).
 * Rejects paths outside the private upload namespace, missing objects, and
 * objects already bound to a different owner/org (cross-tenant reuse).
 * Returns an error message, or null on success.
 */
async function secureAttachmentPath(
  objectPath: string,
  req: Request,
): Promise<string | null> {
  if (!objectPath.startsWith("/objects/")) {
    return "Invalid attachment path";
  }
  try {
    return await objectStorage.bindObjectEntityToOrganization(
      objectPath,
      req.currentOrg!.id,
      req.currentUser!.clerkId,
    ).then(() => null);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return "Attachment object not found";
    if ((err as Error).message.includes("already bound")) {
      return "Attachment does not belong to this organization";
    }
    throw err;
  }
}

/* ----------------------------- serializers ----------------------------- */

function accountSummary(a: Account) {
  return {
    id: a.id,
    name: a.name,
    industry: a.industry,
    website: a.website,
    city: a.city,
    state: a.state,
    healthScore: a.healthScore,
    riskLevel: a.riskLevel,
    ownerUserId: a.ownerUserId,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
  };
}

function accountDetail(a: Account) {
  return {
    id: a.id,
    name: a.name,
    industry: a.industry,
    website: a.website,
    phone: a.phone,
    address: a.address,
    city: a.city,
    state: a.state,
    country: a.country,
    zip: a.zip,
    annualRevenue: a.annualRevenue,
    employeeCount: a.employeeCount,
    healthScore: a.healthScore,
    riskLevel: a.riskLevel,
    ltv: a.ltv,
    nextRenewalDate: a.nextRenewalDate,
    isActive: a.isActive,
    ownerUserId: a.ownerUserId,
    createdByUserId: a.createdByUserId,
    metadata: (a.metadata ?? {}) as Record<string, unknown>,
    files: (a.files ?? []) as {
      objectPath: string;
      name: string;
      size?: number | null;
      contentType?: string | null;
      uploadedAt?: string | null;
    }[],
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function contactOut(c: Contact, exposeReportsToContactId = true) {
  return {
    id: c.id,
    accountId: c.accountId,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    title: c.title,
    department: c.department,
    seniority: c.seniority,
    reportsToContactId: exposeReportsToContactId ? c.reportsToContactId : null,
    isActive: c.isActive,
    ownerUserId: c.ownerUserId,
    createdByUserId: c.createdByUserId,
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
    createdAt: c.createdAt.toISOString(),
  };
}

async function contactOutForRequest(req: Request, c: Contact) {
  const exposeReportsToContactId =
    !c.reportsToContactId ||
    (await canAccessCrmRecord(req, "contact", c.reportsToContactId));
  return contactOut(c, exposeReportsToContactId);
}

function activityOut(
  a: Activity,
  createdByName?: string | null,
  relatedVisibility?: { contact: boolean; opportunity: boolean },
) {
  return {
    id: a.id,
    accountId: a.accountId,
    contactId:
      relatedVisibility && !relatedVisibility.contact ? null : a.contactId,
    opportunityId:
      relatedVisibility && !relatedVisibility.opportunity
        ? null
        : a.opportunityId,
    threadId: a.threadId,
    callRecordingId: a.callRecordingId,
    calendarEventId: a.calendarEventId,
    type: a.type,
    subject: a.subject,
    body: a.body,
    direction: a.direction,
    attachments: (a.attachments ?? []) as {
      objectPath: string;
      name: string;
      size?: number | null;
      contentType?: string | null;
      uploadedAt?: string | null;
    }[],
    createdByUserId: a.createdByUserId,
    createdByName: createdByName ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

function segmentOut(s: Segment, matchCount?: number | null) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    conditions: (s.conditions ?? []) as {
      field: string;
      operator:
        | "equals"
        | "not_equals"
        | "contains"
        | "gt"
        | "gte"
        | "lt"
        | "lte"
        | "is_empty"
        | "is_not_empty";
      value: string | null;
    }[],
    matchCount: matchCount ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

/* ------------------------- segment condition SQL ------------------------ */

type Condition = { field: string; operator: string; value: string | null };

const ACCOUNT_TEXT_COLUMNS = {
  name: accounts.name,
  industry: accounts.industry,
  website: accounts.website,
  city: accounts.city,
  state: accounts.state,
  country: accounts.country,
  zip: accounts.zip,
  healthScore: accounts.healthScore,
  riskLevel: accounts.riskLevel,
} as const;

const ACCOUNT_NUMERIC_COLUMNS = {
  employeeCount: accounts.employeeCount,
  annualRevenue: accounts.annualRevenue,
  ltv: accounts.ltv,
} as const;

function conditionToSql(cond: Condition): SQL | undefined {
  const { field, operator, value } = cond;

  const textCol =
    ACCOUNT_TEXT_COLUMNS[field as keyof typeof ACCOUNT_TEXT_COLUMNS];
  const numCol =
    ACCOUNT_NUMERIC_COLUMNS[field as keyof typeof ACCOUNT_NUMERIC_COLUMNS];

  // Custom fields live in the metadata JSONB column. Only explicit
  // "metadata.<key>" fields are treated as custom fields; unknown bare
  // field names are rejected (condition is skipped).
  const metadataKey =
    field.startsWith("metadata.") && field.length > "metadata.".length
      ? field.slice("metadata.".length)
      : null;

  if (metadataKey) {
    const expr = sql`${accounts.metadata} ->> ${metadataKey}`;
    // Guarded numeric cast: non-numeric JSON text must not blow up the query.
    const numExpr = sql`(CASE WHEN ${expr} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expr})::numeric END)`;
    const num = Number(value);
    const numOk = value !== null && value !== "" && Number.isFinite(num);
    switch (operator) {
      case "equals":
        return sql`${expr} = ${value ?? ""}`;
      case "not_equals":
        return sql`${expr} IS DISTINCT FROM ${value ?? ""}`;
      case "contains":
        return sql`${expr} ILIKE ${"%" + (value ?? "") + "%"}`;
      case "gt":
        return numOk ? sql`${numExpr} > ${num}` : undefined;
      case "gte":
        return numOk ? sql`${numExpr} >= ${num}` : undefined;
      case "lt":
        return numOk ? sql`${numExpr} < ${num}` : undefined;
      case "lte":
        return numOk ? sql`${numExpr} <= ${num}` : undefined;
      case "is_empty":
        return sql`(${expr} IS NULL OR ${expr} = '')`;
      case "is_not_empty":
        return sql`(${expr} IS NOT NULL AND ${expr} <> '')`;
      default:
        return undefined;
    }
  }

  if (numCol) {
    const num = Number(value);
    const numOk = value !== null && value !== "" && Number.isFinite(num);
    if (!numOk && operator !== "is_empty" && operator !== "is_not_empty") {
      return undefined;
    }
    switch (operator) {
      case "equals":
        return sql`${numCol} = ${num}`;
      case "not_equals":
        return sql`${numCol} IS DISTINCT FROM ${num}`;
      case "gt":
        return sql`${numCol} > ${num}`;
      case "gte":
        return sql`${numCol} >= ${num}`;
      case "lt":
        return sql`${numCol} < ${num}`;
      case "lte":
        return sql`${numCol} <= ${num}`;
      case "is_empty":
        return isNull(numCol);
      case "is_not_empty":
        return not(isNull(numCol));
      default:
        return undefined;
    }
  }

  if (textCol) {
    switch (operator) {
      case "equals":
        return eq(textCol, value ?? "");
      case "not_equals":
        return sql`${textCol} IS DISTINCT FROM ${value ?? ""}`;
      case "contains":
        return ilike(textCol, `%${value ?? ""}%`);
      case "is_empty":
        return sql`(${textCol} IS NULL OR ${textCol} = '')`;
      case "is_not_empty":
        return sql`(${textCol} IS NOT NULL AND ${textCol} <> '')`;
      default:
        return undefined;
    }
  }

  return undefined;
}

function conditionsToWhere(conds: Condition[]): SQL[] {
  return conds
    .map(conditionToSql)
    .filter((c): c is SQL => c !== undefined);
}

async function queryAccountsByConditions(
  req: Request,
  conds: Condition[],
): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, req.currentOrg!.id),
        eq(accounts.isActive, true),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        ...conditionsToWhere(conds),
      ),
    )
    .orderBy(desc(accounts.createdAt));
}

export function segmentVisibilityScope(req: Request, segmentId?: string): SQL[] {
  const where: SQL[] = [eq(segments.orgId, req.currentOrg!.id)];
  if (segmentId) {
    where.push(eq(segments.id, segmentId));
  }
  if (!hasCrmManagementAccess(req)) {
    where.push(eq(segments.createdByUserId, req.currentUser!.id));
  }
  return where;
}

/* ------------------------------- accounts ------------------------------ */

function accountAudit(a: Account) {
  return {
    name: a.name,
    industry: a.industry,
    ownerUserId: a.ownerUserId,
    createdByUserId: a.createdByUserId,
    isActive: a.isActive,
  };
}

function contactAudit(c: Contact) {
  return {
    accountId: c.accountId,
    firstName: c.firstName,
    lastName: c.lastName,
    ownerUserId: c.ownerUserId,
    createdByUserId: c.createdByUserId,
    isActive: c.isActive,
  };
}

async function requestedOwner(
  req: Request,
  requested: string | null | undefined,
  field: string,
): Promise<{ owner: string | null; error?: string }> {
  const currentUserId = req.currentUser!.id;
  if (requested === undefined) return { owner: currentUserId };
  if (!hasCrmManagementAccess(req) && requested !== currentUserId) {
    return { owner: currentUserId, error: `Only management may assign ${field} to another user or leave it unassigned` };
  }
  if (requested !== null && !(await isOrgMemberId(req.currentOrg!.id, requested))) {
    return { owner: currentUserId, error: `${field} must reference a member of this organization` };
  }
  return { owner: requested };
}

router.get(
  "/orgs/:orgId/accounts",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const { q, industry, segmentId, includeInactive } = req.query as {
      q?: string;
      industry?: string;
      segmentId?: string;
      includeInactive?: string;
    };

    const where: SQL[] = [eq(accounts.orgId, req.currentOrg!.id)];
    where.push(...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId));
    if (includeInactive !== "true") {
      where.push(eq(accounts.isActive, true));
    }
    if (industry) {
      where.push(ilike(accounts.industry, industry));
    }
    if (q) {
      const like = `%${q}%`;
      where.push(
        or(
          ilike(accounts.name, like),
          ilike(accounts.industry, like),
          ilike(accounts.city, like),
          ilike(accounts.state, like),
          ilike(accounts.country, like),
          sql`EXISTS (
            SELECT 1 FROM jsonb_each_text(${accounts.metadata}) AS kv(key, value)
            WHERE kv.value ILIKE ${like}
          )`,
        )!,
      );
    }
    if (segmentId) {
      const [seg] = await db
        .select()
        .from(segments)
        .where(and(...segmentVisibilityScope(req, segmentId)));
      if (!seg) {
        res.status(404).json({ error: "Segment not found" });
        return;
      }
      where.push(...conditionsToWhere((seg.conditions ?? []) as Condition[]));
    }

    const rows = await db
      .select()
      .from(accounts)
      .where(and(...where))
      .orderBy(desc(accounts.createdAt));
    res.json(ListAccountsResponse.parse(rows.map(accountSummary)));
  },
);

router.post(
  "/orgs/:orgId/accounts",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = CreateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const { metadata, ownerUserId, ...rest } = parsed.data;
    const assignment = await requestedOwner(req, ownerUserId, "ownerUserId");
    if (assignment.error) {
      res.status(403).json({ error: assignment.error });
      return;
    }
    const [row] = await db
      .insert(accounts)
      .values({
        ...rest,
        metadata: metadata ?? {},
        orgId: req.currentOrg!.id,
        ownerUserId: assignment.owner,
        createdByUserId: req.currentUser!.id,
      })
      .returning();
    await appendAuditEvent({
      orgId: row.orgId,
      action: "account.created",
      entityType: "account",
      entityId: row.id,
      ...auditContext(req),
      metadata: { after: accountAudit(row) },
    });
    res.status(201).json(CreateAccountResponse.parse(accountDetail(row)));
  },
);

router.post(
  "/orgs/:orgId/accounts/bulk-import",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = BulkImportAccountsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const orgId = req.currentOrg!.id;
    const userId = req.currentUser!.id;
    let accountsCreated = 0;
    let contactsCreated = 0;
    const errors: string[] = [];

    for (const [idx, entry] of parsed.data.accounts.entries()) {
      const { contacts: nestedContacts, metadata, ...accountFields } = entry;
      try {
        const [acc] = await db
          .insert(accounts)
          .values({
            ...accountFields,
            metadata: metadata ?? {},
            orgId,
            ownerUserId: userId,
            createdByUserId: userId,
          })
          .returning();
        await appendAuditEvent({
          orgId,
          action: "account.created",
          entityType: "account",
          entityId: acc.id,
          ...auditContext(req),
          metadata: { source: "bulk_import", after: accountAudit(acc) },
        });
        accountsCreated += 1;
        for (const c of nestedContacts ?? []) {
          const { metadata: cMeta, ...contactFields } = c;
          const [contact] = await db.insert(contacts).values({
            ...contactFields,
            metadata: cMeta ?? {},
            orgId,
            accountId: acc.id,
            ownerUserId: userId,
            createdByUserId: userId,
          }).returning();
          await appendAuditEvent({
            orgId,
            action: "contact.created",
            entityType: "contact",
            entityId: contact.id,
            ...auditContext(req),
            metadata: { source: "bulk_import", after: contactAudit(contact) },
          });
          contactsCreated += 1;
        }
      } catch (err) {
        errors.push(`Row ${idx + 1} (${entry.name}): ${(err as Error).message}`);
      }
    }

    res.json(
      BulkImportAccountsResponse.parse({ accountsCreated, contactsCreated, errors }),
    );
  },
);

async function findAccount(req: Request): Promise<Account | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, req.params.accountId as string),
        eq(accounts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
      ),
    );
  return row;
}

router.get(
  "/orgs/:orgId/accounts/:accountId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    let relContacts: Contact[];
    let relOpps: Opportunity[];
    try {
      [relContacts, relOpps] = await Promise.all([
        db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.accountId, account.id),
              eq(contacts.isActive, true),
              eq(contacts.orgId, req.currentOrg!.id),
              ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
            ),
          )
          .orderBy(contacts.lastName),
        db
          .select()
          .from(opportunities)
          .where(and(
            eq(opportunities.accountId, account.id),
            eq(opportunities.orgId, req.currentOrg!.id),
            ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
          ))
          .orderBy(desc(opportunities.createdAt)),
      ]);
    } catch (error) {
      logger.error(
        {
          requestId: req.id,
          route: "account-detail",
          ...safeDatabaseErrorDetails(error),
        },
        "Account detail related-record query failed",
      );
      throw error;
    }
    res.json(
      GetAccountResponse.parse({
        ...accountDetail(account),
        contacts: await Promise.all(
          relContacts.map((contact) => contactOutForRequest(req, contact)),
        ),
        opportunities: relOpps.map((o) => ({
          id: o.id,
          accountId: o.accountId,
          name: o.name,
          stage: o.stage,
          probability: o.probability,
          value: o.value,
          expectedCloseDate: o.expectedCloseDate,
          forecastCategory: o.forecastCategory,
          ownerUserId: o.ownerUserId,
          createdByUserId: o.createdByUserId,
          createdAt: o.createdAt.toISOString(),
        })),
      }),
    );
  },
);

router.patch(
  "/orgs/:orgId/accounts/:accountId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = UpdateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const { ownerUserId, ...rest } = parsed.data;
    const updates: Partial<typeof accounts.$inferInsert> = rest;
    if (ownerUserId !== undefined) {
      const assignment = await requestedOwner(req, ownerUserId, "ownerUserId");
      if (assignment.error) {
        res.status(403).json({ error: assignment.error });
        return;
      }
      updates.ownerUserId = assignment.owner;
    }
    const [row] = await db
      .update(accounts)
      .set(updates)
      .where(and(eq(accounts.id, account.id), eq(accounts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Account not found" }); return; }
    await appendAuditEvent({
      orgId: row.orgId,
      action: "account.updated",
      entityType: "account",
      entityId: row.id,
      ...auditContext(req),
      metadata: { before: accountAudit(account), after: accountAudit(row) },
    });
    res.json(UpdateAccountResponse.parse(accountDetail(row)));
  },
);

router.delete(
  "/orgs/:orgId/accounts/:accountId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const [deleted] = await db
      .update(accounts)
      .set({ isActive: false })
      .where(and(eq(accounts.id, account.id), eq(accounts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Account not found" }); return; }
    await appendAuditEvent({
      orgId: account.orgId,
      action: "account.deleted",
      entityType: "account",
      entityId: account.id,
      ...auditContext(req),
      metadata: { before: accountAudit(account), after: accountAudit(deleted) },
    });
    res.status(204).end();
  },
);

/* ------------------------------- contacts ------------------------------ */

router.get(
  "/orgs/:orgId/accounts/:accountId/contacts",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const rows = await db
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.accountId, account.id),
        eq(contacts.orgId, req.currentOrg!.id),
        eq(contacts.isActive, true),
        ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
      ))
      .orderBy(contacts.lastName);
    res.json(
      ListContactsResponse.parse(
        await Promise.all(rows.map((contact) => contactOutForRequest(req, contact))),
      ),
    );
  },
);

router.post(
  "/orgs/:orgId/accounts/:accountId/contacts",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = CreateContactBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const { metadata, ownerUserId, ...rest } = parsed.data;
    const assignment = await requestedOwner(req, ownerUserId, "ownerUserId");
    if (assignment.error) {
      res.status(403).json({ error: assignment.error });
      return;
    }
    const row = await db.transaction(async (tx) => {
      const [lockedAccount] = await tx.select({ id: accounts.id }).from(accounts).where(and(
        eq(accounts.id, account.id), eq(accounts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
      )).for("update");
      if (!lockedAccount) return undefined;
      if (rest.reportsToContactId) {
        const [manager] = await tx.select({ id: contacts.id }).from(contacts).where(and(
          eq(contacts.id, rest.reportsToContactId), eq(contacts.accountId, lockedAccount.id),
          eq(contacts.orgId, req.currentOrg!.id),
          ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
        )).for("update");
        if (!manager) return undefined;
      }
      const [created] = await tx.insert(contacts).values({
        ...rest,
        metadata: metadata ?? {},
        orgId: req.currentOrg!.id,
        accountId: lockedAccount.id,
        ownerUserId: assignment.owner,
        createdByUserId: req.currentUser!.id,
      }).returning();
      return created;
    });
    if (!row) { res.status(404).json({ error: "Account or reporting contact not found" }); return; }
    await appendAuditEvent({
      orgId: row.orgId,
      action: "contact.created",
      entityType: "contact",
      entityId: row.id,
      ...auditContext(req),
      metadata: { after: contactAudit(row) },
    });
    res
      .status(201)
      .json(CreateContactResponse.parse(await contactOutForRequest(req, row)));
  },
);

async function findContact(req: Request): Promise<Contact | undefined> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, req.params.contactId as string),
        eq(contacts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
      ),
    );
  if (!row || !(await canAccessCrmRecord(req, "account", row.accountId))) {
    return undefined;
  }
  return row;
}

router.get(
  "/orgs/:orgId/contacts/:contactId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const contact = await findContact(req);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json(
      GetContactResponse.parse(await contactOutForRequest(req, contact)),
    );
  },
);

router.patch(
  "/orgs/:orgId/contacts/:contactId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = UpdateContactBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    if (parsed.data.reportsToContactId) {
      if (parsed.data.reportsToContactId === req.params.contactId) {
        res.status(400).json({ error: "A contact cannot report to themselves" });
        return;
      }
    }
    const { ownerUserId, ...rest } = parsed.data;
    const updates: Partial<typeof contacts.$inferInsert> = rest;
    if (ownerUserId !== undefined) {
      const assignment = await requestedOwner(req, ownerUserId, "ownerUserId");
      if (assignment.error) {
        res.status(403).json({ error: assignment.error });
        return;
      }
      updates.ownerUserId = assignment.owner;
    }
    const result = await db.transaction(async (tx) => {
      const [contact] = await tx.select().from(contacts).where(and(
        eq(contacts.id, req.params.contactId as string),
        eq(contacts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
      )).for("update");
      if (!contact) return undefined;
      if (rest.reportsToContactId) {
        const [manager] = await tx.select({ id: contacts.id }).from(contacts).where(and(
          eq(contacts.id, rest.reportsToContactId),
          eq(contacts.accountId, contact.accountId),
          eq(contacts.orgId, req.currentOrg!.id),
          ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
        )).for("update");
        if (!manager) return { error: "manager" as const };
      }
      const [row] = await tx.update(contacts).set(updates).where(and(
        eq(contacts.id, contact.id),
        eq(contacts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
      )).returning();
      if (!row) return undefined;
      return { contact, row };
    });
    if (!result) { res.status(404).json({ error: "Contact not found" }); return; }
    if ("error" in result) {
      res.status(400).json({ error: "reportsToContactId must reference a visible contact on the same account" });
      return;
    }
    const { contact, row } = result;
    await appendAuditEvent({
      orgId: row.orgId,
      action: "contact.updated",
      entityType: "contact",
      entityId: row.id,
      ...auditContext(req),
      metadata: { before: contactAudit(contact), after: contactAudit(row) },
    });
    res.json(
      UpdateContactResponse.parse(await contactOutForRequest(req, row)),
    );
  },
);

router.delete(
  "/orgs/:orgId/contacts/:contactId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const contact = await findContact(req);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    const [deleted] = await db
      .update(contacts)
      .set({ isActive: false })
      .where(and(eq(contacts.id, contact.id), eq(contacts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Contact not found" }); return; }
    await appendAuditEvent({
      orgId: contact.orgId,
      action: "contact.deleted",
      entityType: "contact",
      entityId: contact.id,
      ...auditContext(req),
      metadata: { before: contactAudit(contact), after: contactAudit(deleted) },
    });
    res.status(204).end();
  },
);

/* ------------------------- activities & timeline ------------------------ */

router.post(
  "/orgs/:orgId/accounts/:accountId/activities",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = CreateActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const { attachments, ...rest } = parsed.data;
    for (const att of attachments ?? []) {
      const err = await secureAttachmentPath(att.objectPath, req);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    const row = await db.transaction(async (tx) => {
      const [lockedAccount] = await tx.select({ id: accounts.id }).from(accounts).where(and(
        eq(accounts.id, account.id), eq(accounts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
      )).for("update");
      if (!lockedAccount) return undefined;
      if (rest.contactId) {
        const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(and(
          eq(contacts.id, rest.contactId), eq(contacts.accountId, lockedAccount.id),
          eq(contacts.orgId, req.currentOrg!.id),
          ...withCrmVisibility(req, contacts.ownerUserId, contacts.createdByUserId),
        )).for("update");
        if (!contact) return undefined;
      }
      if (rest.opportunityId) {
        const [opp] = await tx.select({ id: opportunities.id }).from(opportunities).where(and(
          eq(opportunities.id, rest.opportunityId), eq(opportunities.accountId, lockedAccount.id),
          eq(opportunities.orgId, req.currentOrg!.id),
          ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        )).for("update");
        if (!opp) return undefined;
      }
      const [created] = await tx.insert(activities).values({
        ...rest,
        attachments: attachments ?? [],
        orgId: req.currentOrg!.id,
        accountId: lockedAccount.id,
        createdByUserId: req.currentUser!.id,
      }).returning();
      return created;
    });
    if (!row) { res.status(404).json({ error: "Account or related CRM record not found" }); return; }
    res
      .status(201)
      .json(
        CreateActivityResponse.parse(
          activityOut(
            row,
            effectiveMemberDisplayName(req.currentMembership!, req.currentUser!),
          ),
        ),
      );
  },
);

router.get(
  "/orgs/:orgId/accounts/:accountId/timeline",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const account = await findAccount(req);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const rows = await db
        .select({
          activity: activities,
          userName: users.fullName,
          userEmail: users.email,
          memberDisplayName: orgUsers.displayName,
        })
      .from(activities)
      .leftJoin(users, eq(activities.createdByUserId, users.id))
        .leftJoin(
          orgUsers,
          and(
            eq(orgUsers.userId, users.id),
            eq(orgUsers.orgId, req.currentOrg!.id),
          ),
        )
      .where(
        and(
          eq(activities.accountId, account.id),
          eq(activities.orgId, req.currentOrg!.id),
        ),
      )
      .orderBy(desc(activities.createdAt));
    const visibleRows = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        relatedVisibility: {
          contact:
            !r.activity.contactId ||
            (await canAccessCrmRecord(req, "contact", r.activity.contactId)),
          opportunity:
            !r.activity.opportunityId ||
            (await canAccessCrmRecord(
              req,
              "opportunity",
              r.activity.opportunityId,
            )),
        },
      })),
    );
    res.json(
      GetAccountTimelineResponse.parse(
        visibleRows.map((r) =>
          activityOut(
            r.activity,
            r.userName || r.userEmail
              ? effectiveMemberDisplayName(
                  { displayName: r.memberDisplayName },
                  { fullName: r.userName, email: r.userEmail ?? "" },
                )
              : null,
            r.relatedVisibility,
          ),
        ),
      ),
    );
  },
);

router.post(
  "/orgs/:orgId/activities/:activityId/attach-file",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = AttachFileToActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [activity] = await db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.id, req.params.activityId as string),
          eq(activities.orgId, req.currentOrg!.id),
        ),
      );
    if (!activity) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    if (!(await canAccessCrmRecord(req, "account", activity.accountId))) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    const aclErr = await secureAttachmentPath(parsed.data.objectPath, req);
    if (aclErr) {
      res.status(400).json({ error: aclErr });
      return;
    }
    const attachment = {
      objectPath: parsed.data.objectPath,
      name: parsed.data.name,
      size: parsed.data.size ?? null,
      contentType: parsed.data.contentType ?? null,
      uploadedAt: new Date().toISOString(),
    };
    const nextAttachments = [
      ...((activity.attachments ?? []) as (typeof attachment)[]),
      attachment,
    ];
    const [row] = await db
      .update(activities)
      .set({ attachments: nextAttachments })
      .where(and(
        eq(activities.id, activity.id),
        eq(activities.orgId, req.currentOrg!.id),
        sql`exists (
          select 1 from ${accounts}
          where ${accounts.id} = ${activities.accountId}
            and ${accounts.orgId} = ${req.currentOrg!.id}
            ${hasCrmManagementAccess(req) ? sql`` : sql`and ${accounts.ownerUserId} is not null and (${accounts.ownerUserId} = ${req.currentUser!.id} or ${accounts.createdByUserId} = ${req.currentUser!.id})`}
        )`,
      ))
      .returning();
    if (!row) { res.status(404).json({ error: "Activity not found" }); return; }

    // Also surface the file on the parent account's files list so account
    // and opportunity records carry their attachments (per spec).
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, activity.accountId));
    if (account) {
      const [updatedAccount] = await db
        .update(accounts)
        .set({
          files: [
            ...((account.files ?? []) as (typeof attachment)[]),
            attachment,
          ],
        })
        .where(and(
          eq(accounts.id, account.id),
          eq(accounts.orgId, req.currentOrg!.id),
          ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        ))
        .returning({ id: accounts.id });
      if (!updatedAccount) {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      await appendAuditEvent({
        orgId: req.currentOrg!.id,
        action: "account.updated",
        entityType: "account",
        entityId: account.id,
        ...auditContext(req),
        metadata: {
          operation: "activity_file_attached",
          activityId: activity.id,
          fileName: attachment.name,
          contentType: attachment.contentType,
        },
      });
    }

    const userName = effectiveMemberDisplayName(
      req.currentMembership!,
      req.currentUser!,
    );
    res.json(AttachFileToActivityResponse.parse(activityOut(row, userName)));
  },
);

/* ------------------------------- segments ------------------------------ */

router.get(
  "/orgs/:orgId/segments",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    // A segment's conditions are a saved view over CRM rows.  Management may
    // see all saved views; other members may only see views they created.
    // queryAccountsByConditions below independently applies CRM row
    // visibility when calculating each match count.
    const where = segmentVisibilityScope(req);
    const rows = await db
      .select()
      .from(segments)
      .where(and(...where))
      .orderBy(desc(segments.createdAt));
    // Segments auto-update: compute live match counts on every read.
    const withCounts = await Promise.all(
      rows.map(async (s) => {
        const matches = await queryAccountsByConditions(
          req,
          (s.conditions ?? []) as Condition[],
        );
        return segmentOut(s, matches.length);
      }),
    );
    res.json(ListSegmentsResponse.parse(withCounts));
  },
);

router.post(
  "/orgs/:orgId/segments",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = CreateSegmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [row] = await db
      .insert(segments)
      .values({
        name: parsed.data.name,
        description: parsed.data.description,
        conditions: parsed.data.conditions,
        orgId: req.currentOrg!.id,
        createdByUserId: req.currentUser!.id,
      })
      .returning();
    res.status(201).json(CreateSegmentResponse.parse(segmentOut(row)));
  },
);

async function findSegment(req: Request): Promise<Segment | undefined> {
  const [row] = await db
    .select()
    .from(segments)
    .where(and(...segmentVisibilityScope(req, req.params.segmentId as string)));
  return row;
}

router.patch(
  "/orgs/:orgId/segments/:segmentId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = CreateSegmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const segment = await findSegment(req);
    if (!segment) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }
    const [row] = await db
      .update(segments)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        conditions: parsed.data.conditions,
      })
      .where(and(...segmentVisibilityScope(req, req.params.segmentId as string)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }
    res.json(UpdateSegmentResponse.parse(segmentOut(row)));
  },
);

router.delete(
  "/orgs/:orgId/segments/:segmentId",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const segment = await findSegment(req);
    if (!segment) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }
    const [deleted] = await db
      .delete(segments)
      .where(and(...segmentVisibilityScope(req, req.params.segmentId as string)))
      .returning({ id: segments.id });
    if (!deleted) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/orgs/:orgId/segments/:segmentId/preview",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const segment = await findSegment(req);
    if (!segment) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }
    const rows = await queryAccountsByConditions(
      req,
      (segment.conditions ?? []) as Condition[],
    );
    res.json(PreviewSegmentResponse.parse(rows.map(accountSummary)));
  },
);

router.post(
  "/orgs/:orgId/segments/preview",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const parsed = PreviewSegmentConditionsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const rows = await queryAccountsByConditions(
      req,
      parsed.data.conditions as Condition[],
    );
    res.json(PreviewSegmentConditionsResponse.parse(rows.map(accountSummary)));
  },
);

export default router;
