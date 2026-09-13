import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
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
import { publishWebhookEvent } from "../services/webhooks";
import { appendAuditEvent, auditContext } from "../services/audit";
import {
  hasCrmManagementAccess,
  canAccessCrmRecord,
  crmRecordCondition,
  withCrmVisibility,
} from "../services/crmAccess";
import { recordCommissionForClosedWon } from "../services/commissions";

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

async function ensureDefaultPipeline(orgId: string, createIfMissing = true): Promise<Pipeline[]> {
  const rows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, orgId))
    .orderBy(desc(pipelines.isDefault), pipelines.createdAt);
  if (rows.length > 0) return rows;
  if (!createIfMissing) return [];
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
  const rows = await ensureDefaultPipeline(req.currentOrg!.id, false);
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

function opportunityAudit(o: Opportunity) {
  return {
    accountId: o.accountId,
    name: o.name,
    stage: o.stage,
    ownerUserId: o.ownerUserId,
    createdByUserId: o.createdByUserId,
  };
}

function leadAudit(l: Lead) {
  return {
    firstName: l.firstName,
    lastName: l.lastName,
    company: l.company,
    status: l.status,
    score: l.score,
    assignedToUserId: l.assignedToUserId,
    createdByUserId: l.createdByUserId,
    isActive: l.isActive,
  };
}

async function crmAssignee(
  req: Request,
  requested: string | null | undefined,
  field: string,
): Promise<{ value: string | null; error?: string }> {
  const currentUserId = req.currentUser!.id;
  if (requested === undefined) return { value: currentUserId };
  if (!hasCrmManagementAccess(req) && requested !== currentUserId) {
    return { value: currentUserId, error: `Only management may assign ${field} to another user or leave it unassigned` };
  }
  if (requested !== null && !(await isOrgMember(req.currentOrg!.id, requested))) {
    return { value: currentUserId, error: `${field} must reference a member of this organization` };
  }
  return { value: requested };
}

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
    ownerUserId: o.ownerUserId,
    createdByUserId: o.createdByUserId,
    createdAt: o.createdAt.toISOString(),
  };
}

async function opportunityDetail(o: Opportunity, req: Request) {
  const [[account], [owner], history] = await Promise.all([
    db
      .select({ name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, o.accountId),
          eq(accounts.orgId, o.orgId),
          ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        ),
      ),
    o.ownerUserId
      ? db
          .select({ fullName: users.fullName, email: users.email })
          .from(users)
          .innerJoin(orgUsers, eq(orgUsers.userId, users.id))
          .where(and(eq(users.id, o.ownerUserId), eq(orgUsers.orgId, o.orgId)))
      : Promise.resolve([undefined]),
    db
      .select({
        entry: opportunityStageHistory,
        userName: users.fullName,
        userEmail: users.email,
      })
      .from(opportunityStageHistory)
      .leftJoin(users, eq(opportunityStageHistory.changedByUserId, users.id))
      .leftJoin(
        orgUsers,
        and(eq(orgUsers.userId, users.id), eq(orgUsers.orgId, o.orgId)),
      )
      .where(
        and(
          eq(opportunityStageHistory.opportunityId, o.id),
          eq(opportunityStageHistory.orgId, o.orgId),
          or(isNull(users.id), eq(orgUsers.orgId, o.orgId)),
        ),
      )
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
    createdByUserId: o.createdByUserId,
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
        ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
      ),
    );
  if (!row || !(await canAccessCrmRecord(req, "account", row.accountId))) {
    return undefined;
  }
  return row;
}

async function visibleOpportunities(
  req: Request,
  rows: Opportunity[],
): Promise<Opportunity[]> {
  const visible = await Promise.all(
    rows.map(async (row) =>
      (await canAccessCrmRecord(req, "account", row.accountId)) ? row : undefined,
    ),
  );
  return visible.filter((row): row is Opportunity => Boolean(row));
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
  where.push(...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId));
  if (pipelineId) where.push(eq(opportunities.pipelineId, pipelineId));
  if (stage) where.push(eq(opportunities.stage, stage));
  const rows = await db
    .select()
    .from(opportunities)
    .where(and(...where))
    .orderBy(desc(opportunities.createdAt));
  const visibleRows = await visibleOpportunities(req, rows);
  res.json(ListOpportunitiesResponse.parse(visibleRows.map(opportunitySummary)));
});

router.post("/orgs/:orgId/opportunities", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const orgId = req.currentOrg!.id;
  const assignment = await crmAssignee(req, parsed.data.ownerUserId, "ownerUserId");
  if (assignment.error) {
    res.status(403).json({ error: assignment.error });
    return;
  }
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.id, parsed.data.accountId),
      eq(accounts.orgId, orgId),
      ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
    ));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
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
  const row = await db.transaction(async (tx) => {
    const [lockedAccount] = await tx.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.id, parsed.data.accountId), eq(accounts.orgId, orgId),
      ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
    )).for("update");
    if (!lockedAccount) return undefined;
    const [created] = await tx.insert(opportunities).values({
      orgId,
      accountId: lockedAccount.id,
      name: parsed.data.name,
      pipelineId: pipeline.id,
      stage: stageKey,
      probability: parsed.data.probability ?? stageDef?.probability ?? 0,
      value: parsed.data.value,
      expectedCloseDate: parsed.data.expectedCloseDate,
      nextAction: parsed.data.nextAction,
      forecastCategory: stageDef?.forecastCategory ?? "pipeline",
      ownerUserId: assignment.value,
      createdByUserId: req.currentUser!.id,
    }).returning();
    await tx.insert(opportunityStageHistory).values({
      orgId,
      opportunityId: created.id,
      fromStage: null,
      toStage: stageKey,
      changedByUserId: req.currentUser!.id,
    });
      await recordCommissionForClosedWon(tx, null, created);
    return created;
  });
  if (!row) { res.status(404).json({ error: "Account not found" }); return; }
  await appendAuditEvent({
    orgId,
    action: "opportunity.created",
    entityType: "opportunity",
    entityId: row.id,
    ...auditContext(req),
    metadata: { after: opportunityAudit(row) },
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
  void publishWebhookEvent(orgId, "opportunity.created", row.id, { id: row.id, name: row.name, stage: row.stage });
  res
    .status(201)
    .json(CreateOpportunityResponse.parse(await opportunityDetail(row, req)));
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
    res.json(GetOpportunityResponse.parse(await opportunityDetail(opp, req)));
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
    if (data.ownerUserId !== undefined) {
      const assignment = await crmAssignee(req, data.ownerUserId, "ownerUserId");
      if (assignment.error) {
        res.status(403).json({ error: assignment.error });
        return;
      }
      updates.ownerUserId = assignment.value;
    }

    const result = await db.transaction(async (tx) => {
      // Serialize closes on the opportunity row and commit the ledger entry
      // with the opportunity update.
      const [locked] = await tx
        .select()
        .from(opportunities)
        .where(and(
          eq(opportunities.id, opp.id),
          eq(opportunities.orgId, orgId),
          ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        ))
        .for("update");
      if (!locked) return undefined;
      const [row] = await tx
        .update(opportunities)
        .set(updates)
        .where(and(
          eq(opportunities.id, locked.id),
          eq(opportunities.orgId, orgId),
          ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        ))
        .returning();
      if (!row) return undefined;
      await recordCommissionForClosedWon(tx, locked, row);
      if (data.stage !== undefined && data.stage !== locked.stage) {
        await tx.insert(opportunityStageHistory).values({
          orgId,
          opportunityId: locked.id,
          fromStage: locked.stage,
          toStage: data.stage,
          changedByUserId: req.currentUser!.id,
        });
      }
      return { before: locked, row };
    });
    if (!result) { res.status(404).json({ error: "Opportunity not found" }); return; }
    const { before: lockedOpp, row } = result;
    await appendAuditEvent({
      orgId,
      action: "opportunity.updated",
      entityType: "opportunity",
      entityId: row.id,
      ...auditContext(req),
      metadata: { before: opportunityAudit(lockedOpp), after: opportunityAudit(row) },
    });
    void publishWebhookEvent(orgId, "opportunity.updated", row.id, { id: row.id, name: row.name, stage: row.stage });

    if (data.stage !== undefined && data.stage !== lockedOpp.stage) {
      await publishAutomationEvent({
        orgId,
        eventKey: `opportunity-stage:${lockedOpp.id}:${row.stage}:${row.updatedAt.toISOString()}`,
        eventType: "field_change",
        entityType: "opportunity",
        entityId: lockedOpp.id,
        payload: { field: "stage", oldValue: lockedOpp.stage, newValue: row.stage },
        actorUserId: req.currentUser!.id,
      });
    }
    res.json(UpdateOpportunityResponse.parse(await opportunityDetail(row, req)));
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
    const [deleted] = await db.delete(opportunities)
      .where(and(eq(opportunities.id, opp.id), eq(opportunities.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Opportunity not found" }); return; }
    await appendAuditEvent({
      orgId: opp.orgId,
      action: "opportunity.deleted",
      entityType: "opportunity",
      entityId: opp.id,
      ...auditContext(req),
      metadata: { before: opportunityAudit(deleted ?? opp) },
    });
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
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(opportunities)
        .where(and(
          eq(opportunities.id, opp.id),
          eq(opportunities.orgId, orgId),
          ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        ))
        .for("update");
      if (!locked) return undefined;
      const [row] = await tx
        .update(opportunities)
        .set({
          stage: wonStage.key,
          probability: 100,
          forecastCategory: "closed_won",
          actualCloseDate: today,
        })
        .where(and(
          eq(opportunities.id, locked.id),
          eq(opportunities.orgId, orgId),
          ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        ))
        .returning();
      if (!row) return undefined;
      await recordCommissionForClosedWon(tx, locked, row);
      if (locked.stage !== wonStage.key) {
        await tx.insert(opportunityStageHistory).values({
          orgId,
          opportunityId: locked.id,
          fromStage: locked.stage,
          toStage: wonStage.key,
          changedByUserId: req.currentUser!.id,
        });
      }
      return { before: locked, row };
    });
    if (!result) { res.status(404).json({ error: "Opportunity not found" }); return; }
    const { before: lockedOpp, row } = result;
    await appendAuditEvent({
      orgId,
      action: "opportunity.updated",
      entityType: "opportunity",
      entityId: row.id,
      ...auditContext(req),
      metadata: {
        operation: "convert_to_customer",
        before: opportunityAudit(lockedOpp),
        after: opportunityAudit(row),
      },
    });
    // Flag the account as a customer.
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(
        eq(accounts.id, opp.accountId),
        eq(accounts.orgId, orgId),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
      ));
    if (account) {
      const metadata = {
        ...((account.metadata ?? {}) as Record<string, unknown>),
        customer: "true",
        customerSince:
          ((account.metadata ?? {}) as Record<string, unknown>).customerSince ??
          today,
      };
      const [updatedAccount] = await db.update(accounts).set({ metadata })
        .where(and(
          eq(accounts.id, account.id),
          eq(accounts.orgId, orgId),
          ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        ))
        .returning({ id: accounts.id });
      if (!updatedAccount) {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      await appendAuditEvent({
        orgId,
        action: "account.updated",
        entityType: "account",
        entityId: account.id,
        ...auditContext(req),
        metadata: { operation: "convert_opportunity_to_customer" },
      });
    }
    res.json(
      ConvertOpportunityToCustomerResponse.parse(await opportunityDetail(row, req)),
    );
  },
);

/* -------------------------------- leads -------------------------------- */

async function leadOut(req: Request, l: Lead) {
  const [assignee, territory, convertedOpportunityVisible] = await Promise.all([
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
    l.convertedOpportunityId
      ? canAccessCrmRecord(req, "opportunity", l.convertedOpportunityId)
      : Promise.resolve(false),
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
    createdByUserId: l.createdByUserId,
    assignedToName: assignee ? (assignee.fullName ?? assignee.email) : null,
    territoryId: l.territoryId,
    territoryName: territory?.name ?? null,
    convertedOpportunityId: convertedOpportunityVisible
      ? l.convertedOpportunityId
      : null,
    createdAt: l.createdAt.toISOString(),
  };
}

router.get("/orgs/:orgId/leads", ...gate, async (req, res): Promise<void> => {
  const { status, q } = req.query as { status?: string; q?: string };
  const where = [eq(leads.orgId, req.currentOrg!.id), eq(leads.isActive, true)];
  where.push(...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId));
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
  res.json(
    ListLeadsResponse.parse(await Promise.all(rows.map((lead) => leadOut(req, lead)))),
  );
});

router.post("/orgs/:orgId/leads", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const orgId = req.currentOrg!.id;
  const assignment = await crmAssignee(req, parsed.data.assignedToUserId, "assignedToUserId");
  if (assignment.error) {
    res.status(403).json({ error: assignment.error });
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
    .values({
      ...parsed.data,
      assignedToUserId: assignment.value,
      createdByUserId: req.currentUser!.id,
      orgId,
    })
    .returning();
  // Auto-score + auto-route to the matching territory owner.
  const row = await scoreAndRouteLead(orgId, inserted);
  await appendAuditEvent({
    orgId,
    action: "lead.created",
    entityType: "lead",
    entityId: row.id,
    ...auditContext(req),
    metadata: { after: leadAudit(row) },
  });
  await publishAutomationEvent({
    orgId,
    eventKey: `lead-created:${row.id}`,
    eventType: "record_created",
    entityType: "lead",
    entityId: row.id,
    payload: { status: row.status, score: row.score },
    actorUserId: req.currentUser!.id,
  });
  void publishWebhookEvent(orgId, "lead.created", row.id, { id: row.id, email: row.email, status: row.status, score: row.score });
  void processNewLead(orgId, row.id, req.currentUser!.id).catch((err) => {
    req.log.error({ err, leadId: row.id }, "Lead qualifier agent failed");
  });
  res
    .status(201)
    .json(CreateLeadResponse.parse(await leadOut(req, row)));
});

async function findLead(req: Request): Promise<Lead | undefined> {
  const [row] = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.id, req.params.leadId as string),
        eq(leads.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId),
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
  if (rest.assignedToUserId !== undefined) {
    const assignment = await crmAssignee(req, rest.assignedToUserId, "assignedToUserId");
    if (assignment.error) {
      res.status(403).json({ error: assignment.error });
      return;
    }
    rest.assignedToUserId = assignment.value;
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
    .where(and(eq(leads.id, lead.id), eq(leads.orgId, orgId),
      ...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
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
    reassign: hasCrmManagementAccess(req) && routingFieldsChanged && !manualAssignment,
  });
  await appendAuditEvent({
    orgId,
    action: "lead.updated",
    entityType: "lead",
    entityId: row.id,
    ...auditContext(req),
    metadata: { before: leadAudit(lead), after: leadAudit(row) },
  });
  void publishWebhookEvent(orgId, "lead.updated", row.id, { id: row.id, email: row.email, status: row.status, score: row.score });
  res.json(UpdateLeadResponse.parse(await leadOut(req, row)));
});

router.delete("/orgs/:orgId/leads/:leadId", ...gate, async (req, res): Promise<void> => {
  const lead = await findLead(req);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const [deleted] = await db.update(leads).set({ isActive: false })
    .where(and(eq(leads.id, lead.id), eq(leads.orgId, req.currentOrg!.id),
      ...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Lead not found" }); return; }
  await appendAuditEvent({
    orgId: lead.orgId,
    action: "lead.deleted",
    entityType: "lead",
    entityId: lead.id,
    ...auditContext(req),
    metadata: { before: leadAudit(lead), after: leadAudit(deleted) },
  });
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

    const pipeline = await orgPipeline(orgId, null);
    const stages = stagesOf(pipeline);
    const firstStage = stages[0];
    const conversion = await db.transaction(async (tx) => {
      const [lockedLead] = await tx.select().from(leads).where(and(
        eq(leads.id, lead.id), eq(leads.orgId, orgId),
        ...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId),
      )).for("update");
      if (!lockedLead || (lockedLead.status === "qualified" && lockedLead.convertedOpportunityId)) return undefined;

      let accountId = parsed.data.accountId ?? null;
      let createdAccount: typeof accounts.$inferSelect | undefined;
      if (accountId) {
        const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(
          eq(accounts.id, accountId), eq(accounts.orgId, orgId),
          ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        )).for("update");
        if (!account) return undefined;
      } else {
        const companyName = lockedLead.company ?? `${lockedLead.firstName} ${lockedLead.lastName}`.trim();
        const [existing] = await tx.select({ id: accounts.id }).from(accounts).where(and(
          eq(accounts.orgId, orgId), ilike(accounts.name, companyName), eq(accounts.isActive, true),
          ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        )).for("update");
        if (existing) {
          accountId = existing.id;
        } else {
          [createdAccount] = await tx.insert(accounts).values({
            orgId, name: companyName, industry: lockedLead.industry,
            employeeCount: lockedLead.companySize, annualRevenue: lockedLead.annualRevenue,
            country: lockedLead.country, state: lockedLead.state,
            ownerUserId: lockedLead.assignedToUserId ?? req.currentUser!.id,
            createdByUserId: req.currentUser!.id,
          }).returning();
          accountId = createdAccount.id;
        }
      }
      const [opp] = await tx.insert(opportunities).values({
        orgId,
        accountId: accountId!,
        name:
          parsed.data.opportunityName ??
          `${lockedLead.company ?? `${lockedLead.firstName} ${lockedLead.lastName}`} - New Business`,
        pipelineId: pipeline?.id,
        stage: firstStage?.key ?? "prospecting",
        probability: firstStage?.probability ?? 10,
        forecastCategory: firstStage?.forecastCategory ?? "pipeline",
        value: parsed.data.value,
        expectedCloseDate: parsed.data.expectedCloseDate,
        ownerUserId: lockedLead.assignedToUserId ?? req.currentUser!.id,
        createdByUserId: req.currentUser!.id,
      }).returning();
      await tx.insert(opportunityStageHistory).values({
        orgId, opportunityId: opp.id, fromStage: null, toStage: opp.stage,
        changedByUserId: req.currentUser!.id,
      });
      await recordCommissionForClosedWon(tx, null, opp);
      const [updatedLead] = await tx.update(leads)
        .set({ status: "qualified", convertedOpportunityId: opp.id })
        .where(and(eq(leads.id, lockedLead.id), eq(leads.orgId, orgId),
          ...withCrmVisibility(req, leads.assignedToUserId, leads.createdByUserId)))
        .returning({ id: leads.id });
      if (!updatedLead) throw new Error("Lead visibility changed during qualification");
      return { opp, lead: lockedLead, createdAccount };
    });
    if (!conversion) { res.status(404).json({ error: "Lead or account not found" }); return; }
    const { opp } = conversion;
    if (conversion.createdAccount) {
      await appendAuditEvent({
        orgId, action: "account.created", entityType: "account",
        entityId: conversion.createdAccount.id, ...auditContext(req),
        metadata: { source: "lead_qualification", after: {
          name: conversion.createdAccount.name,
          ownerUserId: conversion.createdAccount.ownerUserId,
          createdByUserId: conversion.createdAccount.createdByUserId,
        } },
      });
    }
    await appendAuditEvent({
      orgId,
      action: "opportunity.created",
      entityType: "opportunity",
      entityId: opp.id,
      ...auditContext(req),
      metadata: { source: "lead_qualification", after: opportunityAudit(opp) },
    });
    await appendAuditEvent({
      orgId,
      action: "lead.updated",
      entityType: "lead",
      entityId: conversion.lead.id,
      ...auditContext(req),
      metadata: {
        operation: "qualify",
        before: leadAudit(conversion.lead),
        after: { ...leadAudit(conversion.lead), status: "qualified", convertedOpportunityId: opp.id },
      },
    });
    await publishAutomationEvent({
      orgId,
      eventKey: `lead-qualified:${conversion.lead.id}:${opp.id}`,
      eventType: "field_change",
      entityType: "lead",
      entityId: conversion.lead.id,
      payload: { field: "status", oldValue: conversion.lead.status, newValue: "qualified" },
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
    res
      .status(201)
      .json(QualifyLeadResponse.parse(await opportunityDetail(opp, req)));
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

async function quoteOut(q: Quote, req: Request) {
  const [canViewOpportunity, canViewAccount] = await Promise.all([
    canAccessCrmRecord(req, "opportunity", q.opportunityId),
    canAccessCrmRecord(req, "account", q.accountId),
  ]);
  const [[opp], [account]] = await Promise.all([
    canViewOpportunity ? db
      .select({ name: opportunities.name })
      .from(opportunities)
      .where(crmRecordCondition(req, "opportunity", q.opportunityId)) : Promise.resolve([]),
    canViewAccount ? db
      .select({ name: accounts.name })
      .from(accounts)
      .where(crmRecordCondition(req, "account", q.accountId)) : Promise.resolve([]),
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

router.get("/orgs/:orgId/quotes", ...gate, async (req, res): Promise<void> => {
  const { opportunityId } = req.query as { opportunityId?: string };
  const where = [eq(quotes.orgId, req.currentOrg!.id)];
  if (opportunityId) where.push(eq(quotes.opportunityId, opportunityId));
  const rows = await db
    .select()
    .from(quotes)
    .where(and(...where))
    .orderBy(desc(quotes.createdAt));
  const visible = await Promise.all(rows.map(async (quote) =>
    (await canAccessCrmRecord(req, "opportunity", quote.opportunityId)
      && await canAccessCrmRecord(req, "account", quote.accountId)) ? quote : undefined,
  ));
  res.json(ListQuotesResponse.parse(await Promise.all(visible.filter((q): q is Quote => Boolean(q)).map((quote) => quoteOut(quote, req)))));
});

router.post("/orgs/:orgId/quotes", ...gate, async (req, res): Promise<void> => {
  const parsed = CreateQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const orgId = req.currentOrg!.id;
  const row = await db.transaction(async (tx) => {
    const [opp] = await tx.select().from(opportunities).where(and(
      eq(opportunities.id, parsed.data.opportunityId),
      eq(opportunities.orgId, orgId),
      ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
    )).for("update");
    if (!opp) return undefined;

    // 2-click quote creation: default a line item from the opportunity value.
    let lineItems = parsed.data.lineItems ?? [];
    if (lineItems.length === 0) {
      lineItems = [{
        name: opp.name,
        description: null,
        quantity: 1,
        unitPrice: opp.value ? Number(opp.value) : 0,
        discountPercent: null,
      }];
    }
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(quotes).where(eq(quotes.orgId, orgId));
    const quoteNumber = `Q-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    const [created] = await tx.insert(quotes).values({
      orgId,
      opportunityId: opp.id,
      accountId: opp.accountId,
      quoteNumber,
      lineItems,
      discountPercent: String(parsed.data.discountPercent ?? 0),
      validUntil: parsed.data.validUntil,
      recipientEmail: parsed.data.recipientEmail,
      notes: parsed.data.notes,
      createdByUserId: req.currentUser!.id,
    }).returning();
    return created;
  });
  if (!row || !(await canAccessCrmRecord(req, "account", row.accountId))) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }
  res.status(201).json(CreateQuoteResponse.parse(await quoteOut(row, req)));
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
  if (
    !row
    || !(await canAccessCrmRecord(req, "opportunity", row.opportunityId))
    || !(await canAccessCrmRecord(req, "account", row.accountId))
  ) return undefined;
  return row;
}

router.get("/orgs/:orgId/quotes/:quoteId", ...gate, async (req, res): Promise<void> => {
  const quote = await findQuote(req);
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  res.json(GetQuoteResponse.parse(await quoteOut(quote, req)));
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
    .where(and(
      eq(quotes.id, quote.id),
      eq(quotes.orgId, req.currentOrg!.id),
      sql`exists (
        select 1 from ${opportunities}
        where ${opportunities.id} = ${quotes.opportunityId}
          and ${opportunities.orgId} = ${req.currentOrg!.id}
          ${hasCrmManagementAccess(req) ? sql`` : sql`and ${opportunities.ownerUserId} is not null and (${opportunities.ownerUserId} = ${req.currentUser!.id} or ${opportunities.createdByUserId} = ${req.currentUser!.id})`}
      )`,
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Quote not found" }); return; }
  res.json(UpdateQuoteResponse.parse(await quoteOut(row, req)));
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
  const [deleted] = await db.delete(quotes).where(and(
    eq(quotes.id, quote.id),
    eq(quotes.orgId, req.currentOrg!.id),
    sql`exists (
      select 1 from ${opportunities}
      where ${opportunities.id} = ${quotes.opportunityId}
        and ${opportunities.orgId} = ${req.currentOrg!.id}
        ${hasCrmManagementAccess(req) ? sql`` : sql`and ${opportunities.ownerUserId} is not null and (${opportunities.ownerUserId} = ${req.currentUser!.id} or ${opportunities.createdByUserId} = ${req.currentUser!.id})`}
    )`,
  )).returning({ id: quotes.id });
  if (!deleted) { res.status(404).json({ error: "Quote not found" }); return; }
  res.status(204).end();
});

async function buildQuotePdf(quote: Quote, orgName: string, req: Request) {
  const [[opp], [account]] = await Promise.all([
    db.select().from(opportunities).where(crmRecordCondition(req, "opportunity", quote.opportunityId)),
    db.select().from(accounts).where(crmRecordCondition(req, "account", quote.accountId)),
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
  const pdf = await buildQuotePdf(quote, req.currentOrg!.name, req);
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
  const pdf = await buildQuotePdf(quote, orgName, req);
  const lineItems = (quote.lineItems ?? []) as QuoteLineItem[];
  const { total } = quoteTotals(lineItems, Number(quote.discountPercent ?? 0));
  const message = parsed.data.message
    ? `<p>${parsed.data.message.replace(/</g, "&lt;")}</p>`
    : "";
  const claimTime = new Date();
  const priorStatus = quote.status;
  const priorSentAt = quote.sentAt;
  const priorRecipient = quote.recipientEmail;
  const [claimed] = await db.update(quotes)
    .set({ status: "sent", sentAt: claimTime, recipientEmail: recipient })
    .where(and(
      eq(quotes.id, quote.id),
      eq(quotes.orgId, req.currentOrg!.id),
      eq(quotes.status, priorStatus),
      priorSentAt ? eq(quotes.sentAt, priorSentAt) : isNull(quotes.sentAt),
      sql`exists (
        select 1 from ${opportunities}
        where ${opportunities.id} = ${quotes.opportunityId}
          and ${opportunities.orgId} = ${req.currentOrg!.id}
          ${hasCrmManagementAccess(req) ? sql`` : sql`and ${opportunities.ownerUserId} is not null and (${opportunities.ownerUserId} = ${req.currentUser!.id} or ${opportunities.createdByUserId} = ${req.currentUser!.id})`}
      )`,
    ))
    .returning();
  if (!claimed) {
    res.status(409).json({ error: "Quote changed or is no longer accessible" });
    return;
  }
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
    await db.update(quotes)
      .set({ status: priorStatus, sentAt: priorSentAt, recipientEmail: priorRecipient })
      .where(and(
        eq(quotes.id, quote.id),
        eq(quotes.orgId, req.currentOrg!.id),
        eq(quotes.status, "sent"),
        eq(quotes.sentAt, claimTime),
      ));
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  res.json(SendQuoteResponse.parse(await quoteOut(claimed, req)));
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
    .where(and(
      eq(quotes.id, quote.id),
      eq(quotes.orgId, req.currentOrg!.id),
      eq(quotes.status, "sent"),
      sql`exists (
        select 1 from ${opportunities}
        where ${opportunities.id} = ${quotes.opportunityId}
          and ${opportunities.orgId} = ${req.currentOrg!.id}
          ${hasCrmManagementAccess(req) ? sql`` : sql`and ${opportunities.ownerUserId} is not null and (${opportunities.ownerUserId} = ${req.currentUser!.id} or ${opportunities.createdByUserId} = ${req.currentUser!.id})`}
      )`,
    ))
    .returning();
  if (!row) {
    res.status(409).json({ error: "Quote changed or is no longer accessible" });
    return;
  }
  res.json(AcceptQuoteResponse.parse(await quoteOut(row, req)));
});

/* ------------------------------ territories ------------------------------ */

async function territoryOut(t: Territory) {
  const owner = t.ownerUserId
    ? await db
        .select({ fullName: users.fullName, email: users.email })
        .from(users)
        .innerJoin(orgUsers, eq(orgUsers.userId, users.id))
        .where(and(
          eq(users.id, t.ownerUserId),
          eq(orgUsers.orgId, t.orgId),
        ))
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
        .where(and(
          eq(accounts.orgId, orgId),
          eq(accounts.isActive, true),
          ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
        )),
      db
        .select({
          accountId: opportunities.accountId,
          value: opportunities.value,
          forecastCategory: opportunities.forecastCategory,
        })
        .from(opportunities)
        .where(and(
          eq(opportunities.orgId, orgId),
          ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        )),
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
              .innerJoin(orgUsers, eq(orgUsers.userId, users.id))
              .where(and(
                eq(users.id, t.ownerUserId),
                eq(orgUsers.orgId, t.orgId),
              ))
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
  where.push(...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId));
  if (ownerUserId) where.push(eq(opportunities.ownerUserId, ownerUserId));
  const rows = await db
    .select()
    .from(opportunities)
    .where(and(...where));
  const visibleRows = await visibleOpportunities(req, rows);

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

  for (const o of visibleRows) {
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

/** Probability-weighted revenue outlook. Always bounded to the next 90 days. */
router.get("/orgs/:orgId/forecast/weighted", ...gate, async (req, res): Promise<void> => {
  const groupBy = (req.query as { groupBy?: string }).groupBy === "monthly" ? "monthly" : "weekly";
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 90);
  const buckets = new Map<string, { periodStart: string; weightedRevenue: number; opportunityCount: number }>();
  const bucketFor = (date: Date) => {
    const d = new Date(date);
    if (groupBy === "monthly") d.setUTCDate(1);
    else {
      const weekday = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() - weekday + 1);
    }
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = bucketFor(d);
    if (!buckets.has(key)) buckets.set(key, { periodStart: key, weightedRevenue: 0, opportunityCount: 0 });
  }
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const rows = await db
    .select({
      accountId: opportunities.accountId,
      expectedCloseDate: opportunities.expectedCloseDate,
      forecastCategory: opportunities.forecastCategory,
      probability: opportunities.probability,
      value: opportunities.value,
    })
    .from(opportunities)
    .where(and(
      eq(opportunities.orgId, req.currentOrg!.id),
      ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
      gte(opportunities.expectedCloseDate, startDate),
      lt(opportunities.expectedCloseDate, endDate),
    ));
  const visibleRows = await Promise.all(
    rows.map(async (opportunity) =>
      (await canAccessCrmRecord(req, "account", opportunity.accountId))
        ? opportunity
        : undefined,
    ),
  );
  for (const opportunity of visibleRows) {
    if (!opportunity) continue;
    if (opportunity.forecastCategory === "closed_lost" || !opportunity.expectedCloseDate) continue;
    const close = new Date(`${opportunity.expectedCloseDate}T00:00:00.000Z`);
    if (close < start || close >= end) continue;
    const bucket = buckets.get(bucketFor(close));
    if (!bucket) continue;
    const probability = opportunity.forecastCategory === "closed_won" ? 100 : (opportunity.probability ?? 0);
    bucket.weightedRevenue += (Number(opportunity.value ?? 0) * probability) / 100;
    bucket.opportunityCount += 1;
  }
  res.json({
    horizonDays: 90,
    groupBy,
    periods: [...buckets.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).map((bucket) => ({
      ...bucket,
      weightedRevenue: Math.round(bucket.weightedRevenue * 100) / 100,
    })),
  });
});

export default router;
