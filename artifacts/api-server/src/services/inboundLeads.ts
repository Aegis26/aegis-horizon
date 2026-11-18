import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, accounts, leads, inboundLeadLog } from "@workspace/db";
import { IngestInboundLeadBody } from "@workspace/api-zod";
import { z } from "zod";

const httpUrl = z.string().max(2000).url().refine((s) => {
  const u = new URL(s);
  return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password;
}, "Must be an HTTP or HTTPS URL without credentials");
const nonempty = (max: number) => z.string().trim().min(1).max(max);
export const inboundLeadInput = IngestInboundLeadBody.extend({
  external_id: nonempty(200),
  company_name: nonempty(300),
  source: nonempty(200),
  signal_summary: nonempty(4000),
  website: httpUrl.optional(),
  source_url: httpUrl.optional(),
  score: z.number().int().min(1).max(10),
  employee_estimate: z.number().int().min(0).max(2147483647).optional(),
  detected_at: z.string().datetime({ offset: true }),
  talking_points: z.array(nonempty(1000)).max(30).default([]),
}).strict();

// The ingestion service consumes a principal, not an environment variable.
// A future hashed-key registry can replace only this resolver.
export type InboundPrincipal = { orgId: string; keyId: string };
export function resolveInboundPrincipal(key: string | undefined): InboundPrincipal | null {
  const expected = process.env.INBOUND_LEADS_API_KEY;
  if (!expected) return null;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const matches = timingSafeEqual(digest(key ?? ""), digest(expected));
  if (!key || !matches) return null;
  const orgId = process.env.INBOUND_LEADS_ORG_ID;
  if (!orgId || !z.string().uuid().safeParse(orgId).success) throw new Error("Intake not configured");
  // Stable identifier, never a credential or credential digest in logs.
  return { orgId, keyId: "lead-radar-env-v1" };
}

export function websiteDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return null; }
}

export async function ingestLead(
  principal: InboundPrincipal,
  input: z.infer<typeof inboundLeadInput>,
  logId: string,
) {
  const orgId = principal.orgId;
  return db.transaction(async (tx) => {
    // Serialize intake per tenant: protects idempotency AND account/contact
    // matching across concurrent API replicas, not just this Node process.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`inbound-leads:${orgId}`}, 0))`);
    const [existing] = await tx.select().from(leads).where(and(
      eq(leads.orgId, orgId),
      sql`${leads.metadata}->'leadRadar'->>'external_id' = ${input.external_id}`,
    )).for("update");
    if (existing) {
      const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
      const radar = (metadata.leadRadar ?? {}) as Record<string, unknown>;
      await tx.update(leads).set({
        score: input.score,
        metadata: { ...metadata, leadRadar: {
          ...radar, score: input.score, signal_summary: input.signal_summary,
          talking_points: input.talking_points,
        } },
      }).where(and(eq(leads.id, existing.id), eq(leads.orgId, orgId)));
      await tx.update(inboundLeadLog).set({ result: "updated" }).where(eq(inboundLeadLog.id, logId));
      return { status: "updated" as const, lead_id: existing.id };
    }
    const orgAccounts = await tx.select().from(accounts).where(and(
      eq(accounts.orgId, orgId), eq(accounts.isActive, true),
    )).orderBy(accounts.createdAt, accounts.id);
    const domain = websiteDomain(input.website);
    const account = domain ? orgAccounts.find((a) => websiteDomain(a.website) === domain) : undefined;
    const [firstName, ...rest] = (input.contact_name?.trim() || input.company_name).split(/\s+/);
    const lastName = rest.join(" ");
    const note = `Created by Lead Radar from ${input.source}\n${input.signal_summary}`;
    const [lead] = await tx.insert(leads).values({
      orgId, firstName, lastName, company: input.company_name,
      email: input.contact_email, phone: input.contact_phone,
      industry: input.industry, companySize: input.employee_estimate, state: input.state,
      source: "Lead Radar", score: input.score,
      // Leads use new/working/qualified, not the opportunity pipeline stages.
      status: "queued", assignedToUserId: null, createdByUserId: null,
      metadata: {
        leadQueue: { queuedAt: new Date().toISOString(), existingAccountName: account?.name ?? null },
        leadRadar: { ...input, note },
      },
    }).returning();
    await tx.update(inboundLeadLog).set({ result: "created" }).where(eq(inboundLeadLog.id, logId));
    return { status: "created" as const, lead_id: lead.id };
  });
}
