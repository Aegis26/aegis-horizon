import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, accounts, opportunities, workflows } from "@workspace/db";
import {
  ListAccountsResponse,
  ListOpportunitiesResponse,
  ListWorkflowsResponse,
} from "@workspace/api-zod";
import {
  attachUser,
  attachOrg,
  requireFeature,
} from "../middlewares/auth";

const router: IRouter = Router();

router.get(
  "/orgs/:orgId/accounts",
  attachUser,
  attachOrg,
  requireFeature("crm"),
  async (req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.orgId, req.currentOrg!.id))
      .orderBy(desc(accounts.createdAt));
    res.json(
      ListAccountsResponse.parse(
        rows.map((a) => ({
          id: a.id,
          name: a.name,
          industry: a.industry,
          website: a.website,
          city: a.city,
          state: a.state,
          healthScore: a.healthScore,
          riskLevel: a.riskLevel,
          createdAt: a.createdAt.toISOString(),
        })),
      ),
    );
  },
);

router.get(
  "/orgs/:orgId/opportunities",
  attachUser,
  attachOrg,
  requireFeature("sales"),
  async (req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.orgId, req.currentOrg!.id))
      .orderBy(desc(opportunities.createdAt));
    res.json(
      ListOpportunitiesResponse.parse(
        rows.map((o) => ({
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
      ),
    );
  },
);

router.get(
  "/orgs/:orgId/workflows",
  attachUser,
  attachOrg,
  requireFeature("automation"),
  async (req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.orgId, req.currentOrg!.id));
    res.json(
      ListWorkflowsResponse.parse(
        rows.map((w) => ({ id: w.id, createdAt: w.createdAt.toISOString() })),
      ),
    );
  },
);

export default router;
