import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  opportunityStageHistory,
  pipelines,
  leads,
  leadScoringRules,
  territories,
  quotes,
  users,
  orgUsers,
  type Opportunity,
  type Pipeline,
  type Lead,
  type LeadScoringRule,
  type Territory,
  type Quote,
} from "@workspace/db";
import {
  ListOpportunitiesResponse,
  CreateOpportunityBody,
  CreateOpportunityResponse,
  GetOpportunityResponse,
  UpdateOpportunityBody,
  UpdateOpportunityResponse,
  ConvertOpportunityToCustomerResponse,
  ListPipelinesResponse,
  CreatePipelineBody,
  CreatePipelineResponse,
  UpdatePipelineResponse,
  ListLeadsResponse,
  CreateLeadBody,
  CreateLeadResponse,
  UpdateLeadBody,
  UpdateLeadResponse,
  QualifyLeadBody,
  QualifyLeadResponse,
  RescoreLeadsResponse,
  ListLeadScoringRulesResponse,
  CreateLeadScoringRuleBody,
  CreateLeadScoringRuleResponse,
  UpdateLeadScoringRuleResponse,
  ListQuotesResponse,
  CreateQuoteBody,
  CreateQuoteResponse,
  GetQuoteResponse,
  UpdateQuoteBody,
  UpdateQuoteResponse,
  SendQuoteBody,
  SendQuoteResponse,
  AcceptQuoteResponse,
  ListTerritoriesResponse,
  CreateTerritoryBody,
  CreateTerritoryResponse,
  UpdateTerritoryResponse,
  GetTerritoryCoverageResponse,
  GetForecastResponse,
} from "@workspace/api-zod";
import { attachUser, attachOrg, requireFeature } from "../middlewares/auth";
import { scoreAndRouteLead, scoreLead } from "../services/leadScoring";
import {
  quoteTotals,
  renderQuotePdf,
  type QuoteLineItem,
} from "../services/quotePdf";
import { sendEmail } from "../lib/email";
import { processNewLead } from "../services/agents";
import { publishAutomationEvent } from "../services/workflow";
import { isOrgMemberId, isOrgTerritoryId } from "../services/orgValidation";

const router: IRouter = Router();
const gate = [attachUser, attachOrg, requireFeature("sales")] as const;

/** True when the user is a member of the org (tenant-isolation guard). */
async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  return isOrgMemberId(orgId, userId);
}

/** True when the territory belongs to the org. */
async function isOrgTerritory(orgId: string, territoryId: string): Promise<boolean> {
  return isOrgTerritoryId(orgId, territoryId);
}

/* ------------------------------ pipelines ------------------------------ */

export type PipelineStage = {
  key: string;
  name: string;
  probability: number;
  forecastCategory:
    | "pipeline"
    | "best_case"
    | "committed"
    | "closed_won"
    | "closed_lost";
  order: number;
};

const DEFAULT_STAGES: PipelineStage[] = [
  { key: "prospecting", name: "Prospecting", probability: 10, forecastCategory: "pipeline", order: 0 },
  { key: "qualified", name: "Qualified", probability: 25, forecastCategory: "pipeline", order: 1 },
  { key: "proposal", name: "Proposal", probability: 50, forecastCategory: "best_case", order: 2 },
  { key: "negotiation", name: "Negotiation", probability: 75, forecastCategory: "committed", order: 3 },
  { key: "closed_won", name: "Closed Won", probability: 100, forecastCategory: "closed_won", order: 4 },
  { key: "closed_lost", name: "Closed Lost", probability: 0, forecastCategory: "closed_lost", order: 5 },
];

async function ensureDefaultPipeline(orgId: string): Promise<Pipeline[]> {
  const rows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, orgId))
    .orderBy(desc(pipelines.isDefault), pipelines.createdAt);
  if (rows.length > 0) return rows;
  const [created] = await db
    .insert(pipelines)
    .values({
      orgId,
      name: "Sales Pipeline",
      isDefault: true,
      stages: DEFAULT_STAGES,
    })
    .returning();
  return [created];
}

function pipelineOut(p: Pipeline) {
  return {
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: (p.stages ?? []) as PipelineStage[],
    createdAt: p.createdAt.toISOString(),
  };
}

function stagesOf(p: Pipeline | undefined): PipelineStage[] {
  return ((p?.stages ?? []) as PipelineStage[])
    .slice()
    .sort((a, b) => a.order - b.order);
}

router.get("/orgs/:orgId/pipelines", ...gate, async (req, res): Promise<void> => {
  const rows = await ensureDefaultPipeline(req.currentOrg!.id);
  res.json(ListPipelinesResponse.parse(rows.map(pipelineOut)));
});

router.post("/orgs/:orgId/pipelines", ...gate, async (req, res): Promise<void> => {
  const parsed = CreatePipelineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const [row] = await db
    .insert(pipelines)
    .values({
      orgId: req.currentOrg!.id,
      name: parsed.data.name,
      stages: parsed.data.stages,
    })
    .returning();
  res.status(201).json(CreatePipelineResponse.parse(pipelineOut(row)));
});

router.patch(
  "/orgs/:orgId/pipelines/:pipelineId",
  ...gate,
  async (req, res): Promise<void> => {
    const parsed = CreatePipelineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(pipelines)
      .where(
        and(
          eq(pipelines.id, req.params.pipelineId as string),
          eq(pipelines.orgId, req.currentOrg!.id),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Pipeline not found" });
      return;
    }
    const [row] = await db
      .update(pipelines)
      .set({ name: parsed.data.name, stages: parsed.data.stages })
      .where(eq(pipelines.id, existing.id))
      .returning();
    res.json(UpdatePipelineResponse.parse(pipelineOut(row)));
  },
);

/* ---------------------------- opportunities ---------------------------- */

function opportunitySummary(o: Opportunity) {
  return {
    id: o.id,
    accountId: o.accountId,
    name: o.name,
    stage: o.stage,
    probability: o.probability,
    value: o.value,
    expectedCloseDate: o.expectedCloseDate,
    forecastCategory: o.forecastCategory,
    createdAt: o.createdAt.toISOString(),
  };
}

async function opportunityDetail(o: Opportunity) {
  const [[account], [owner], history] = await Promise.all([
    db
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, o.accountId)),
    o.ownerUserId
      ? db
          .select({ fullName: users.fullName, email: users.email })
          .from(users)
          .where(eq(users.id, o.ownerUserId))
      : Promise.resolve([undefined]),
    db
      .select({
        entry: opportunityStageHistory,
        userName: users.fullName,
        userEmail: users.email,
      })
      .from(opportunityStageHistory)
      .leftJoin(users, eq(opportunityStageHistory.changedByUserId, users.id))
      .where(eq(opportunityStageHistory.opportunityId, o.id))
      .orderBy(desc(opportunityStageHistory.createdAt)),
  ]);
  return {
    id: o.id,
    accountId: o.accountId,
    accountName: account?.name ?? null,
    name: o.name,
    pipelineId: o.pipelineId,
    stage: o.stage,
    probability: o.probability,
    value: o.value,
    expectedCloseDate: o.expectedCloseDate,
    actualCloseDate: o.actualCloseDate,
    forecastCategory: o.forecastCategory,
    lossReason: o.lossReason,
    nextAction: o.nextAction,
    ownerUserId: o.ownerUserId,
    ownerName: owner ? (owner.fullName ?? owner.email) : null,
    stageHistory: history.map((h) => ({
      id: h.entry.id,
      fromStage: h.entry.fromStage,
      toStage: h.entry.toStage,
      changedByName: h.userName ?? h.userEmail ?? null,
      createdAt: h.entry.createdAt.toISOString(),
    })),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

async function findOpportunity(req: Request): Promise<Opportunity | undefined> {
  const [row] = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, req.params.opportunityId as string),
        eq(opportunities.orgId, req.currentOrg!.id),
      ),
    );
  return row;
}

async function orgPipeline(
  orgId: string,
  pipelineId?: string | null,
): Promise<Pipeline | undefined> {
  const rows = await ensureDefaultPipeline(orgId);
  if (pipelineId) return rows.find((p) => p.id === pipelineId);
  return rows.find((p) => p.isDefault) ?? rows[0];
}

router.get("/orgs/:orgId/opportunities", ...gate, async (req, res): Promise<void> => {
  const { pipelineId, stage } = req.query as { pipelineId?: string; stage?: string };
  const where = [eq(opportunities.orgId, req.currentOrg!.id)];
  if (pipelineId) where.push(eq(opportunities.pipelineId, pipelineId));
  if (stage) where.push(eq(opportunities.stage, stage));
  const rows = await db
    .select()
    .from(opportunities)
    .where(and(...where))
    .orderBy(desc(opportunities.createdAt));
  res.json(ListOpportunitiesResponse.parse(rows.map(opportunitySummary)));
});

router.post("/orgs/:orgId/opportunities", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const orgId = req.currentOrg!.id;
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.orgId, orgId)));
  if (!account) {
    res.status(400).json({ error: "accountId must reference an account in this organization" });
    return;
  }
  const pipeline = await orgPipeline(orgId, parsed.data.pipelineId);
  if (!pipeline) {
    res.status(400).json({ error: "pipelineId must reference a pipeline in this organization" });
    return;
  }
  const stages = stagesOf(pipeline);
  const stageKey = parsed.data.stage ?? stages[0]?.key ?? "prospecting";
  const stageDef = stages.find((s) => s.key === stageKey);
  if (parsed.data.stage && !stageDef) {
    res.status(400).json({ error: "stage is not part of the selected pipeline" });
    return;
  }
  const [row] = await db
    .insert(opportunities)
    .values({
      orgId,
      accountId: parsed.data.accountId,
      name: parsed.data.name,
      pipelineId: pipeline.id,
      stage: stageKey,
      probability: parsed.data.probability ?? stageDef?.probability ?? 0,
      value: parsed.data.value,
      expectedCloseDate: parsed.data.expectedCloseDate,
      nextAction: parsed.data.nextAction,
      forecastCategory: stageDef?.forecastCategory ?? "pipeline",
      ownerUserId: req.currentUser!.id,
    })
    .returning();
  await db.insert(opportunityStageHistory).values({
    orgId,
    opportunityId: row.id,
    fromStage: null,
    toStage: stageKey,
    changedByUserId: req.currentUser!.id,
  });
  await publishAutomationEvent({
    orgId,
    eventKey: `opportunity-created:${row.id}`,
    eventType: "record_created",
    entityType: "opportunity",
    entityId: row.id,
    payload: { stage: row.stage },
    actorUserId: req.currentUser!.id,
  });
  res.status(201).json(CreateOpportunityResponse.parse(await opportunityDetail(row)));
});

router.get(
  "/orgs/:orgId/opportunities/:opportunityId",
  ...gate,
  async (req, res): Promise<void> => {
    const opp = await findOpportunity(req);
    if (!opp) {
      res.status(404).json({ error: "Opportunity not found" });
      return;
    }
    res.json(GetOpportunityResponse.parse(await opportunityDetail(opp)));
  },
);

router.patch(
  "/orgs/:orgId/opportunities/:opportunityId",
  ...gate,
  async (req, res): Promise<void> => {
    const parsed = UpdateOpportunityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const opp = await findOpportunity(req);
    if (!opp) {
      res.status(404).json({ error: "Opportunity not found" });
      return;
    }
    const orgId = req.currentOrg!.id;
    const data = parsed.data;
    const updates: Partial<typeof opportunities.$inferInsert> = { ...data };

    const stageChanged = data.stage !== undefined && data.stage !== opp.stage;
    if (stageChanged) {
      const pipeline = await orgPipeline(orgId, data.pipelineId ?? opp.pipelineId);
      const stageDef = stagesOf(pipeline).find((s) => s.key === data.stage);
      if (!stageDef) {
        res.status(400).json({ error: "stage is not part of the opportunity's pipeline" });
        return;
      }
      // Suggested probability/forecast from the stage; the rep can override
      // by passing probability/forecastCategory explicitly.
      if (data.probability === undefined || data.probability === null) {
        updates.probability = stageDef.probability;
      }
      if (data.forecastCategory === undefined || data.forecastCategory === null) {
        updates.forecastCategory = stageDef.forecastCategory;
      }
      if (
        stageDef.forecastCategory === "closed_won" ||
        stageDef.forecastCategory === "closed_lost"
      ) {
        updates.actualCloseDate = new Date().toISOString().slice(0, 10);
      }
      updates.daysInStage = 0;
    }
    if (data.pipelineId && !(await orgPipeline(orgId, data.pipelineId))) {
      res.status(400).json({ error: "pipelineId must reference a pipeline in this organization" });
      return;
    }
    if (data.ownerUserId && !(await isOrgMember(orgId, data.ownerUserId))) {
      res.status(400).json({ error: "ownerUserId must reference a member of this organization" });
      return;
    }

    const [row] = await db
      .update(opportunities)
      .set(updates)
      .where(eq(opportunities.id, opp.id))
      .returning();

    if (stageChanged) {
      await db.insert(opportunityStageHistory).values({
        orgId,
        opportunityId: opp.id,
        fromStage: opp.stage,
        toStage: data.stage!,
        changedByUserId: req.currentUser!.id,
      });
      await publishAutomationEvent({
        orgId,
        eventKey: `opportunity-stage:${opp.id}:${row.stage}:${row.updatedAt.toISOString()}`,
        eventType: "field_change",
        entityType: "opportunity",
        entityId: opp.id,
        payload: { field: "stage", oldValue: opp.stage, newValue: row.stage },
        actorUserId: req.currentUser!.id,
      });
    }
    res.json(UpdateOpportunityResponse.parse(await opportunityDetail(row)));
  },
);

router.delete(
  "/orgs/:orgId/opportunities/:opportunityId",
  ...gate,
  async (req, res): Promise<void> => {
    const opp = await findOpportunity(req);
    if (!opp) {
      res.status(404).json({ error: "Opportunity not found" });
      return;
    }
    await db.delete(opportunities).where(eq(opportunities.id, opp.id));
    res.status(204).end();
  },
);

router.post(
  "/orgs/:orgId/opportunities/:opportunityId/convert-to-customer",
  ...gate,
  async (req, res): Promise<void> => {
    const opp = await findOpportunity(req);
    if (!opp) {
      res.status(404).json({ error: "Opportunity not found" });
      return;
    }
    const orgId = req.currentOrg!.id;
    const pipeline = await orgPipeline(orgId, opp.pipelineId);
    const wonStage =
      stagesOf(pipeline).find((s) => s.forecastCategory === "closed_won") ?? {
        key: "closed_won",
        probability: 100,
      };
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await db
      .update(opportunities)
      .set({
        stage: wonStage.key,
        probability: 100,
        forecastCategory: "closed_won",
        actualCloseDate: today,
      })
      .where(eq(opportunities.id, opp.id))
      .returning();
    if (opp.stage !== wonStage.key) {
      await db.insert(opportunityStageHistory).values({
        orgId,
        opportunityId: opp.id,
        fromStage: opp.stage,
        toStage: wonStage.key,
        changedByUserId: req.currentUser!.id,
      });
    }
    // Flag the account as a customer.
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, opp.accountId));
    if (account) {
      const metadata = {
        ...((account.metadata ?? {}) as Record<string, unknown>),
        customer: "true",
        customerSince:
          ((account.metadata ?? {}) as Record<string, unknown>).customerSince ??
          today,
      };
      await db.update(accounts).set({ metadata }).where(eq(accounts.id, account.id));
    }
    res.json(ConvertOpportunityToCustomerResponse.parse(await opportunityDetail(row)));
  },
);

/* -------------------------------- leads -------------------------------- */

async function leadOut(l: Lead) {
  const [assignee, territory] = await Promise.all([
    l.assignedToUserId
      ? db
          .select({ fullName: users.fullName, email: users.email })
          .from(users)
          .innerJoin(orgUsers, eq(orgUsers.userId, users.id))
          .where(and(eq(users.id, l.assignedToUserId), eq(orgUsers.orgId, l.orgId)))
          .then((r) => r[0])
      : Promise.resolve(undefined),
    l.territoryId
      ? db
          .select({ name: territories.name })
          .from(territories)
          .where(and(eq(territories.id, l.territoryId), eq(territories.orgId, l.orgId)))
          .then((r) => r[0])
      : Promise.resolve(undefined),
  ]);
  return {
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    email: l.email,
    phone: l.phone,
    company: l.company,
    title: l.title,
    industry: l.industry,
    companySize: l.companySize,
    annualRevenue: l.annualRevenue,
    intentScore: l.intentScore,
    country: l.country,
    state: l.state,
    productInterest: l.productInterest,
    source: l.source,
    status: l.status as "new" | "working" | "qualified" | "disqualified",
    score: l.score,
    assignedToUserId: l.assignedToUserId,
    assignedToName: assignee ? (assignee.fullName ?? assignee.email) : null,
    territoryId: l.territoryId,
    territoryName: territory?.name ?? null,
    convertedOpportunityId: l.convertedOpportunityId,
    createdAt: l.createdAt.toISOString(),
  };
}

router.get("/orgs/:orgId/leads", ...gate, async (req, res): Promise<void> => {
  const { status, q } = req.query as { status?: string; q?: string };
  const where = [eq(leads.orgId, req.currentOrg!.id), eq(leads.isActive, true)];
  if (status) where.push(eq(leads.status, status));
  if (q) {
    const like = `%${q}%`;
    where.push(
      or(
        ilike(leads.firstName, like),
        ilike(leads.lastName, like),
        ilike(leads.company, like),
        ilike(leads.email, like),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(leads)
    .where(and(...where))
    .orderBy(desc(leads.score), desc(leads.createdAt));
  res.json(ListLeadsResponse.parse(await Promise.all(rows.map(leadOut))));
});

router.post("/orgs/:orgId/leads", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const orgId = req.currentOrg!.id;
  if (
    parsed.data.assignedToUserId &&
    !(await isOrgMember(orgId, parsed.data.assignedToUserId))
  ) {
    res.status(400).json({ error: "assignedToUserId must reference a member of this organization" });
    return;
  }
  if (
    parsed.data.territoryId &&
    !(await isOrgTerritory(orgId, parsed.data.territoryId))
  ) {
    res.status(400).json({ error: "territoryId must reference a territory in this organization" });
    return;
  }
  const [inserted] = await db
    .insert(leads)
    .values({ ...parsed.data, orgId })
    .returning();
  // Auto-score + auto-route to the matching territory owner.
  const row = await scoreAndRouteLead(orgId, inserted, { reassign: true });
  await publishAutomationEvent({
    orgId,
    eventKey: `lead-created:${row.id}`,
    eventType: "record_created",
    entityType: "lead",
    entityId: row.id,
    payload: { status: row.status, score: row.score },
    actorUserId: req.currentUser!.id,
  });
  void processNewLead(orgId, row.id, req.currentUser!.id).catch((err) => {
    req.log.error({ err, leadId: row.id }, "Lead qualifier agent failed");
  });
  res.status(201).json(CreateLeadResponse.parse(await leadOut(row)));
});

async function findLead(req: Request): Promise<Lead | undefined> {
  const [row] = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.id, req.params.leadId as string),
        eq(leads.orgId, req.currentOrg!.id),
      ),
    );
  return row;
}

router.patch("/orgs/:orgId/leads/:leadId", ...gate, async (req, res): Promise<void> => {
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const lead = await findLead(req);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const orgId = req.currentOrg!.id;
  const { score: explicitScore, ...rest } = parsed.data;
  if (rest.assignedToUserId && !(await isOrgMember(orgId, rest.assignedToUserId))) {
    res.status(400).json({ error: "assignedToUserId must reference a member of this organization" });
    return;
  }
  if (rest.territoryId && !(await isOrgTerritory(orgId, rest.territoryId))) {
    res.status(400).json({ error: "territoryId must reference a territory in this organization" });
    return;
  }
  const [updated] = await db
    .update(leads)
    .set(explicitScore !== undefined && explicitScore !== null
      ? { ...rest, score: explicitScore }
      : rest)
    .where(eq(leads.id, lead.id))
    .returning();
  // Re-score (unless the rep pinned an explicit score). Re-route when the
  // lead is unassigned, or when routing fields changed without an explicit
  // manual assignment in this request.
  const routingFieldsChanged =
    rest.country !== undefined ||
    rest.state !== undefined ||
    rest.productInterest !== undefined;
  const manualAssignment =
    rest.assignedToUserId !== undefined || rest.territoryId !== undefined;
  const row = await scoreAndRouteLead(orgId, updated, {
    keepScore: explicitScore !== undefined && explicitScore !== null,
    reassign: routingFieldsChanged && !manualAssignment,
  });
  res.json(UpdateLeadResponse.parse(await leadOut(row)));
});

router.delete("/orgs/:orgId/leads/:leadId", ...gate, async (req, res): Promise<void> => {
  const lead = await findLead(req);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  await db.update(leads).set({ isActive: false }).where(eq(leads.id, lead.id));
  res.status(204).end();
});

router.post(
  "/orgs/:orgId/leads/:leadId/qualify",
  ...gate,
  async (req, res): Promise<void> => {
    const parsed = QualifyLeadBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const lead = await findLead(req);
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (lead.status === "qualified" && lead.convertedOpportunityId) {
      res.status(400).json({ error: "Lead has already been qualified" });
      return;
    }
    const orgId = req.currentOrg!.id;

    // Link to an explicit account, or find/create one by company name.
    let accountId = parsed.data.accountId ?? null;
    if (accountId) {
      const [acc] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.orgId, orgId)));
      if (!acc) {
        res.status(400).json({ error: "accountId must reference an account in this organization" });
        return;
      }
    } else {
      const companyName =
        lead.company ?? `${lead.firstName} ${lead.lastName}`.trim();
      const [existing] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.orgId, orgId),
            ilike(accounts.name, companyName),
            eq(accounts.isActive, true),
          ),
        );
      if (existing) {
        accountId = existing.id;
      } else {
        const [created] = await db
          .insert(accounts)
          .values({
            orgId,
            name: companyName,
            industry: lead.industry,
            employeeCount: lead.companySize,
            annualRevenue: lead.annualRevenue,
            country: lead.country,
            state: lead.state,
            ownerUserId: lead.assignedToUserId ?? req.currentUser!.id,
          })
          .returning();
        accountId = created.id;
      }
    }

    const pipeline = await orgPipeline(orgId, null);
    const stages = stagesOf(pipeline);
    const firstStage = stages[0];
    const [opp] = await db
      .insert(opportunities)
      .values({
        orgId,
        accountId: accountId!,
        name:
          parsed.data.opportunityName ??
          `${lead.company ?? `${lead.firstName} ${lead.lastName}`} - New Business`,
        pipelineId: pipeline?.id,
        stage: firstStage?.key ?? "prospecting",
        probability: firstStage?.probability ?? 10,
        forecastCategory: firstStage?.forecastCategory ?? "pipeline",
        value: parsed.data.value,
        expectedCloseDate: parsed.data.expectedCloseDate,
        ownerUserId: lead.assignedToUserId ?? req.currentUser!.id,
      })
      .returning();
    await db.insert(opportunityStageHistory).values({
      orgId,
      opportunityId: opp.id,
      fromStage: null,
      toStage: opp.stage,
      changedByUserId: req.currentUser!.id,
    });
    await db
      .update(leads)
      .set({ status: "qualified", convertedOpportunityId: opp.id })
      .where(eq(leads.id, lead.id));
    await publishAutomationEvent({
      orgId,
      eventKey: `lead-qualified:${lead.id}:${opp.id}`,
      eventType: "field_change",
      entityType: "lead",
      entityId: lead.id,
      payload: { field: "status", oldValue: lead.status, newValue: "qualified" },
      actorUserId: req.currentUser!.id,
    });
    await publishAutomationEvent({
      orgId,
      eventKey: `opportunity-created:${opp.id}`,
      eventType: "record_created",
      entityType: "opportunity",
      entityId: opp.id,
      payload: { stage: opp.stage },
      actorUserId: req.currentUser!.id,
    });
    res.status(201).json(QualifyLeadResponse.parse(await opportunityDetail(opp)));
  },
);

router.post("/orgs/:orgId/leads/rescore", ...gate, async (req, res): Promise<void> => {
  const orgId = req.currentOrg!.id;
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.isActive, true)));
  for (const lead of rows) {
    await scoreAndRouteLead(orgId, lead);
  }
  res.json(RescoreLeadsResponse.parse({ leadsRescored: rows.length }));
});

/* --------------------------- lead scoring rules -------------------------- */

function ruleOut(r: LeadScoringRule) {
  return {
    id: r.id,
    name: r.name,
    conditions: (r.conditions ?? []) as {
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
    actionType: r.actionType as "add" | "set",
    points: r.points,
    priority: r.priority,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/orgs/:orgId/lead-scoring-rules", ...gate, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(leadScoringRules)
    .where(eq(leadScoringRules.orgId, req.currentOrg!.id))
    .orderBy(leadScoringRules.priority, leadScoringRules.createdAt);
  res.json(ListLeadScoringRulesResponse.parse(rows.map(ruleOut)));
});

router.post("/orgs/:orgId/lead-scoring-rules", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateLeadScoringRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const [row] = await db
    .insert(leadScoringRules)
    .values({
      orgId: req.currentOrg!.id,
      name: parsed.data.name,
      conditions: parsed.data.conditions,
      actionType: parsed.data.actionType,
      points: parsed.data.points,
      priority: parsed.data.priority ?? 0,
      isActive: parsed.data.isActive ?? true,
    })
    .returning();
  res.status(201).json(CreateLeadScoringRuleResponse.parse(ruleOut(row)));
});

router.patch(
  "/orgs/:orgId/lead-scoring-rules/:ruleId",
  ...gate,
  async (req, res): Promise<void> => {
    const parsed = CreateLeadScoringRuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(leadScoringRules)
      .where(
        and(
          eq(leadScoringRules.id, req.params.ruleId as string),
          eq(leadScoringRules.orgId, req.currentOrg!.id),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    const [row] = await db
      .update(leadScoringRules)
      .set({
        name: parsed.data.name,
        conditions: parsed.data.conditions,
        actionType: parsed.data.actionType,
        points: parsed.data.points,
        priority: parsed.data.priority ?? existing.priority,
        isActive: parsed.data.isActive ?? existing.isActive,
      })
      .where(eq(leadScoringRules.id, existing.id))
      .returning();
    res.json(UpdateLeadScoringRuleResponse.parse(ruleOut(row)));
  },
);

router.delete(
  "/orgs/:orgId/lead-scoring-rules/:ruleId",
  ...gate,
  async (req, res): Promise<void> => {
    const [existing] = await db
      .select()
      .from(leadScoringRules)
      .where(
        and(
          eq(leadScoringRules.id, req.params.ruleId as string),
          eq(leadScoringRules.orgId, req.currentOrg!.id),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    await db.delete(leadScoringRules).where(eq(leadScoringRules.id, existing.id));
    res.status(204).end();
  },
);

/* -------------------------------- quotes -------------------------------- */

async function quoteOut(q: Quote) {
  const [[opp], [account]] = await Promise.all([
    db
      .select({ name: opportunities.name })
      .from(opportunities)
      .where(eq(opportunities.id, q.opportunityId)),
    db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, q.accountId)),
  ]);
  const lineItems = (q.lineItems ?? []) as QuoteLineItem[];
  const discountPercent = Number(q.discountPercent ?? 0);
  const { subtotal, total } = quoteTotals(lineItems, discountPercent);
  return {
    id: q.id,
    opportunityId: q.opportunityId,
    opportunityName: opp?.name ?? null,
    accountId: q.accountId,
    accountName: account?.name ?? null,
    quoteNumber: q.quoteNumber,
    status: q.status as "draft" | "sent" | "accepted" | "rejected" | "expired",
    lineItems,
    discountPercent,
    subtotal,
    total,
    validUntil: q.validUntil,
    recipientEmail: q.recipientEmail,
    notes: q.notes,
    sentAt: q.sentAt?.toISOString() ?? null,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  };
}

async function nextQuoteNumber(orgId: string): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quotes)
    .where(eq(quotes.orgId, orgId));
  const year = new Date().getFullYear();
  return `Q-${year}-${String(count + 1).padStart(4, "0")}`;
}

router.get("/orgs/:orgId/quotes", ...gate, async (req, res): Promise<void> => {
  const { opportunityId } = req.query as { opportunityId?: string };
  const where = [eq(quotes.orgId, req.currentOrg!.id)];
  if (opportunityId) where.push(eq(quotes.opportunityId, opportunityId));
  const rows = await db
    .select()
    .from(quotes)
    .where(and(...where))
    .orderBy(desc(quotes.createdAt));
  res.json(ListQuotesResponse.parse(await Promise.all(rows.map(quoteOut))));
});

router.post("/orgs/:orgId/quotes", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const orgId = req.currentOrg!.id;
  const [opp] = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, parsed.data.opportunityId),
        eq(opportunities.orgId, orgId),
      ),
    );
  if (!opp) {
    res.status(400).json({ error: "opportunityId must reference an opportunity in this organization" });
    return;
  }
  // 2-click quote creation: default a line item from the opportunity value
  // and the recipient from the account's primary contact when not provided.
  let lineItems = parsed.data.lineItems ?? [];
  if (lineItems.length === 0) {
    lineItems = [
      {
        name: opp.name,
        description: null,
        quantity: 1,
        unitPrice: opp.value ? Number(opp.value) : 0,
        discountPercent: null,
      },
    ];
  }
  const [row] = await db
    .insert(quotes)
    .values({
      orgId,
      opportunityId: opp.id,
      accountId: opp.accountId,
      quoteNumber: await nextQuoteNumber(orgId),
      lineItems,
      discountPercent: String(parsed.data.discountPercent ?? 0),
      validUntil: parsed.data.validUntil,
      recipientEmail: parsed.data.recipientEmail,
      notes: parsed.data.notes,
      createdByUserId: req.currentUser!.id,
    })
    .returning();
  res.status(201).json(CreateQuoteResponse.parse(await quoteOut(row)));
});

async function findQuote(req: Request): Promise<Quote | undefined> {
  const [row] = await db
    .select()
    .from(quotes)
    .where(
      and(
        eq(quotes.id, req.params.quoteId as string),
        eq(quotes.orgId, req.currentOrg!.id),
      ),
    );
  return row;
}

router.get("/orgs/:orgId/quotes/:quoteId", ...gate, async (req, res): Promise<void> => {
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  res.json(GetQuoteResponse.parse(await quoteOut(quote)));
});

router.patch("/orgs/:orgId/quotes/:quoteId", ...gate, async (req, res): Promise<void> => {
  const parsed = UpdateQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  if (quote.status !== "draft") {
    res.status(400).json({ error: "Only draft quotes can be edited" });
    return;
  }
  const updates: Partial<typeof quotes.$inferInsert> = {};
  if (parsed.data.lineItems !== undefined) updates.lineItems = parsed.data.lineItems;
  if (parsed.data.discountPercent !== undefined && parsed.data.discountPercent !== null) {
    updates.discountPercent = String(parsed.data.discountPercent);
  }
  if (parsed.data.validUntil !== undefined) updates.validUntil = parsed.data.validUntil;
  if (parsed.data.recipientEmail !== undefined) updates.recipientEmail = parsed.data.recipientEmail;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  const [row] = await db
    .update(quotes)
    .set(updates)
    .where(eq(quotes.id, quote.id))
    .returning();
  res.json(UpdateQuoteResponse.parse(await quoteOut(row)));
});

router.delete("/orgs/:orgId/quotes/:quoteId", ...gate, async (req, res): Promise<void> => {
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  if (quote.status !== "draft") {
    res.status(400).json({ error: "Only draft quotes can be deleted" });
    return;
  }
  await db.delete(quotes).where(eq(quotes.id, quote.id));
  res.status(204).end();
});

async function buildQuotePdf(quote: Quote, orgName: string) {
  const [[opp], [account]] = await Promise.all([
    db.select().from(opportunities).where(eq(opportunities.id, quote.opportunityId)),
    db.select().from(accounts).where(eq(accounts.id, quote.accountId)),
  ]);
  if (!opp || !account) throw new Error("Quote is missing its opportunity or account");
  return renderQuotePdf({ quote, opportunity: opp, account, orgName });
}

router.get("/orgs/:orgId/quotes/:quoteId/pdf", ...gate, async (req, res): Promise<void> => {
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  const pdf = await buildQuotePdf(quote, req.currentOrg!.name);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${quote.quoteNumber}.pdf"`,
  );
  res.send(pdf);
});

router.post("/orgs/:orgId/quotes/:quoteId/send", ...gate, async (req, res): Promise<void> => {
  const parsed = SendQuoteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  if (quote.status !== "draft" && quote.status !== "sent") {
    res.status(400).json({ error: `A ${quote.status} quote cannot be sent` });
    return;
  }
  const recipient = parsed.data.recipientEmail ?? quote.recipientEmail;
  if (!recipient) {
    res.status(400).json({ error: "A recipient email is required to send the quote" });
    return;
  }
  const orgName = req.currentOrg!.name;
  const pdf = await buildQuotePdf(quote, orgName);
  const lineItems = (quote.lineItems ?? []) as QuoteLineItem[];
  const { total } = quoteTotals(lineItems, Number(quote.discountPercent ?? 0));
  const message = parsed.data.message
    ? `<p>${parsed.data.message.replace(/</g, "&lt;")}</p>`
    : "";
  try {
    await sendEmail({
      to: recipient,
      subject: `Quote ${quote.quoteNumber} from ${orgName}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#0A0E27">
          <h2 style="color:#0A0E27">Quote ${quote.quoteNumber}</h2>
          ${message}
          <p>Please find your quote attached. Total: <strong>$${total.toLocaleString(
            "en-US",
            { minimumFractionDigits: 2 },
          )}</strong>${quote.validUntil ? `, valid until ${quote.validUntil}` : ""}.</p>
          <p>- ${orgName}</p>
        </div>`,
      attachments: [{ filename: `${quote.quoteNumber}.pdf`, content: pdf }],
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  const [row] = await db
    .update(quotes)
    .set({ status: "sent", sentAt: new Date(), recipientEmail: recipient })
    .where(eq(quotes.id, quote.id))
    .returning();
  res.json(SendQuoteResponse.parse(await quoteOut(row)));
});

router.post("/orgs/:orgId/quotes/:quoteId/accept", ...gate, async (req, res): Promise<void> => {
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  if (quote.status !== "sent") {
    res.status(400).json({ error: "Only sent quotes can be accepted" });
    return;
  }
  const [row] = await db
    .update(quotes)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(quotes.id, quote.id))
    .returning();
  res.json(AcceptQuoteResponse.parse(await quoteOut(row)));
});

/* ------------------------------ territories ------------------------------ */

async function territoryOut(t: Territory) {
  const owner = t.ownerUserId
    ? await db
        .select({ fullName: users.fullName, email: users.email })
        .from(users)
        .where(eq(users.id, t.ownerUserId))
        .then((r) => r[0])
    : undefined;
  return {
    id: t.id,
    name: t.name,
    ownerUserId: t.ownerUserId,
    ownerName: owner ? (owner.fullName ?? owner.email) : null,
    countries: t.countries ?? [],
    states: t.states ?? [],
    products: t.products ?? [],
    quota: t.quota,
    createdAt: t.createdAt.toISOString(),
  };
}

router.get("/orgs/:orgId/territories", ...gate, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(territories)
    .where(
      and(eq(territories.orgId, req.currentOrg!.id), eq(territories.isActive, true)),
    )
    .orderBy(territories.name);
  res.json(ListTerritoriesResponse.parse(await Promise.all(rows.map(territoryOut))));
});

router.post("/orgs/:orgId/territories", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateTerritoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  if (
    parsed.data.ownerUserId &&
    !(await isOrgMember(req.currentOrg!.id, parsed.data.ownerUserId))
  ) {
    res.status(400).json({ error: "ownerUserId must reference a member of this organization" });
    return;
  }
  const [row] = await db
    .insert(territories)
    .values({
      orgId: req.currentOrg!.id,
      name: parsed.data.name,
      ownerUserId: parsed.data.ownerUserId,
      countries: parsed.data.countries ?? [],
      states: parsed.data.states ?? [],
      products: parsed.data.products ?? [],
      quota: parsed.data.quota,
    })
    .returning();
  res.status(201).json(CreateTerritoryResponse.parse(await territoryOut(row)));
});

async function findTerritory(req: Request): Promise<Territory | undefined> {
  const [row] = await db
    .select()
    .from(territories)
    .where(
      and(
        eq(territories.id, req.params.territoryId as string),
        eq(territories.orgId, req.currentOrg!.id),
      ),
    );
  return row;
}

router.patch(
  "/orgs/:orgId/territories/:territoryId",
  ...gate,
  async (req, res): Promise<void> => {
    const parsed = CreateTerritoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const territory = await findTerritory(req);
    if (!territory) {
      res.status(404).json({ error: "Territory not found" });
      return;
    }
    if (
      parsed.data.ownerUserId &&
      !(await isOrgMember(req.currentOrg!.id, parsed.data.ownerUserId))
    ) {
      res.status(400).json({ error: "ownerUserId must reference a member of this organization" });
      return;
    }
    const [row] = await db
      .update(territories)
      .set({
        name: parsed.data.name,
        ownerUserId: parsed.data.ownerUserId,
        countries: parsed.data.countries ?? territory.countries,
        states: parsed.data.states ?? territory.states,
        products: parsed.data.products ?? territory.products,
        quota: parsed.data.quota,
      })
      .where(eq(territories.id, territory.id))
      .returning();
    res.json(UpdateTerritoryResponse.parse(await territoryOut(row)));
  },
);

router.delete(
  "/orgs/:orgId/territories/:territoryId",
  ...gate,
  async (req, res): Promise<void> => {
    const territory = await findTerritory(req);
    if (!territory) {
      res.status(404).json({ error: "Territory not found" });
      return;
    }
    await db
      .update(territories)
      .set({ isActive: false })
      .where(eq(territories.id, territory.id));
    res.status(204).end();
  },
);

function accountInTerritory(
  account: { country: string | null; state: string | null },
  t: Territory,
): boolean {
  const state = account.state?.toLowerCase();
  const country = account.country?.toLowerCase();
  if (state && (t.states ?? []).some((s) => s.toLowerCase() === state)) return true;
  if (country && (t.countries ?? []).some((c) => c.toLowerCase() === country)) {
    return true;
  }
  return false;
}

router.get(
  "/orgs/:orgId/territories/coverage",
  ...gate,
  async (req, res): Promise<void> => {
    const orgId = req.currentOrg!.id;
    const [terrRows, accountRows, oppRows] = await Promise.all([
      db
        .select()
        .from(territories)
        .where(and(eq(territories.orgId, orgId), eq(territories.isActive, true)))
        .orderBy(territories.name),
      db
        .select({
          id: accounts.id,
          country: accounts.country,
          state: accounts.state,
        })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.isActive, true))),
      db
        .select({
          accountId: opportunities.accountId,
          value: opportunities.value,
          forecastCategory: opportunities.forecastCategory,
        })
        .from(opportunities)
        .where(eq(opportunities.orgId, orgId)),
    ]);

    const rows = await Promise.all(
      terrRows.map(async (t) => {
        const terrAccounts = accountRows.filter((a) => accountInTerritory(a, t));
        const accountIds = new Set(terrAccounts.map((a) => a.id));
        let openPipelineValue = 0;
        let closedWonValue = 0;
        for (const o of oppRows) {
          if (!accountIds.has(o.accountId)) continue;
          const v = o.value ? Number(o.value) : 0;
          if (o.forecastCategory === "closed_won") closedWonValue += v;
          else if (o.forecastCategory !== "closed_lost") openPipelineValue += v;
        }
        const quota = t.quota ? Number(t.quota) : null;
        const owner = t.ownerUserId
          ? await db
              .select({ fullName: users.fullName, email: users.email })
              .from(users)
              .where(eq(users.id, t.ownerUserId))
              .then((r) => r[0])
          : undefined;
        return {
          territoryId: t.id,
          territoryName: t.name,
          ownerName: owner ? (owner.fullName ?? owner.email) : null,
          accountCount: terrAccounts.length,
          quota,
          openPipelineValue: Math.round(openPipelineValue * 100) / 100,
          closedWonValue: Math.round(closedWonValue * 100) / 100,
          achievementPercent:
            quota && quota > 0
              ? Math.round((closedWonValue / quota) * 1000) / 10
              : null,
        };
      }),
    );
    res.json(GetTerritoryCoverageResponse.parse(rows));
  },
);

/* -------------------------------- forecast ------------------------------- */

router.get("/orgs/:orgId/forecast", ...gate, async (req, res): Promise<void> => {
  const orgId = req.currentOrg!.id;
  const monthsParam = Number((req.query as { months?: string }).months);
  const monthCount =
    Number.isFinite(monthsParam) && monthsParam >= 1 && monthsParam <= 24
      ? Math.floor(monthsParam)
      : 6;
  const ownerUserId = (req.query as { ownerUserId?: string }).ownerUserId;

  const where = [eq(opportunities.orgId, orgId)];
  if (ownerUserId) where.push(eq(opportunities.ownerUserId, ownerUserId));
  const rows = await db
    .select()
    .from(opportunities)
    .where(and(...where));

  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const byMonth = new Map(
    monthKeys.map((m) => [
      m,
      { month: m, committed: 0, bestCase: 0, pipeline: 0, closedWon: 0 },
    ]),
  );

  for (const o of rows) {
    const value = o.value ? Number(o.value) : 0;
    if (!value) continue;
    const cat = o.forecastCategory ?? "pipeline";
    if (cat === "closed_lost") continue;
    const dateKey =
      cat === "closed_won"
        ? (o.actualCloseDate ?? o.expectedCloseDate)
        : o.expectedCloseDate;
    if (!dateKey) continue;
    const bucket = byMonth.get(dateKey.slice(0, 7));
    if (!bucket) continue;
    if (cat === "closed_won") {
      bucket.closedWon += value;
      continue;
    }
    // Cumulative categories: committed ⊂ best case ⊂ pipeline.
    bucket.pipeline += value;
    if (cat === "committed" || cat === "best_case") bucket.bestCase += value;
    if (cat === "committed") bucket.committed += value;
  }

  const months = monthKeys.map((m) => {
    const b = byMonth.get(m)!;
    return {
      month: b.month,
      committed: Math.round(b.committed * 100) / 100,
      bestCase: Math.round(b.bestCase * 100) / 100,
      pipeline: Math.round(b.pipeline * 100) / 100,
      closedWon: Math.round(b.closedWon * 100) / 100,
    };
  });
  const totals = months.reduce(
    (acc, m) => ({
      month: "total",
      committed: Math.round((acc.committed + m.committed) * 100) / 100,
      bestCase: Math.round((acc.bestCase + m.bestCase) * 100) / 100,
      pipeline: Math.round((acc.pipeline + m.pipeline) * 100) / 100,
      closedWon: Math.round((acc.closedWon + m.closedWon) * 100) / 100,
    }),
    { month: "total", committed: 0, bestCase: 0, pipeline: 0, closedWon: 0 },
  );

  res.json(GetForecastResponse.parse({ months, totals }));
});

export default router;
