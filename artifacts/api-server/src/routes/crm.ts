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
  segments,
  users,
  type Account,
  type Contact,
  type Activity,
  type Segment,
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
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  getObjectAclPolicy,
  setObjectAclPolicy,
  ObjectAccessGroupType,
  ObjectPermission,
} from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

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
  let objectFile;
  try {
    objectFile = await objectStorage.getObjectEntityFile(objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return "Attachment object not found";
    throw err;
  }
  const clerkId = req.currentUser!.clerkId;
  const orgId = req.currentOrg!.id;
  const existing = await getObjectAclPolicy(objectFile);
  if (existing) {
    const boundToThisOrg = existing.aclRules?.some(
      (r) =>
        r.group.type === ObjectAccessGroupType.ORG_MEMBER && r.group.id === orgId,
    );
    if (!boundToThisOrg && existing.owner !== clerkId) {
      return "Attachment does not belong to this organization";
    }
    if (boundToThisOrg) return null; // already bound correctly
  }
  await setObjectAclPolicy(objectFile, {
    owner: clerkId ?? "",
    visibility: "private",
    aclRules: [
      {
        group: { type: ObjectAccessGroupType.ORG_MEMBER, id: orgId },
        permission: ObjectPermission.READ,
      },
    ],
  });
  return null;
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

function contactOut(c: Contact) {
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
    reportsToContactId: c.reportsToContactId,
    isActive: c.isActive,
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
    createdAt: c.createdAt.toISOString(),
  };
}

function activityOut(a: Activity, createdByName?: string | null) {
  return {
    id: a.id,
    accountId: a.accountId,
    contactId: a.contactId,
    opportunityId: a.opportunityId,
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
  orgId: string,
  conds: Condition[],
): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        eq(accounts.isActive, true),
        ...conditionsToWhere(conds),
      ),
    )
    .orderBy(desc(accounts.createdAt));
}

/* ------------------------------- accounts ------------------------------ */

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
        .where(
          and(eq(segments.id, segmentId), eq(segments.orgId, req.currentOrg!.id)),
        );
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
    const { metadata, ...rest } = parsed.data;
    const [row] = await db
      .insert(accounts)
      .values({
        ...rest,
        metadata: metadata ?? {},
        orgId: req.currentOrg!.id,
        ownerUserId: req.currentUser!.id,
      })
      .returning();
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
          })
          .returning();
        accountsCreated += 1;
        for (const c of nestedContacts ?? []) {
          const { metadata: cMeta, ...contactFields } = c;
          await db.insert(contacts).values({
            ...contactFields,
            metadata: cMeta ?? {},
            orgId,
            accountId: acc.id,
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
    const [relContacts, relOpps] = await Promise.all([
      db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.accountId, account.id),
            eq(contacts.isActive, true),
          ),
        )
        .orderBy(contacts.lastName),
      db
        .select()
        .from(opportunities)
        .where(eq(opportunities.accountId, account.id))
        .orderBy(desc(opportunities.createdAt)),
    ]);
    res.json(
      GetAccountResponse.parse({
        ...accountDetail(account),
        contacts: relContacts.map(contactOut),
        opportunities: relOpps.map((o) => ({
          id: o.id,
          accountId: o.accountId,
          name: o.name,
          stage: o.stage,
          probability: o.probability,
          value: o.value,
          expectedCloseDate: o.expectedCloseDate,
          forecastCategory: o.forecastCategory,
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
    const [row] = await db
      .update(accounts)
      .set(parsed.data)
      .where(eq(accounts.id, account.id))
      .returning();
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
    await db
      .update(accounts)
      .set({ isActive: false })
      .where(eq(accounts.id, account.id));
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
      .where(and(eq(contacts.accountId, account.id), eq(contacts.isActive, true)))
      .orderBy(contacts.lastName);
    res.json(ListContactsResponse.parse(rows.map(contactOut)));
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
    const { metadata, ...rest } = parsed.data;
    if (rest.reportsToContactId) {
      const [manager] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.id, rest.reportsToContactId),
            eq(contacts.accountId, account.id),
          ),
        );
      if (!manager) {
        res.status(400).json({ error: "reportsToContactId must reference a contact on the same account" });
        return;
      }
    }
    const [row] = await db
      .insert(contacts)
      .values({
        ...rest,
        metadata: metadata ?? {},
        orgId: req.currentOrg!.id,
        accountId: account.id,
      })
      .returning();
    res.status(201).json(CreateContactResponse.parse(contactOut(row)));
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
      ),
    );
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
    res.json(GetContactResponse.parse(contactOut(contact)));
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
    const contact = await findContact(req);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    if (parsed.data.reportsToContactId) {
      if (parsed.data.reportsToContactId === contact.id) {
        res.status(400).json({ error: "A contact cannot report to themselves" });
        return;
      }
      const [manager] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.id, parsed.data.reportsToContactId),
            eq(contacts.accountId, contact.accountId),
          ),
        );
      if (!manager) {
        res.status(400).json({ error: "reportsToContactId must reference a contact on the same account" });
        return;
      }
    }
    const [row] = await db
      .update(contacts)
      .set(parsed.data)
      .where(eq(contacts.id, contact.id))
      .returning();
    res.json(UpdateContactResponse.parse(contactOut(row)));
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
    await db
      .update(contacts)
      .set({ isActive: false })
      .where(eq(contacts.id, contact.id));
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
    if (rest.contactId) {
      const [contact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, rest.contactId), eq(contacts.accountId, account.id)));
      if (!contact) {
        res.status(400).json({ error: "contactId must reference a contact on this account" });
        return;
      }
    }
    if (rest.opportunityId) {
      const [opp] = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.id, rest.opportunityId),
            eq(opportunities.accountId, account.id),
          ),
        );
      if (!opp) {
        res.status(400).json({ error: "opportunityId must reference an opportunity on this account" });
        return;
      }
    }
    for (const att of attachments ?? []) {
      const err = await secureAttachmentPath(att.objectPath, req);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    const [row] = await db
      .insert(activities)
      .values({
        ...rest,
        attachments: attachments ?? [],
        orgId: req.currentOrg!.id,
        accountId: account.id,
        createdByUserId: req.currentUser!.id,
      })
      .returning();
    res
      .status(201)
      .json(
        CreateActivityResponse.parse(
          activityOut(row, req.currentUser!.fullName ?? req.currentUser!.email),
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
      .select({ activity: activities, userName: users.fullName, userEmail: users.email })
      .from(activities)
      .leftJoin(users, eq(activities.createdByUserId, users.id))
      .where(eq(activities.accountId, account.id))
      .orderBy(desc(activities.createdAt));
    res.json(
      GetAccountTimelineResponse.parse(
        rows.map((r) => activityOut(r.activity, r.userName ?? r.userEmail)),
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
      .where(eq(activities.id, activity.id))
      .returning();

    // Also surface the file on the parent account's files list so account
    // and opportunity records carry their attachments (per spec).
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, activity.accountId));
    if (account) {
      await db
        .update(accounts)
        .set({
          files: [
            ...((account.files ?? []) as (typeof attachment)[]),
            attachment,
          ],
        })
        .where(eq(accounts.id, account.id));
    }

    const userName = req.currentUser!.fullName ?? req.currentUser!.email;
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
    const rows = await db
      .select()
      .from(segments)
      .where(eq(segments.orgId, req.currentOrg!.id))
      .orderBy(desc(segments.createdAt));
    // Segments auto-update: compute live match counts on every read.
    const withCounts = await Promise.all(
      rows.map(async (s) => {
        const matches = await queryAccountsByConditions(
          req.currentOrg!.id,
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
    .where(
      and(
        eq(segments.id, req.params.segmentId as string),
        eq(segments.orgId, req.currentOrg!.id),
      ),
    );
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
      .where(eq(segments.id, segment.id))
      .returning();
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
    await db.delete(segments).where(eq(segments.id, segment.id));
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
      req.currentOrg!.id,
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
      req.currentOrg!.id,
      parsed.data.conditions as Condition[],
    );
    res.json(PreviewSegmentConditionsResponse.parse(rows.map(accountSummary)));
  },
);

export default router;
