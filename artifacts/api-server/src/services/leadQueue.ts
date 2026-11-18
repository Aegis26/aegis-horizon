import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, leads, accounts, contacts, orgUsers, users, auditEvents, activities, tasks, type Lead } from "@workspace/db";
import { appendAuditEvent } from "./audit";
import { websiteDomain } from "./inboundLeads";
import type { InboundLeadInput, LeadQueueAction, LeadQueueResult } from "@workspace/api-zod";

type QueueState = {
  queuedAt?: string; assignedAt?: string; existingAccountName?: string | null;
  dismissReason?: string; worked?: boolean;
};
export function leadQueueMetadata(lead: Lead) {
  const metadata = (lead.metadata ?? {}) as Record<string, unknown>;
  return {
    metadata,
    radar: metadata.leadRadar as (InboundLeadInput & {account_id?: string; contact_id?: string; note?: string}) | undefined,
    queue: (metadata.leadQueue ?? {}) as QueueState,
  };
}
export class QueueError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const queueManagement = (role: string) => ["owner", "admin", "manager"].includes(role);

async function membersFor(orgId: string, tx: Pick<Tx, "select"> = db) {
  return tx.select({ id: users.id, displayName: orgUsers.displayName, fullName: users.fullName, email: users.email })
    .from(orgUsers).innerJoin(users, eq(users.id, orgUsers.userId)).where(eq(orgUsers.orgId, orgId));
}
const memberName = (m: {displayName: string | null; fullName: string | null; email: string}) =>
  m.displayName?.trim() || m.fullName?.trim() || m.email;

// The lead row is locked by the caller. Activities/tasks against its linked
// entities conservatively make it ineligible, even if another rep did the work.
async function unworked(tx: Pick<Tx, "select">, lead: Lead) {
  const { radar, queue } = leadQueueMetadata(lead);
  if (lead.status !== "working" || !lead.assignedToUserId || !queue.assignedAt || queue.worked || lead.convertedOpportunityId) return false;
  const since = new Date(queue.assignedAt);
  if (!Number.isFinite(since.getTime())) return false;
  const [events, accountWork, accountTasks] = await Promise.all([
    tx.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.orgId, lead.orgId), eq(auditEvents.entityType, "lead"), eq(auditEvents.entityId, lead.id),
      sql`${auditEvents.createdAt} >= ${since}`,
      sql`${auditEvents.action} NOT LIKE 'lead.queue.%'`,
    )).limit(1),
    radar?.account_id ? tx.select({ id: activities.id }).from(activities).where(and(
      eq(activities.orgId, lead.orgId), eq(activities.accountId, radar.account_id), sql`${activities.createdAt} >= ${since}`,
    )).limit(1) : [],
    radar?.account_id ? tx.select({ id: tasks.id }).from(tasks).where(and(
      eq(tasks.orgId, lead.orgId), eq(tasks.accountId, radar.account_id), sql`${tasks.createdAt} >= ${since}`,
    )).limit(1) : [],
  ]);
  return !events.length && !accountWork.length && !accountTasks.length;
}

export async function listQueue(orgId: string, role: string, status: string): Promise<LeadQueueResult> {
  const manage = queueManagement(role);
  if (status === "assigned" && !manage) throw new QueueError(403, "Only management may view assigned queue leads");
  const rows = await db.select().from(leads).where(and(
    eq(leads.orgId, orgId), eq(leads.isActive, true),
    sql`${leads.metadata}->'leadQueue' IS NOT NULL`,
  )).orderBy(desc(leads.score), desc(leads.createdAt), leads.id);
  const members = await membersFor(orgId);
  const names = new Map(members.map(m => [m.id, memberName(m)]));
  const orgAccounts = await db.select({name: accounts.name, website: accounts.website}).from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.isActive, true))).orderBy(accounts.createdAt, accounts.id);
  const selected = rows.filter(l => status === "assigned" ? !!l.assignedToUserId : l.status === status && !l.assignedToUserId);
  const events = selected.length ? await db.select().from(auditEvents).where(and(
    eq(auditEvents.orgId, orgId), eq(auditEvents.entityType, "lead"), sql`${auditEvents.action} LIKE 'lead.queue.%'`,
    sql`${auditEvents.entityId} IN (${sql.join(selected.map(l => sql`${l.id}`), sql`,`)})`,
  )).orderBy(desc(auditEvents.createdAt)) : [];
  return {
    totalQueued: rows.filter(l => l.status === "queued" && !l.assignedToUserId).length,
    canManage: manage,
    members: manage ? members.map(m => ({id: m.id, name: memberName(m)})) : [],
    items: await Promise.all(selected.map(async l => {
      const {radar, queue} = leadQueueMetadata(l);
      const domain = websiteDomain(radar?.website);
      const existing = domain ? orgAccounts.find(a => websiteDomain(a.website) === domain) : undefined;
      return {
        id: l.id, company: l.company ?? radar?.company_name ?? "", score: l.score, status: l.status,
        queuedAt: queue.queuedAt ?? l.createdAt.toISOString(),
        assignedToName: l.assignedToUserId ? names.get(l.assignedToUserId) ?? "Former member" : null,
        existingAccountName: existing?.name ?? null,
        dismissReason: queue.dismissReason ?? null,
        canReturn: manage && await unworked(db, l),
        radar: radar!,
        activities: events.filter(e => e.entityId === l.id).map(e => ({
          id: e.id, action: e.action.replace("lead.queue.", ""), at: e.createdAt.toISOString(),
          actor: e.actorUserId ? names.get(e.actorUserId) ?? "Former member" : "System",
          reason: (e.metadata as {reason?: string}).reason ?? null,
        })),
      };
    })),
  };
}

async function linkEntities(tx: Tx, lead: Lead, assigneeId: string) {
  const {radar} = leadQueueMetadata(lead);
  if (!radar) throw new QueueError(409, "Lead Radar details are missing");
  const domain = websiteDomain(radar.website);
  const candidates = await tx.select().from(accounts).where(and(eq(accounts.orgId, lead.orgId), eq(accounts.isActive, true)))
    .orderBy(accounts.createdAt, accounts.id);
  // Never change ownership of a matched client account.
  let account = (domain ? candidates.find(a => websiteDomain(a.website) === domain) : undefined)
    ?? candidates.find(a => a.name === radar.company_name);
  let queueOwnedAccount = false;
  if (!account) {
    [account] = await tx.insert(accounts).values({
      orgId: lead.orgId, name: radar.company_name, website: radar.website,
      city: radar.city, state: radar.state, industry: radar.industry,
      employeeCount: radar.employee_estimate, ownerUserId: assigneeId, createdByUserId: assigneeId,
      metadata: {leadRadar: radar, leadQueueProvisionedFor: lead.id},
    }).returning();
    queueOwnedAccount = true;
  } else {
    const marker = (account.metadata as {leadQueueProvisionedFor?: string} | null)?.leadQueueProvisionedFor;
    // Before the queue existed, intake created unassigned entities in the same
    // transaction as its lead (identical database now() timestamps). Only this
    // provenance + exact stored link is eligible; never infer it from a domain.
    const legacyProvisioned = radar.account_id === account.id &&
      !account.ownerUserId && !account.createdByUserId &&
      !!(await tx.select({id:accounts.id}).from(accounts).where(and(
        eq(accounts.id,account.id),eq(accounts.orgId,lead.orgId),
        sql`${accounts.createdAt} = (SELECT created_at FROM leads WHERE id = ${lead.id} AND org_id = ${lead.orgId})`,
      )).limit(1)).length;
    queueOwnedAccount = marker === lead.id || legacyProvisioned;
    if (queueOwnedAccount) {
      [account] = await tx.update(accounts).set({
        ownerUserId: assigneeId,
        metadata: sql`COALESCE(${accounts.metadata}, '{}'::jsonb) || ${JSON.stringify({leadQueueProvisionedFor:lead.id})}::jsonb`,
      }).where(and(eq(accounts.orgId, lead.orgId), eq(accounts.id, account.id))).returning();
    }
  }
  let contactId: string | null = null;
  if (radar.contact_name || radar.contact_email || radar.contact_phone) {
    const [firstName, ...rest] = (radar.contact_name?.trim() || radar.company_name).split(/\s+/);
    const lastName = rest.join(" ");
    const contactRows = await tx.select().from(contacts).where(and(
      eq(contacts.orgId, lead.orgId), eq(contacts.accountId, account.id), eq(contacts.isActive, true),
    ));
    const matched = contactRows.find(c => radar.contact_email ? c.email?.toLowerCase() === radar.contact_email.toLowerCase()
      : radar.contact_phone ? c.phone === radar.contact_phone : c.firstName === firstName && c.lastName === lastName);
    if (matched) {
      contactId = matched.id;
      const marker = (matched.metadata as {leadQueueProvisionedFor?: string} | null)?.leadQueueProvisionedFor;
      const legacyProvisioned = queueOwnedAccount && radar.contact_id === matched.id &&
        !matched.ownerUserId && !matched.createdByUserId &&
        !!(await tx.select({id:contacts.id}).from(contacts).where(and(
          eq(contacts.id,matched.id),eq(contacts.orgId,lead.orgId),
          sql`${contacts.createdAt} = (SELECT created_at FROM leads WHERE id = ${lead.id} AND org_id = ${lead.orgId})`,
        )).limit(1)).length;
      if (marker === lead.id || legacyProvisioned) {
        await tx.update(contacts).set({
          ownerUserId: assigneeId,
          metadata: sql`COALESCE(${contacts.metadata}, '{}'::jsonb) || ${JSON.stringify({leadQueueProvisionedFor:lead.id})}::jsonb`,
        }).where(and(eq(contacts.orgId,lead.orgId),eq(contacts.id,matched.id)));
      }
    }
    else {
      const [contact] = await tx.insert(contacts).values({
        orgId: lead.orgId, accountId: account.id, firstName, lastName, email: radar.contact_email,
        phone: radar.contact_phone, ownerUserId: assigneeId, createdByUserId: assigneeId,
        metadata: {leadRadar: radar, leadQueueProvisionedFor:lead.id},
      }).returning();
      contactId = contact.id;
    }
  }
  return {...radar, account_id: account.id, contact_id: contactId};
}

export async function actOnQueue(orgId: string, actorId: string, role: string, leadId: string, input: LeadQueueAction) {
  const manage = queueManagement(role);
  if (["assign", "return"].includes(input.action) && !manage) throw new QueueError(403, "Only management may assign others or return leads");
  if (input.action === "dismiss" && !["not a fit", "duplicate", "existing client"].includes(input.reason ?? "")) throw new QueueError(400, "Select a dismissal reason");
  if (input.action === "assign" && !input.assigneeId) throw new QueueError(400, "Select an assignee");
  return db.transaction(async tx => {
    // Same lock as intake: one tenant's concurrent claims cannot duplicate accounts.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`inbound-leads:${orgId}`}, 0))`);
    const members = await membersFor(orgId, tx);
    if (!members.some(m => m.id === actorId)) throw new QueueError(403, "Not a member of this organization");
    const target = input.action === "assign" ? input.assigneeId! : actorId;
    if (!members.some(m => m.id === target)) throw new QueueError(400, "Assignee must be a member of this organization");
    const [lead] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, leadId), eq(leads.isActive, true))).for("update");
    if (!lead || !leadQueueMetadata(lead).radar || !(lead.metadata as Record<string,unknown>)?.leadQueue) throw new QueueError(404, "Queued lead not found");
    const {metadata, queue} = leadQueueMetadata(lead);
    if (input.action === "return") {
      const accountId = leadQueueMetadata(lead).radar?.account_id;
      if (accountId) {
        // Activity/task inserts take a FK key-share lock on this parent.
        // Waiting here makes earlier work visible before eligibility is tested.
        await tx.select({id: accounts.id}).from(accounts).where(and(
          eq(accounts.orgId, orgId), eq(accounts.id, accountId),
        )).for("update");
      }
      if (!(await unworked(tx, lead))) throw new QueueError(409, "This lead has already been worked and cannot return to queue");
    } else if (lead.assignedToUserId || lead.status !== "queued") {
      const member = members.find(m => m.id === lead.assignedToUserId);
      throw new QueueError(409, lead.assignedToUserId ? `Already claimed by ${member ? memberName(member) : "a former member"}` : "This lead is no longer queued");
    }
    const now = new Date().toISOString();
    const assigning = input.action === "claim" || input.action === "assign";
    const radar = assigning ? await linkEntities(tx, lead, target) : leadQueueMetadata(lead).radar;
    const status = assigning ? "working" : input.action === "dismiss" ? "dismissed" : "queued";
    const [updated] = await tx.update(leads).set({
      status, assignedToUserId: assigning ? target : null,
      metadata: {...metadata, leadRadar: radar, leadQueue: {
        ...queue, ...(assigning ? {assignedAt: now, worked: false} : {}),
        ...(input.action === "return" ? {queuedAt: now, assignedAt: undefined} : {}),
        ...(input.action === "dismiss" ? {dismissReason: input.reason} : {}),
      }},
    }).where(and(eq(leads.orgId, orgId), eq(leads.id, lead.id),
      ...(input.action !== "return" ? [isNull(leads.assignedToUserId), eq(leads.status, "queued")] : []),
    )).returning();
    if (!updated) throw new QueueError(409, "This lead is no longer queued");
    await appendAuditEvent({
      orgId, actorUserId: actorId, entityType: "lead", entityId: lead.id, action: `lead.queue.${input.action}`,
      metadata: {assigneeId: assigning ? target : null, reason: input.reason ?? null},
    }, tx);
    return {leadId: lead.id, status};
  });
}
