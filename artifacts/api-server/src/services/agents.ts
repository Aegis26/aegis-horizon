import { and, eq, ilike } from "drizzle-orm";
import {
  accounts,
  agentExecutions,
  aiAgents,
  aiRecommendations,
  db,
  leads,
  opportunities,
  organizations,
  opportunityStageHistory,
  pipelines,
  tasks,
} from "@workspace/db";
import { AiConsentError, callClaude, getAiBudgetStatus, parseClaudeJson } from "./claude";

export async function ensureLeadQualifierAgent(orgId: string, userId: string) {
  const [existing] = await db.select().from(aiAgents).where(and(eq(aiAgents.orgId, orgId), eq(aiAgents.type, "lead_qualifier")));
  if (existing) return existing;
  const [created] = await db.insert(aiAgents).values({
    orgId, createdBy: userId, name: "Lead Qualifier", type: "lead_qualifier", active: true,
    executionFrequency: "realtime", tools: ["create_opportunity", "draft_email", "schedule_task"],
    config: { qualificationThreshold: 50, followUpDays: 2 },
    systemPrompt: "Qualify leads using CRM facts. Draft outreach but never send it. Return concise recommendations.",
  }).returning();
  return created;
}

function leadFitScore(lead: typeof leads.$inferSelect) {
  let score = lead.score ?? 0;
  const factors: string[] = [];
  if ((lead.companySize ?? 0) >= 10 && (lead.companySize ?? 0) <= 1000) { score += 25; factors.push("company size fits ICP"); }
  if (["tech", "technology", "k-12", "education", "healthcare", "finance"].includes((lead.industry ?? "").toLowerCase())) { score += 25; factors.push("industry fits ICP"); }
  if ((lead.intentScore ?? 0) >= 60) { score += 30; factors.push("high intent"); }
  if (lead.email) { score += 10; factors.push("email available"); }
  return { score: Math.min(100, score), factors };
}

export async function runAgent(orgId: string, agentId: string, entityType: string, entityId: string, actorUserId: string, key?: string) {
  const [agent] = await db.select().from(aiAgents).where(and(eq(aiAgents.orgId, orgId), eq(aiAgents.id, agentId)));
  if (!agent) throw new Error("Agent not found");
  if (!agent.active) throw new Error("Agent is inactive");
  const idempotencyKey = key ?? `manual:${agent.id}:${entityType}:${entityId}:${new Date().toISOString()}`;
  const [execution] = await db.insert(agentExecutions).values({
    orgId, agentId: agent.id, idempotencyKey, entityType, entityId, status: "running",
    input: { entityType, entityId },
  }).onConflictDoNothing().returning();
  if (!execution) return db.select().from(agentExecutions).where(and(eq(agentExecutions.orgId, orgId), eq(agentExecutions.idempotencyKey, idempotencyKey))).then((r) => r[0]);
  try {
    // This guard is deliberately inside the execution lifecycle so denied
    // manual and automatic attempts are auditable, before any CRM mutation.
    await assertAgentAiAccess(orgId);
    if (agent.type === "lead_qualifier") return await runLeadQualifier(agent, execution.id, entityType, entityId, actorUserId);
    if (agent.type === "follow_up_sequencer") return await runFollowUp(agent, execution.id, entityType, entityId, actorUserId);
    if (agent.type === "renewal_monitor") return await runRenewalMonitor(agent, execution.id, entityType, entityId, actorUserId);
    throw new Error("Unsupported agent type");
  } catch (error) {
    await db.update(agentExecutions).set({ status: "failed", output: (error as Error).message, completedAt: new Date() }).where(eq(agentExecutions.id, execution.id));
    throw error;
  }
}

function accessError(message: string) {
  return Object.assign(new Error(message), { status: 403 });
}

export async function assertAgentAiAccess(orgId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org?.enabledFeatures.includes("ai_copilot")) throw accessError("AI Copilot is not enabled for this organization");
  const budget = await getAiBudgetStatus(orgId);
  if (!budget.consentEnabled) throw new AiConsentError();
  // callClaude reserves the exact conservative request amount atomically. A
  // zero balance can be rejected here without touching CRM records.
  if (budget.remaining < 100) {
    const error = Object.assign(new Error("Organization monthly AI token budget is exhausted"), { status: 429 });
    throw error;
  }
}

async function runLeadQualifier(agent: typeof aiAgents.$inferSelect, executionId: string, entityType: string, entityId: string, actorUserId: string) {
  if (entityType !== "lead") throw new Error("Lead qualifier requires a lead");
  const [lead] = await db.select().from(leads).where(and(eq(leads.orgId, agent.orgId), eq(leads.id, entityId)));
  if (!lead) throw new Error("Lead not found");
  const config = agent.config as Record<string, unknown>;
  const fit = leadFitScore(lead);
  const threshold = Number(config.qualificationThreshold ?? 50);
  const { text: plannedText, tokensUsed } = await callClaude({
    orgId: agent.orgId, userId: actorUserId, purpose: "agent_lead_qualification_plan", maxTokens: 700,
    system: "Return JSON only: {\"qualify\":boolean,\"score\":number,\"createOpportunity\":boolean,\"scheduleFollowUp\":boolean,\"draft\":string|null,\"rationale\":string}. Use supplied CRM facts. score must be 0-100. Drafts are editable only; never send email.",
    prompt: JSON.stringify({ lead: { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, title: lead.title, industry: lead.industry, intentScore: lead.intentScore, score: lead.score }, heuristicScore: fit.score, threshold, factors: fit.factors }),
  });
  const plan = parseClaudeJson<{ qualify?: unknown; score?: unknown; createOpportunity?: unknown; scheduleFollowUp?: unknown; draft?: unknown; rationale?: unknown }>(plannedText);
  if (typeof plan.qualify !== "boolean" || typeof plan.score !== "number" || !Number.isFinite(plan.score) || plan.score < 0 || plan.score > 100
    || typeof plan.createOpportunity !== "boolean" || typeof plan.scheduleFollowUp !== "boolean"
    || (plan.draft !== null && typeof plan.draft !== "string") || typeof plan.rationale !== "string" || plan.rationale.length > 500) {
    throw new Error("Agent planning response did not match the allowed lead decision schema");
  }
  const outreachDraft = typeof plan.draft === "string" ? plan.draft.trim() : "";
  const qualified = plan.qualify && plan.score >= threshold;
  const actions: Record<string, unknown>[] = [{ action: "score_lead", score: fit.score, status: "success" }];
  // Claude completed and its bounded decision was validated before this first mutation.
  await db.update(leads).set({ score: Math.round(plan.score), status: qualified ? "qualified" : "working" }).where(eq(leads.id, lead.id));
  if (qualified && plan.createOpportunity && !lead.convertedOpportunityId) {
    const companyName = lead.company ?? `${lead.firstName} ${lead.lastName}`;
    let [account] = await db.select().from(accounts).where(and(eq(accounts.orgId, agent.orgId), ilike(accounts.name, companyName)));
    if (!account) [account] = await db.insert(accounts).values({
      orgId: agent.orgId, name: companyName, industry: lead.industry, employeeCount: lead.companySize,
      ownerUserId: lead.assignedToUserId ?? actorUserId,
    }).returning();
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.orgId, agent.orgId));
    const firstStage = ((pipeline?.stages ?? []) as { key: string; probability: number; forecastCategory: string }[])[0];
    const [opportunity] = await db.insert(opportunities).values({
      orgId: agent.orgId, accountId: account.id, name: `${companyName} - New Business`,
      pipelineId: pipeline?.id, stage: firstStage?.key ?? "prospecting", probability: firstStage?.probability ?? 10,
      forecastCategory: firstStage?.forecastCategory ?? "pipeline", ownerUserId: lead.assignedToUserId ?? actorUserId,
    }).returning();
    await db.insert(opportunityStageHistory).values({
      orgId: agent.orgId, opportunityId: opportunity.id, fromStage: null,
      toStage: opportunity.stage, changedByUserId: actorUserId,
    });
    await db.update(leads).set({ convertedOpportunityId: opportunity.id }).where(eq(leads.id, lead.id));
    actions.push({ action: "create_opportunity", opportunityId: opportunity.id, status: "success" });
    if (outreachDraft) {
      const [recommendation] = await db.insert(aiRecommendations).values({
        orgId: agent.orgId, userId: lead.assignedToUserId ?? actorUserId, accountId: account.id,
        opportunityId: opportunity.id, type: "email_draft", title: `Outreach draft for ${lead.firstName}`,
        description: outreachDraft, suggestedAction: "Review, edit, and send manually.", confidence: "0.750",
        source: "agent", sourceKey: `agent:${agent.id}:lead:${lead.id}:outreach`,
      }).onConflictDoNothing().returning();
      actions.push({ action: "draft_email", recommendationId: recommendation?.id ?? null, status: "success", sent: false });
    }
    if (plan.scheduleFollowUp) {
      const due = new Date(Date.now() + Number(config.followUpDays ?? 2) * 86400000).toISOString().slice(0, 10);
      const [task] = await db.insert(tasks).values({
        orgId: agent.orgId, accountId: account.id, opportunityId: opportunity.id,
        title: "Follow up", type: "follow_up", dueDate: due,
        assignedToUserId: lead.assignedToUserId ?? actorUserId, createdByUserId: actorUserId,
        description: `Follow up with ${lead.firstName} ${lead.lastName}.`,
      }).returning();
      actions.push({ action: "schedule_task", taskId: task.id, status: "success" });
    }
  }
  const rationale = qualified
    ? `Qualified at ${Math.round(plan.score)}/${threshold}: ${plan.rationale}`
    : `Not qualified: ${plan.rationale}`;
  const [done] = await db.update(agentExecutions).set({
    status: "success", decisionRationale: rationale, actions,
    output: qualified ? "Lead qualified and safe follow-up actions completed." : "Lead scored; no conversion actions were taken.",
    tokensUsed, completedAt: new Date(),
  }).where(eq(agentExecutions.id, executionId)).returning();
  return done;
}

async function runFollowUp(agent: typeof aiAgents.$inferSelect, executionId: string, entityType: string, entityId: string, actorUserId: string) {
  if (entityType !== "lead") throw new Error("Follow-up sequencer requires a lead");
  const [lead] = await db.select().from(leads).where(and(eq(leads.orgId, agent.orgId), eq(leads.id, entityId)));
  if (!lead) throw new Error("Lead not found");
  const { text, tokensUsed } = await callClaude({
    orgId: agent.orgId, userId: actorUserId, purpose: "agent_follow_up_plan", maxTokens: 600,
    system: "Return JSON only: {\"createDraft\":boolean,\"draft\":string|null,\"rationale\":string}. Drafts are editable only; never send email.",
    prompt: JSON.stringify({ firstName: lead.firstName, company: lead.company, interest: lead.productInterest }),
  });
  const plan = parseClaudeJson<{ createDraft?: unknown; draft?: unknown; rationale?: unknown }>(text);
  if (typeof plan.createDraft !== "boolean" || (plan.draft !== null && typeof plan.draft !== "string")
    || typeof plan.rationale !== "string" || plan.rationale.length > 500) {
    throw new Error("Agent planning response did not match the allowed follow-up decision schema");
  }
  const followUpDraft = typeof plan.draft === "string" ? plan.draft.trim() : "";
  // Planning/validation precedes the recommendation write.
  const actions: Record<string, unknown>[] = [];
  if (plan.createDraft && followUpDraft) {
    const [recommendation] = await db.insert(aiRecommendations).values({
      orgId: agent.orgId, userId: lead.assignedToUserId ?? actorUserId,
      type: "email_draft", title: `Follow-up draft for ${lead.firstName}`, description: followUpDraft,
      suggestedAction: "Review, edit, and send manually.", confidence: "0.700", source: "agent",
      sourceKey: `agent:${agent.id}:follow-up:${lead.id}`,
    }).onConflictDoNothing().returning();
    actions.push({ action: "draft_email", recommendationId: recommendation?.id ?? null, sent: false, status: "success" });
  }
  const [done] = await db.update(agentExecutions).set({
    status: "success", decisionRationale: plan.rationale,
    actions, output: actions.length ? "Follow-up draft created; human review and sending are required." : "No follow-up draft was recommended.", tokensUsed, completedAt: new Date(),
  }).where(eq(agentExecutions.id, executionId)).returning();
  return done;
}

async function runRenewalMonitor(agent: typeof aiAgents.$inferSelect, executionId: string, entityType: string, entityId: string, actorUserId: string) {
  if (entityType !== "account") throw new Error("Renewal monitor requires an account");
  const [account] = await db.select().from(accounts).where(and(eq(accounts.orgId, agent.orgId), eq(accounts.id, entityId)));
  if (!account) throw new Error("Account not found");
  const days = account.nextRenewalDate
    ? Math.ceil((new Date(`${account.nextRenewalDate}T00:00:00Z`).getTime() - Date.now()) / 86400000)
    : null;
  const { text, tokensUsed } = await callClaude({
    orgId: agent.orgId, userId: actorUserId, purpose: "agent_renewal_plan", maxTokens: 400,
    system: "Return JSON only: {\"createRecommendation\":boolean,\"rationale\":string}. Only recommend a renewal review when justified. Never contact customers.",
    prompt: JSON.stringify({ account: { name: account.name, nextRenewalDate: account.nextRenewalDate }, daysUntilRenewal: days }),
  });
  const plan = parseClaudeJson<{ createRecommendation?: unknown; rationale?: unknown }>(text);
  if (typeof plan.createRecommendation !== "boolean" || typeof plan.rationale !== "string" || plan.rationale.length > 500) {
    throw new Error("Agent planning response did not match the allowed renewal decision schema");
  }
  const actions: Record<string, unknown>[] = [];
  // Planning/validation precedes the recommendation write and the date bound
  // prevents an otherwise-valid model response from expanding the action scope.
  if (plan.createRecommendation && days !== null && days >= 0 && days <= 60) {
    const [recommendation] = await db.insert(aiRecommendations).values({
      orgId: agent.orgId, userId: account.ownerUserId ?? actorUserId, accountId: account.id,
      type: "risk_alert", title: `Renewal due in ${days} days`,
      description: `${account.name} has an upcoming renewal.`, suggestedAction: "Schedule a renewal review.",
      confidence: "0.900", source: "agent", sourceKey: `agent:${agent.id}:renewal:${account.id}:${account.nextRenewalDate}`,
    }).onConflictDoNothing().returning();
    actions.push({ action: "create_recommendation", recommendationId: recommendation?.id ?? null });
  }
  const [done] = await db.update(agentExecutions).set({
    status: "success", decisionRationale: plan.rationale, actions,
    output: actions.length ? "Renewal recommendation created." : "No renewal action was due.",
    tokensUsed, completedAt: new Date(),
  }).where(eq(agentExecutions.id, executionId)).returning();
  return done;
}

export async function processNewLead(orgId: string, leadId: string, actorUserId: string) {
  const [agent] = await db.select().from(aiAgents).where(and(
    eq(aiAgents.orgId, orgId), eq(aiAgents.type, "lead_qualifier"), eq(aiAgents.active, true),
  ));
  if (!agent || agent.executionFrequency !== "realtime") return;
  // Do not create a default agent or attempt a run for organizations without
  // access. runAgent performs the same guard again immediately before planning.
  try { await assertAgentAiAccess(orgId); } catch { return; }
  return runAgent(orgId, agent.id, "lead", leadId, actorUserId, `lead-created:${agent.id}:${leadId}`);
}