import { Router, type IRouter } from "express";
import { count, desc, eq } from "drizzle-orm";
import {
  db,
  accounts,
  opportunities,
  orgUsers,
  usageLogs,
  users,
} from "@workspace/db";
import {
  GetOrgDashboardResponse,
  ListUsageLogsResponse,
} from "@workspace/api-zod";
import { attachUser, attachOrg } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/orgs/:orgId/dashboard", attachUser, attachOrg);
router.use("/orgs/:orgId/usage", attachUser, attachOrg);

async function recentActivity(orgId: string, limit: number) {
  const rows = await db
    .select({ log: usageLogs, userEmail: users.email })
    .from(usageLogs)
    .leftJoin(users, eq(users.id, usageLogs.userId))
    .where(eq(usageLogs.orgId, orgId))
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.log.id,
    featureKey: r.log.featureKey,
    action: r.log.action,
    userEmail: r.userEmail,
    createdAt: r.log.createdAt.toISOString(),
  }));
}

router.get("/orgs/:orgId/dashboard", async (req, res): Promise<void> => {
  const org = req.currentOrg!;
  const [[members], [accountCount], [oppCount], activity] = await Promise.all([
    db.select({ value: count() }).from(orgUsers).where(eq(orgUsers.orgId, org.id)),
    db.select({ value: count() }).from(accounts).where(eq(accounts.orgId, org.id)),
    db
      .select({ value: count() })
      .from(opportunities)
      .where(eq(opportunities.orgId, org.id)),
    recentActivity(org.id, 10),
  ]);

  res.json(
    GetOrgDashboardResponse.parse({
      orgId: org.id,
      plan: org.plan,
      memberCount: members.value,
      enabledFeatureCount: org.enabledFeatures.length,
      enabledFeatures: org.enabledFeatures,
      accountCount: accountCount.value,
      opportunityCount: oppCount.value,
      recentActivity: activity,
    }),
  );
});

router.get("/orgs/:orgId/usage", async (req, res): Promise<void> => {
  res.json(
    ListUsageLogsResponse.parse(await recentActivity(req.currentOrg!.id, 50)),
  );
});

export default router;
