import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, organizations, orgUsers } from "@workspace/db";
import { GetMeResponse } from "@workspace/api-zod";
import { attachUser } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/auth/me", attachUser, async (req, res): Promise<void> => {
  const user = req.currentUser!;

  const memberships = await db
    .select()
    .from(orgUsers)
    .where(eq(orgUsers.userId, user.id));

  const orgs =
    memberships.length > 0
      ? await db
          .select()
          .from(organizations)
          .where(
            inArray(
              organizations.id,
              memberships.map((m) => m.orgId),
            ),
          )
      : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  res.json(
    GetMeResponse.parse({
      user: {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        fullName: user.fullName,
      },
      orgs: memberships
        .filter((m) => orgById.has(m.orgId))
        .map((m) => ({
          org: serializeOrg(orgById.get(m.orgId)!),
          role: m.role,
        })),
    }),
  );
});

export function serializeOrg(org: typeof organizations.$inferSelect) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    enabledFeatures: org.enabledFeatures,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    createdAt: org.createdAt.toISOString(),
  };
}

export default router;
