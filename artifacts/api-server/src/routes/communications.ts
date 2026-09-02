import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  accounts,
  activities,
  calendarEvents,
  callRecordings,
  communicationSettings,
  contacts,
  db,
  emailMessages,
  emailThreads,
  internalNotes,
  orgUsers,
  providerSyncStates,
  providerBindings,
  users,
} from "@workspace/db";
import {
  CreateInternalNoteBody,
  InitiateCrmCallBody,
  SendCrmEmailBody,
  UpdateInternalNoteBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { attachOrg, attachUser, requireFeature, requireRole } from "../middlewares/auth";
import { sendEmail } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectAccessGroupType, ObjectPermission, setObjectAclPolicy } from "../lib/objectAcl";
import { analyzeConversation } from "../services/conversationIntelligence";

const router: IRouter = Router();
const gate = [attachUser, attachOrg, requireFeature("crm")] as const;
const storage = new ObjectStorageService();
const providers = ["gmail", "outlook", "google_calendar", "slack"] as const;
type Provider = (typeof providers)[number];
const providerParam = z.enum(providers);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ProviderUnavailableError extends Error {
  constructor(
    public readonly statusCode: 502 | 503,
    provider: Provider,
    cause?: unknown,
  ) {
    super(`Provider "${provider}" is unavailable or unauthorized.`);
    this.name = "ProviderUnavailableError";
    this.cause = cause;
  }
}

function connectorName(provider: Provider): string {
  return provider === "google_calendar" ? "google-calendar" : provider === "gmail" ? "google-mail" : provider;
}

/** Raw proxy is deliberately restricted to connector identity probes below. */
async function rawIdentityProxy(
  provider: Provider,
  path: string,
): Promise<Awaited<ReturnType<ReplitConnectors["proxy"]>>> {
  return new ReplitConnectors().proxy(connectorName(provider), path);
}

async function boundProvider(orgId: string, provider: Provider) {
  const [binding] = await db.select().from(providerBindings).where(and(
    eq(providerBindings.orgId, orgId), eq(providerBindings.provider, provider),
  ));
  if (!binding) throw new Error("Provider is not bound to this organization");
  return binding;
}

/**
 * Connectors resolve deployment-wide. This runtime probe is the fail-closed
 * guard if that deployment connector is later resolved to another account.
 * It is intentionally never cached outside the active operation/request.
 */
async function connectorIdentity(provider: Provider): Promise<{ id: string; email: string }> {
  const get = async (path: string) => {
    let response: Awaited<ReturnType<ReplitConnectors["proxy"]>>;
    try {
      response = await rawIdentityProxy(provider, path);
    } catch (error) {
      throw new ProviderUnavailableError(503, provider, error);
    }
    if (!response.ok) {
      throw new ProviderUnavailableError(
        response.status === 401 || response.status === 403 || response.status === 404 ? 503 : 502,
        provider,
      );
    }
    return await response.json() as Record<string, unknown>;
  };
  if (provider === "gmail") {
    const p = await get("/gmail/v1/users/me/profile");
    return { id: String(p.emailAddress ?? ""), email: String(p.emailAddress ?? "").toLowerCase() };
  }
  if (provider === "outlook") {
    const p = await get("/v1.0/me");
    const email = String(p.mail ?? p.userPrincipalName ?? "").toLowerCase();
    return { id: String(p.id ?? email), email };
  }
  if (provider === "google_calendar") {
    const p = await get("/calendar/v3/users/me/calendarList/primary");
    const email = String(p.id ?? "").toLowerCase();
    return { id: String(p.id ?? ""), email };
  }
  const auth = await get("/api/auth.test");
  const id = String(auth.user_id ?? "");
  if (!id) throw new ProviderUnavailableError(502, provider);
  const profile = await get(`/api/users.info?user=${encodeURIComponent(id)}`);
  const user = profile.user as Record<string, unknown> | undefined;
  const profileData = user?.profile as Record<string, unknown> | undefined;
  return { id, email: String(profileData?.email ?? "").toLowerCase() };
}

async function verifiedProvider(orgId: string, provider: Provider) {
  const binding = await boundProvider(orgId, provider);
  const identity = await connectorIdentity(provider);
  if (
    !identity.id ||
    !identity.email ||
    identity.id !== binding.providerAccountId ||
    identity.email.toLowerCase() !== binding.providerAccountEmail.toLowerCase()
  ) {
    throw new Error("Connected workspace account no longer matches this organization binding");
  }
  return binding;
}

async function aiEnabled(orgId: string): Promise<boolean> {
  const [settings] = await db.select({ enabled: communicationSettings.aiAnalysisEnabled })
    .from(communicationSettings).where(eq(communicationSettings.orgId, orgId));
  return settings?.enabled ?? false;
}

async function connectorJson(orgId: string, provider: Provider, path: string, options?: { method?: string; body?: unknown }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Clients are intentionally short-lived. Connector credentials/tokens are never read or cached.
    await verifiedProvider(orgId, provider);
    const response = await new ReplitConnectors().proxy(connectorName(provider), path, options);
    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!response.ok) throw new Error(`${provider} returned ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
  throw new Error(`${provider} retry limit reached`);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => {
    if (typeof x === "string") return x;
    const record = x as Record<string, unknown>;
    const address = record.emailAddress as Record<string, unknown> | undefined;
    return String(address?.address ?? record.email ?? "");
  }).filter(Boolean);
}

function emailFromHeader(value: string): string {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
}

function externalBase(req: Request): string {
  const protocol = String(req.get("x-forwarded-proto") ?? req.protocol).split(",")[0].trim();
  const host = String(req.get("x-forwarded-host") ?? req.get("host")).split(",")[0].trim();
  return `${protocol}://${host}`;
}

async function contactByEmails(orgId: string, emails: string[]) {
  const normalized = [...new Set(emails.map(emailFromHeader).filter(Boolean))];
  if (!normalized.length) return undefined;
  return db.select({ contact: contacts }).from(contacts)
    .innerJoin(accounts, and(eq(accounts.id, contacts.accountId), eq(accounts.orgId, orgId)))
    .where(and(eq(contacts.orgId, orgId), eq(contacts.isActive, true), eq(accounts.isActive, true), inArray(contacts.email, normalized)))
    .then((r) => r[0]?.contact);
}

async function upsertEmail(
  orgId: string,
  provider: Provider,
  externalThreadId: string,
  rawMessages: Record<string, unknown>[],
  fallback: Record<string, unknown>,
) {
  const header = (message: Record<string, unknown>, name: string) => {
    const headers = ((message.payload as Record<string, unknown> | undefined)?.headers ?? []) as Record<string, unknown>[];
    return String(headers.find((h) => String(h.name).toLowerCase() === name)?.value ?? "");
  };
  const first = rawMessages[0] ?? fallback;
  const last = rawMessages.at(-1) ?? first;
  const outlookFrom = ((first.from as Record<string, unknown> | undefined)?.emailAddress as Record<string, unknown> | undefined)?.address;
  const participantEmails = [
    header(first, "from"), header(first, "to"), String(outlookFrom ?? ""),
    ...strings(first.toRecipients), ...strings(first.ccRecipients),
  ].flatMap((v) => v.split(",")).map(emailFromHeader).filter(Boolean);
  const contact = await contactByEmails(orgId, participantEmails);
  if (!contact) return 0;
  const sentAtRaw = last.internalDate ?? last.sentDateTime ?? last.receivedDateTime ?? fallback.historyId;
  const sentAt = sentAtRaw ? new Date(/^\d+$/.test(String(sentAtRaw)) ? Number(sentAtRaw) : String(sentAtRaw)) : new Date();
  const subject = header(first, "subject") || String(first.subject ?? fallback.subject ?? "");
  const snippet = String(last.snippet ?? last.bodyPreview ?? fallback.snippet ?? "");
  const analysis = (await aiEnabled(orgId))
    ? await analyzeConversation(rawMessages.map((m) => String(m.snippet ?? m.bodyPreview ?? "")).join("\n"))
    : null;
  const [thread] = await db.insert(emailThreads).values({
    orgId, accountId: contact.accountId, contactId: contact.id, provider,
    externalThreadId, subject, snippet, participants: participantEmails, lastMessageAt: sentAt,
    summary: analysis?.summary, sentiment: analysis?.sentiment, keywords: analysis?.keywords,
    objections: analysis?.objections, leaning: analysis?.leaning,
  }).onConflictDoUpdate({
    target: [emailThreads.orgId, emailThreads.provider, emailThreads.externalThreadId],
    set: { subject, snippet, participants: participantEmails, lastMessageAt: sentAt,
      summary: analysis?.summary, sentiment: analysis?.sentiment, keywords: analysis?.keywords,
      objections: analysis?.objections, leaning: analysis?.leaning },
  }).returning();

  for (const message of rawMessages) {
    const externalMessageId = String(message.id ?? message.internetMessageId ?? "");
    if (!externalMessageId) continue;
    const from = header(message, "from") || String((((message.from as Record<string, unknown> | undefined)?.emailAddress as Record<string, unknown> | undefined)?.address) ?? "");
    const messageDate = message.internalDate ?? message.sentDateTime ?? message.receivedDateTime;
    const messageSentAt = messageDate ? new Date(/^\d+$/.test(String(messageDate)) ? Number(messageDate) : String(messageDate)) : sentAt;
    await db.insert(emailMessages).values({
      orgId, threadId: thread.id, provider, externalMessageId, sender: from,
      recipients: strings(message.toRecipients), subject: header(message, "subject") || String(message.subject ?? subject),
      snippet: String(message.snippet ?? message.bodyPreview ?? ""), sentAt: messageSentAt,
    }).onConflictDoNothing();
    await db.insert(activities).values({
      orgId, accountId: contact.accountId, contactId: contact.id, threadId: thread.id,
      type: "email", subject, body: String(message.snippet ?? message.bodyPreview ?? ""),
      externalMessageId: `mail:${provider}:${externalMessageId}`, participants: participantEmails, createdAt: messageSentAt,
    }).onConflictDoNothing();
  }
  return rawMessages.length;
}

async function syncMail(orgId: string, provider: Provider) {
  let profile: Record<string, unknown>;
  let batches: { id: string; raw: Record<string, unknown> }[] = [];
  if (provider === "gmail") {
    profile = await connectorJson(orgId, provider, "/gmail/v1/users/me/profile");
    const [state] = await db.select().from(providerSyncStates).where(and(eq(providerSyncStates.orgId, orgId), eq(providerSyncStates.provider, provider)));
    const after = state?.lastSyncedAt ? ` after:${state.lastSyncedAt.toISOString().slice(0, 10).replace(/-/g, "/")}` : " newer_than:90d";
    const search = await connectorJson(orgId, provider, `/gmail/v1/users/me/threads?maxResults=50&q=${encodeURIComponent(after.trim())}`);
    batches = (((search.threads ?? []) as Record<string, unknown>[]).slice(0, 50)).map((x) => ({ id: String(x.id), raw: x }));
  } else {
    profile = await connectorJson(orgId, provider, "/v1.0/me");
    const [state] = await db.select().from(providerSyncStates).where(and(eq(providerSyncStates.orgId, orgId), eq(providerSyncStates.provider, provider)));
    const filter = state?.lastSyncedAt ? `&$filter=receivedDateTime%20ge%20${encodeURIComponent(state.lastSyncedAt.toISOString())}` : "";
    const search = await connectorJson(orgId, provider, `/v1.0/me/messages?$top=50&$orderby=receivedDateTime%20desc${filter}`);
    const messages = (search.value ?? []) as Record<string, unknown>[];
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const m of messages) {
      const id = String(m.conversationId ?? m.id);
      grouped.set(id, [...(grouped.get(id) ?? []), m]);
    }
    batches = [...grouped].map(([id, value]) => ({ id, raw: { value } }));
  }
  let synced = 0;
  for (const batch of batches) {
    const detail = provider === "gmail"
      ? await connectorJson(orgId, provider, `/gmail/v1/users/me/threads/${encodeURIComponent(batch.id)}?format=metadata`)
      : batch.raw;
    synced += await upsertEmail(orgId, provider, batch.id, ((detail.messages ?? detail.value ?? []) as Record<string, unknown>[]), detail);
  }
  return { synced, profile };
}

async function syncCalendar(orgId: string, provider: Provider) {
  const now = new Date();
  const max = new Date(now.getTime() + 90 * 86400_000);
  const data = provider === "google_calendar"
    ? await connectorJson(orgId, provider, `/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=250&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(max.toISOString())}`)
    : await connectorJson(orgId, provider, `/v1.0/me/calendarView?startDateTime=${encodeURIComponent(now.toISOString())}&endDateTime=${encodeURIComponent(max.toISOString())}&$top=250`);
  const items = (data.items ?? data.value ?? []) as Record<string, unknown>[];
  let synced = 0;
  for (const item of items) {
    const attendeesRaw = (item.attendees ?? []) as Record<string, unknown>[];
    const attendeeEmails = attendeesRaw.map((a) => String(a.email ?? ((a.emailAddress as Record<string, unknown> | undefined)?.address ?? ""))).filter(Boolean);
    const contact = await contactByEmails(orgId, attendeeEmails);
    if (!contact) continue;
    const externalEventId = String(item.id);
    const startRaw = (item.start as Record<string, unknown> | undefined)?.dateTime ?? (item.start as Record<string, unknown> | undefined)?.date;
    const endRaw = (item.end as Record<string, unknown> | undefined)?.dateTime ?? (item.end as Record<string, unknown> | undefined)?.date;
    if (!startRaw) continue;
    const title = String(item.summary ?? item.subject ?? "(Untitled event)");
    const [event] = await db.insert(calendarEvents).values({
      orgId, accountId: contact.accountId, contactId: contact.id, provider, externalEventId,
      title, description: String(item.description ?? ((item.body as Record<string, unknown> | undefined)?.content ?? "")),
      location: String((item.location as Record<string, unknown> | undefined)?.displayName ?? item.location ?? ""),
      attendees: attendeeEmails, startsAt: new Date(String(startRaw)), endsAt: endRaw ? new Date(String(endRaw)) : null,
      meetingUrl: String(item.hangoutLink ?? item.onlineMeetingUrl ?? ""), status: String(item.status ?? ""),
    }).onConflictDoUpdate({
      target: [calendarEvents.orgId, calendarEvents.provider, calendarEvents.externalEventId],
      set: { title, attendees: attendeeEmails, startsAt: new Date(String(startRaw)), endsAt: endRaw ? new Date(String(endRaw)) : null },
    }).returning();
    await db.insert(activities).values({
      orgId, accountId: contact.accountId, contactId: contact.id, calendarEventId: event.id,
      type: "calendar", subject: title, body: event.description, externalMessageId: `calendar:${provider}:${externalEventId}`, participants: attendeeEmails, createdAt: event.startsAt,
    }).onConflictDoNothing();
    synced += 1;
  }
  return synced;
}

router.get("/orgs/:orgId/providers", ...gate, async (req, res): Promise<void> => {
  const states = await db.select().from(providerSyncStates).where(eq(providerSyncStates.orgId, req.currentOrg!.id));
  const bindings = await db.select().from(providerBindings);
  const aiAnalysisEnabled = await aiEnabled(req.currentOrg!.id);
  res.json({ providers: providers.map((provider) => ({
    provider,
    available: true,
    sync: states.find((s) => s.provider === provider) ?? null,
    bindingStatus: !bindings.find((b) => b.provider === provider)
      ? "available_unbound"
      : bindings.some((b) => b.provider === provider && b.orgId === req.currentOrg!.id)
        ? "bound_this_org"
        : "bound_other_org",
  })), aiAnalysisEnabled });
});

router.post("/orgs/:orgId/providers/:provider/bind", attachUser, attachOrg, requireFeature("crm"), requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = providerParam.safeParse(req.params.provider);
  if (!parsed.success) { res.status(400).json({ error: "Unsupported provider" }); return; }
  const provider = parsed.data;
  try {
    const identity = await connectorIdentity(provider);
    const signedInEmail = req.currentUser!.email.trim().toLowerCase();
    if (!identity.id || !identity.email || identity.email.trim().toLowerCase() !== signedInEmail) {
      res.status(403).json({ error: "The connected workspace account must exactly match the signed-in admin email." });
      return;
    }
    const [binding] = await db.insert(providerBindings).values({
      orgId: req.currentOrg!.id, provider, boundByUserId: req.currentUser!.id,
      providerAccountId: identity.id, providerAccountEmail: identity.email.trim().toLowerCase(), verifiedAt: new Date(),
    }).onConflictDoNothing().returning();
    if (!binding) {
      const [existing] = await db.select().from(providerBindings).where(eq(providerBindings.provider, provider));
      res.status(existing?.orgId === req.currentOrg!.id ? 200 : 409).json({
        provider, bindingStatus: existing?.orgId === req.currentOrg!.id ? "bound_this_org" : "bound_other_org",
      });
      return;
    }
    await db.insert(providerSyncStates).values({
      orgId: binding.orgId, userId: binding.boundByUserId, provider, providerAccountId: "default", status: "bound",
    }).onConflictDoNothing();
    res.status(201).json({ provider, bindingStatus: "bound_this_org", boundByUserId: binding.boundByUserId });
  } catch (error) {
    req.log.error({ err: error, provider }, "Provider binding failed");
    if (error instanceof ProviderUnavailableError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: "Provider binding could not be created" });
  }
});
router.delete("/orgs/:orgId/providers/:provider/bind", attachUser, attachOrg, requireFeature("crm"), requireRole("owner"), async (req, res): Promise<void> => {
  const parsed = providerParam.safeParse(req.params.provider);
  if (!parsed.success) { res.status(400).json({ error: "Unsupported provider" }); return; }
  await db.delete(providerBindings).where(and(eq(providerBindings.orgId, req.currentOrg!.id), eq(providerBindings.provider, parsed.data)));
  res.status(204).end();
});
router.get("/orgs/:orgId/communication-settings", ...gate, async (req, res): Promise<void> => {
  res.json({ aiAnalysisEnabled: await aiEnabled(req.currentOrg!.id) });
});
router.put("/orgs/:orgId/communication-settings", attachUser, attachOrg, requireFeature("crm"), requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = z.object({ aiAnalysisEnabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "aiAnalysisEnabled must be boolean" }); return; }
  const [settings] = await db.insert(communicationSettings).values({
    orgId: req.currentOrg!.id, aiAnalysisEnabled: parsed.data.aiAnalysisEnabled, updatedByUserId: req.currentUser!.id,
  }).onConflictDoUpdate({
    target: communicationSettings.orgId,
    set: { aiAnalysisEnabled: parsed.data.aiAnalysisEnabled, updatedByUserId: req.currentUser!.id },
  }).returning();
  res.json({ aiAnalysisEnabled: settings.aiAnalysisEnabled, updatedAt: settings.updatedAt.toISOString() });
});

router.post("/orgs/:orgId/providers/:provider/sync", attachUser, attachOrg, requireFeature("crm"), requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = providerParam.safeParse(req.params.provider);
  if (!parsed.success) { res.status(400).json({ error: "Unsupported provider" }); return; }
  const provider = parsed.data;
  if (provider === "slack") { res.status(400).json({ error: "Slack does not support CRM sync" }); return; }
  try {
    await boundProvider(req.currentOrg!.id, provider);
    const token = randomBytes(16).toString("hex");
    const now = new Date();
    const [lock] = await db.update(providerSyncStates).set({ syncLockToken: token, syncLockedAt: now })
      .where(and(eq(providerSyncStates.orgId, req.currentOrg!.id), eq(providerSyncStates.provider, provider),
        or(isNull(providerSyncStates.syncLockedAt), lt(providerSyncStates.syncLockedAt, new Date(now.getTime() - 15 * 60_000))),
        or(isNull(providerSyncStates.cooldownUntil), lte(providerSyncStates.cooldownUntil, now)),
      )).returning();
    if (!lock) { res.status(429).json({ error: "A sync is already running or recently completed; try again later" }); return; }
    const result = provider === "google_calendar"
      ? { synced: await syncCalendar(req.currentOrg!.id, provider), profile: {} }
      : provider === "outlook"
        ? { synced: (await syncMail(req.currentOrg!.id, provider)).synced + await syncCalendar(req.currentOrg!.id, provider), profile: {} }
        : await syncMail(req.currentOrg!.id, provider);
    const providerAccountId = String(result.profile.id ?? result.profile.emailAddress ?? req.currentUser!.id);
    await db.update(providerSyncStates).set({
      userId: req.currentUser!.id, providerAccountId,
      providerEmail: String(result.profile.emailAddress ?? result.profile.mail ?? ""), status: "connected", lastSyncedAt: new Date(), lastError: null,
      cursor: new Date().toISOString(), cooldownUntil: new Date(Date.now() + 60_000), syncLockedAt: null, syncLockToken: null,
    }).where(and(eq(providerSyncStates.orgId, req.currentOrg!.id), eq(providerSyncStates.provider, provider), eq(providerSyncStates.syncLockToken, token)));
    res.json({ provider, status: "synced", recordsSynced: result.synced, lastSyncedAt: new Date().toISOString() });
  } catch (error) {
    req.log.error({ err: error, provider }, "Provider sync failed");
    await db.update(providerSyncStates).set({ status: "error", syncLockedAt: null, syncLockToken: null,
      lastError: error instanceof Error ? error.message : "Provider sync failed" })
      .where(and(eq(providerSyncStates.orgId, req.currentOrg!.id), eq(providerSyncStates.provider, provider)));
    res.status(502).json({ error: error instanceof Error ? error.message : "Provider sync failed" });
  }
});

router.get("/orgs/:orgId/accounts/:accountId/email-threads", ...gate, async (req, res): Promise<void> => {
  const accountId = z.string().uuid().safeParse(req.params.accountId);
  if (!accountId.success) { res.status(400).json({ error: "Invalid accountId" }); return; }
  const rows = await db.select().from(emailThreads).where(and(
    eq(emailThreads.orgId, req.currentOrg!.id), eq(emailThreads.accountId, accountId.data),
  )).orderBy(desc(emailThreads.lastMessageAt)).limit(100);
  res.json(rows);
});
router.get("/orgs/:orgId/email-threads/:threadId", ...gate, async (req, res): Promise<void> => {
  const [thread] = await db.select().from(emailThreads).where(and(
    eq(emailThreads.orgId, req.currentOrg!.id), eq(emailThreads.id, req.params.threadId as string),
  ));
  if (!thread) { res.status(404).json({ error: "Email thread not found" }); return; }
  const messages = await db.select().from(emailMessages).where(and(
    eq(emailMessages.orgId, req.currentOrg!.id), eq(emailMessages.threadId, thread.id),
  )).orderBy(emailMessages.sentAt);
  res.json({ ...thread, messages });
});
router.get("/orgs/:orgId/accounts/:accountId/calendar-events", ...gate, async (req, res): Promise<void> => {
  const accountId = z.string().uuid().safeParse(req.params.accountId);
  if (!accountId.success) { res.status(400).json({ error: "Invalid accountId" }); return; }
  res.json(await db.select().from(calendarEvents).where(and(
    eq(calendarEvents.orgId, req.currentOrg!.id), eq(calendarEvents.accountId, accountId.data),
  )).orderBy(calendarEvents.startsAt).limit(250));
});
router.get("/orgs/:orgId/accounts/:accountId/calls", ...gate, async (req, res): Promise<void> => {
  const accountId = z.string().uuid().safeParse(req.params.accountId);
  if (!accountId.success) { res.status(400).json({ error: "Invalid accountId" }); return; }
  res.json(await db.select().from(callRecordings).where(and(
    eq(callRecordings.orgId, req.currentOrg!.id), eq(callRecordings.accountId, accountId.data),
  )).orderBy(desc(callRecordings.createdAt)).limit(100));
});
router.get("/orgs/:orgId/calls/:callId", ...gate, async (req, res): Promise<void> => {
  const [call] = await db.select().from(callRecordings).where(and(
    eq(callRecordings.orgId, req.currentOrg!.id), eq(callRecordings.id, req.params.callId as string),
  ));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(call);
});

async function validateMentions(orgId: string, ids: string[]) {
  if (!ids.length) return true;
  const rows = await db.select({ userId: orgUsers.userId }).from(orgUsers).where(and(eq(orgUsers.orgId, orgId), inArray(orgUsers.userId, ids)));
  return new Set(rows.map((r) => r.userId)).size === new Set(ids).size;
}
async function notifyMentions(req: Request, ids: string[], body: string) {
  if (!ids.length) return;
  const mentioned = await db.select().from(users).where(inArray(users.id, ids));
  await Promise.allSettled(mentioned.map(async (user) => {
    const lookup = await connectorJson(req.currentOrg!.id, "slack", `/api/users.lookupByEmail?email=${encodeURIComponent(user.email)}`);
    const slackId = String(((lookup.user as Record<string, unknown> | undefined)?.id) ?? "");
    if (!slackId) throw new Error("Slack user not found");
    const opened = await connectorJson(req.currentOrg!.id, "slack", "/api/conversations.open", { method: "POST", body: { users: slackId } });
    const channel = String(((opened.channel as Record<string, unknown> | undefined)?.id) ?? "");
    await connectorJson(req.currentOrg!.id, "slack", "/api/chat.postMessage", { method: "POST", body: { channel, text: `${req.currentUser!.fullName ?? req.currentUser!.email} mentioned you in an Aegis Horizon note:\n${body}` } });
  })).then((results) => {
    results.filter((r) => r.status === "rejected").forEach((r) => req.log.warn({ err: r.reason }, "Slack mention notification failed"));
  });
}

router.get("/orgs/:orgId/accounts/:accountId/notes", ...gate, async (req, res): Promise<void> => {
  const orgId = req.currentOrg!.id;
  const rows = await db.select().from(internalNotes).where(and(
    eq(internalNotes.orgId, orgId), eq(internalNotes.accountId, req.params.accountId as string),
    eq(internalNotes.isDeleted, false), or(eq(internalNotes.isPrivate, false), eq(internalNotes.authorUserId, req.currentUser!.id)),
  )).orderBy(desc(internalNotes.createdAt));
  res.json(rows);
});
router.post("/orgs/:orgId/accounts/:accountId/notes", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateInternalNoteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const orgId = req.currentOrg!.id;
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, req.params.accountId as string), eq(accounts.orgId, orgId), eq(accounts.isActive, true)));
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  const mentions = parsed.data.mentionedUserIds ?? [];
  if (!(await validateMentions(orgId, mentions))) { res.status(400).json({ error: "All mentions must be organization members" }); return; }
  const [note] = await db.insert(internalNotes).values({ orgId, accountId: account.id, authorUserId: req.currentUser!.id, ...parsed.data, mentionedUserIds: mentions }).returning();
  await db.insert(activities).values({ orgId, accountId: account.id, type: "note", body: note.body, createdByUserId: req.currentUser!.id });
  void notifyMentions(req, mentions, note.body).catch((error) => req.log.warn({ err: error }, "Slack mention notification failed"));
  res.status(201).json(note);
});

async function editableNote(req: Request) {
  const [note] = await db.select().from(internalNotes).where(and(
    eq(internalNotes.id, req.params.noteId as string),
    eq(internalNotes.orgId, req.currentOrg!.id),
    eq(internalNotes.accountId, req.params.accountId as string),
    eq(internalNotes.isDeleted, false),
  ));
  const privileged = ["owner", "admin"].includes(req.currentMembership!.role);
  return note && (note.authorUserId === req.currentUser!.id || privileged) ? note : undefined;
}
router.patch("/orgs/:orgId/accounts/:accountId/notes/:noteId", ...gate, async (req, res): Promise<void> => {
  const parsed = UpdateInternalNoteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const note = await editableNote(req);
  if (!note) { res.status(404).json({ error: "Note not found or not editable" }); return; }
  const mentions = parsed.data.mentionedUserIds;
  if (mentions && !(await validateMentions(req.currentOrg!.id, mentions))) { res.status(400).json({ error: "All mentions must be organization members" }); return; }
  const [updated] = await db.update(internalNotes).set(parsed.data).where(eq(internalNotes.id, note.id)).returning();
  if (mentions) void notifyMentions(req, mentions, updated.body).catch((error) => req.log.warn({ err: error }, "Slack mention notification failed"));
  res.json(updated);
});
router.delete("/orgs/:orgId/accounts/:accountId/notes/:noteId", ...gate, async (req, res): Promise<void> => {
  const note = await editableNote(req);
  if (!note) { res.status(404).json({ error: "Note not found or not editable" }); return; }
  await db.update(internalNotes).set({ isDeleted: true }).where(eq(internalNotes.id, note.id));
  res.status(204).end();
});

router.post("/orgs/:orgId/emails/send", ...gate, async (req, res): Promise<void> => {
  const parsed = SendCrmEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const orgId = req.currentOrg!.id;
  const [account] = await db.select().from(accounts).where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.orgId, orgId)));
  if (!account) { res.status(400).json({ error: "accountId must belong to this organization" }); return; }
  if (parsed.data.contactId) {
    const [contact] = await db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.id, parsed.data.contactId), eq(contacts.orgId, orgId), eq(contacts.accountId, account.id),
    ));
    if (!contact) { res.status(400).json({ error: "contactId must belong to this account" }); return; }
  }
  let threadId = parsed.data.threadId;
  if (threadId) {
    const [thread] = await db.select().from(emailThreads).where(and(eq(emailThreads.id, threadId), eq(emailThreads.orgId, orgId), eq(emailThreads.accountId, account.id)));
    if (!thread) { res.status(400).json({ error: "threadId must belong to this account" }); return; }
  }
  const sent = await sendEmail(parsed.data);
  if (!threadId) {
    const [thread] = await db.insert(emailThreads).values({
      orgId,
      accountId: account.id,
      contactId: parsed.data.contactId,
      provider: "resend",
      externalThreadId: sent.id,
      subject: parsed.data.subject,
      snippet: parsed.data.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
      participants: [parsed.data.to],
      lastMessageAt: new Date(),
    }).returning();
    threadId = thread.id;
  }
  await db.insert(emailMessages).values({
    orgId,
    threadId,
    provider: "resend",
    externalMessageId: sent.id,
    recipients: [parsed.data.to],
    subject: parsed.data.subject,
    bodyText: parsed.data.html,
    direction: "outbound",
    sentAt: new Date(),
  });
  const [activity] = await db.insert(activities).values({
    orgId, accountId: account.id, contactId: parsed.data.contactId, threadId,
    type: "email", direction: "outbound", subject: parsed.data.subject, body: parsed.data.html,
    externalMessageId: `mail:resend:${sent.id}`, participants: [parsed.data.to], createdByUserId: req.currentUser!.id,
  }).returning();
  res.status(201).json({ id: sent.id, activityId: activity.id, threadId: activity.threadId });
});

function callConfig(res: Response) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const assembly = process.env.ASSEMBLYAI_API_KEY;
  if (!accountSid || !authToken || !from || !assembly) {
    res.status(503).json({ error: "Calls are not configured. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and ASSEMBLYAI_API_KEY are required." });
    return null;
  }
  return { accountSid, authToken, from, assembly };
}
router.post("/orgs/:orgId/accounts/:accountId/calls", ...gate, async (req, res): Promise<void> => {
  const config = callConfig(res); if (!config) return;
  const parsed = InitiateCrmCallBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  if (parsed.data.accountId !== req.params.accountId) { res.status(400).json({ error: "Body accountId must match path accountId" }); return; }
  const orgId = req.currentOrg!.id;
  const [account] = await db.select().from(accounts).where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.orgId, orgId)));
  if (!account) { res.status(400).json({ error: "accountId must belong to this organization" }); return; }
  if (parsed.data.contactId) {
    const [contact] = await db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.id, parsed.data.contactId), eq(contacts.orgId, orgId), eq(contacts.accountId, account.id),
    ));
    if (!contact) { res.status(400).json({ error: "contactId must belong to this account" }); return; }
  }
  const token = randomBytes(32).toString("hex");
  const base = externalBase(req);
  const callback = `${base}/api/calls/webhook?correlation=${token}`;
  const form = new URLSearchParams({ To: parsed.data.to, From: config.from, Url: `${base}/api/calls/twiml`, Record: "true", RecordingStatusCallback: callback });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: form,
  });
  if (!response.ok) { res.status(502).json({ error: `Twilio returned ${response.status}` }); return; }
  const twilio = await response.json() as { sid: string; status?: string };
  const [call] = await db.insert(callRecordings).values({
    orgId, accountId: account.id, contactId: parsed.data.contactId, initiatedByUserId: req.currentUser!.id,
    callSid: twilio.sid, status: twilio.status ?? "initiated", fromNumber: config.from, toNumber: parsed.data.to,
    correlationTokenHash: createHash("sha256").update(token).digest("hex"),
  }).returning();
  const [activity] = await db.insert(activities).values({
    orgId, accountId: account.id, contactId: parsed.data.contactId, callRecordingId: call.id,
    type: "call", direction: "outbound", subject: `Call to ${parsed.data.to}`,
    externalMessageId: `call:twilio:${call.callSid}`, createdByUserId: req.currentUser!.id,
  }).onConflictDoNothing().returning();
  res.status(201).json({ callId: call.id, callSid: call.callSid, activityId: activity?.id ?? null, status: call.status });
});
router.post("/calls/twiml", (_req, res) => res.type("text/xml").send("<Response><Say>This call is being recorded.</Say><Pause length=\"3600\" /></Response>"));

function validTwilioSignature(req: Request, authToken: string) {
  const supplied = req.get("x-twilio-signature");
  if (!supplied) return false;
  const url = `${externalBase(req)}${req.originalUrl}`;
  const fields = Object.entries(req.body as Record<string, string>).sort(([a], [b]) => a.localeCompare(b));
  const expected = createHmac("sha1", authToken).update(url + fields.map(([k, v]) => `${k}${v}`).join("")).digest("base64");
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
router.post("/calls/webhook", async (req, res): Promise<void> => {
  const config = callConfig(res); if (!config) return;
  if (!validTwilioSignature(req, config.authToken)) { res.status(403).json({ error: "Invalid Twilio signature" }); return; }
  const token = String(req.query.correlation ?? "");
  const [call] = await db.select().from(callRecordings).where(eq(callRecordings.correlationTokenHash, createHash("sha256").update(token).digest("hex")));
  if (!call || call.callSid !== String(req.body.CallSid ?? "")) { res.status(404).json({ error: "Unknown call correlation" }); return; }
  const [claimed] = await db.update(callRecordings).set({ status: "processing" }).where(and(
    eq(callRecordings.id, call.id), eq(callRecordings.orgId, call.orgId),
    or(eq(callRecordings.status, "initiated"), eq(callRecordings.status, "queued"), eq(callRecordings.status, "ringing"), eq(callRecordings.status, "in-progress"), eq(callRecordings.status, "completed")),
  )).returning();
  if (!claimed) { res.status(202).json({ accepted: true, duplicate: true }); return; }
  res.status(202).json({ accepted: true });
  void processRecording(req, claimed, config, String(req.body.RecordingUrl ?? ""), String(req.body.RecordingSid ?? ""));
});

async function processRecording(req: Request, call: typeof callRecordings.$inferSelect, config: NonNullable<ReturnType<typeof callConfig>>, recordingUrl: string, recordingSid: string) {
  try {
    const audioResponse = await fetch(`${recordingUrl}.mp3`, { headers: { authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}` } });
    if (!audioResponse.ok) throw new Error(`Recording download returned ${audioResponse.status}`);
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    const saved = await storage.savePrivateObject(audio, "audio/mpeg", "call-recordings");
    await setObjectAclPolicy(saved.file, { owner: "", visibility: "private", aclRules: [{ group: { type: ObjectAccessGroupType.ORG_MEMBER, id: call.orgId }, permission: ObjectPermission.READ }] });
    const upload = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST", headers: { authorization: config.assembly, "content-type": "application/octet-stream" }, body: audio,
    });
    if (!upload.ok) throw new Error(`AssemblyAI upload returned ${upload.status}`);
    const { upload_url: assemblyAudioUrl } = await upload.json() as { upload_url: string };
    const submit = await fetch("https://api.assemblyai.com/v2/transcript", { method: "POST", headers: { authorization: config.assembly, "content-type": "application/json" }, body: JSON.stringify({ audio_url: assemblyAudioUrl }) });
    if (!submit.ok) throw new Error(`AssemblyAI returned ${submit.status}`);
    const { id } = await submit.json() as { id: string };
    let transcript = "";
    for (let i = 0; i < 60; i += 1) {
      await sleep(3000);
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: { authorization: config.assembly } });
      const status = await poll.json() as { status: string; text?: string; error?: string };
      if (status.status === "completed") { transcript = status.text ?? ""; break; }
      if (status.status === "error") throw new Error(status.error ?? "AssemblyAI transcription failed");
    }
    if (!transcript) throw new Error("AssemblyAI transcription timed out");
    const analysis = (await aiEnabled(call.orgId)) ? await analyzeConversation(transcript) : null;
    await db.update(callRecordings).set({
      recordingSid, recordingObjectPath: saved.objectPath, transcript, status: "transcribed",
      summary: analysis?.summary, sentiment: analysis?.sentiment, keywords: analysis?.keywords,
      objections: analysis?.objections, leaning: analysis?.leaning,
    }).where(and(eq(callRecordings.id, call.id), eq(callRecordings.orgId, call.orgId)));
    await db.update(activities).set({ callRecordingUrl: saved.objectPath, callTranscript: transcript, body: analysis?.summary ?? transcript, sentiment: analysis?.sentiment, keywords: analysis?.keywords ?? [] })
      .where(and(eq(activities.orgId, call.orgId), eq(activities.callRecordingId, call.id)));
  } catch (error) {
    req.log.error({ err: error, callId: call.id }, "Call recording processing failed");
    await db.update(callRecordings).set({ status: "failed" }).where(and(eq(callRecordings.id, call.id), eq(callRecordings.orgId, call.orgId)));
  }
}

export default router;