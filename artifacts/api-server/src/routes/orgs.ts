import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  featureEntitlements,
  organizations,
  orgUsers,
  users,
} from "@workspace/db";
import {
  GetOrgResponse,
  UpdateOrgBody,
  UpdateOrgResponse,
  ListMembersResponse,
  InviteMemberBody,
  InviteMemberResponse,
  UpdateMemberRoleBody,
  UpdateMemberRoleResponse,
  ListFeaturesResponse,
  UpdateFeaturesBody,
  UpdateFeaturesResponse,
} from "@workspace/api-zod";
import {
  attachUser,
  attachOrg,
  requireRole,
} from "../middlewares/auth";
import { serializeOrg } from "./auth";
import { FEATURE_KEYS, featuresForPlan } from "../lib/catalog";

const router: IRouter = Router();

router.use("/orgs/:orgId", attachUser, attachOrg);

router.get("/orgs/:orgId", async (req, res): Promise<void> => {
  res.json(GetOrgResponse.parse(serializeOrg(req.currentOrg!)));
});

router.patch(
  "/orgs/:orgId",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateOrgBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const org = req.currentOrg!;
    const updates: Partial<typeof organizations.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.plan !== undefined) {
      updates.plan = parsed.data.plan;
      if (parsed.data.plan !== "custom") {
        updates.enabledFeatures = featuresForPlan(parsed.data.plan);
      }
    }
    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, org.id))
      .returning();
    if (updates.enabledFeatures) {
      await syncEntitlements(org.id, updates.enabledFeatures);
    }
    res.json(UpdateOrgResponse.parse(serializeOrg(updated)));
  },
);

// ----- Members -----

router.get("/orgs/:orgId/members", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: orgUsers.id,
      role: orgUsers.role,
      createdAt: orgUsers.createdAt,
      user: users,
    })
    .from(orgUsers)
    .innerJoin(users, eq(users.id, orgUsers.userId))
    .where(eq(orgUsers.orgId, req.currentOrg!.id));

  res.json(
    ListMembersResponse.parse(
      rows.map((r) => ({
        id: r.id,
        role: r.role,
        createdAt: r.createdAt.toISOString(),
        user: {
          id: r.user.id,
          clerkId: r.user.clerkId,
          email: r.user.email,
          fullName: r.user.fullName,
        },
      })),
    ),
  );
});

router.post(
  "/orgs/:orgId/members",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = InviteMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const email = parsed.data.email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }
    const org = req.currentOrg!;

    let [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      // Pre-provision a pending user; clerkId is linked on their first sign-in.
      [user] = await db
        .insert(users)
        .values({
          clerkId: `pending:${email}`,
          email,
          fullName: parsed.data.fullName ?? null,
        })
        .returning();
    }

    const [existing] = await db
      .select()
      .from(orgUsers)
      .where(and(eq(orgUsers.orgId, org.id), eq(orgUsers.userId, user.id)));
    if (existing) {
      res.status(400).json({ error: "User is already a member" });
      return;
    }

    const [membership] = await db
      .insert(orgUsers)
      .values({ orgId: org.id, userId: user.id, role: parsed.data.role })
      .returning();

    res.status(201).json(
      InviteMemberResponse.parse({
        id: membership.id,
        role: membership.role,
        createdAt: membership.createdAt.toISOString(),
        user: {
          id: user.id,
          clerkId: user.clerkId,
          email: user.email,
          fullName: user.fullName,
        },
      }),
    );
  },
);

router.patch(
  "/orgs/:orgId/members/:memberId",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateMemberRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const memberId = Array.isArray(req.params.memberId)
      ? req.params.memberId[0]
      : req.params.memberId;

    const [membership] = await db
      .select()
      .from(orgUsers)
      .where(
        and(eq(orgUsers.id, memberId), eq(orgUsers.orgId, req.currentOrg!.id)),
      );
    if (!membership) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (membership.role === "owner" && parsed.data.role !== "owner") {
      const owners = await db
        .select()
        .from(orgUsers)
        .where(
          and(
            eq(orgUsers.orgId, req.currentOrg!.id),
            eq(orgUsers.role, "owner"),
          ),
        );
      if (owners.length <= 1) {
        res.status(400).json({ error: "Cannot demote the last owner" });
        return;
      }
    }

    const [updated] = await db
      .update(orgUsers)
      .set({ role: parsed.data.role })
      .where(eq(orgUsers.id, membership.id))
      .returning();

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, updated.userId));

    res.json(
      UpdateMemberRoleResponse.parse({
        id: updated.id,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
        user: {
          id: user.id,
          clerkId: user.clerkId,
          email: user.email,
          fullName: user.fullName,
        },
      }),
    );
  },
);

router.delete(
  "/orgs/:orgId/members/:memberId",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const memberId = Array.isArray(req.params.memberId)
      ? req.params.memberId[0]
      : req.params.memberId;
    const [membership] = await db
      .select()
      .from(orgUsers)
      .where(
        and(eq(orgUsers.id, memberId), eq(orgUsers.orgId, req.currentOrg!.id)),
      );
    if (!membership) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (membership.role === "owner") {
      res.status(400).json({ error: "Cannot remove an owner" });
      return;
    }
    await db.delete(orgUsers).where(eq(orgUsers.id, membership.id));
    res.sendStatus(204);
  },
);

// ----- Features -----

router.get("/orgs/:orgId/features", async (req, res): Promise<void> => {
  const org = req.currentOrg!;
  res.json(
    ListFeaturesResponse.parse(
      FEATURE_KEYS.map((featureKey) => ({
        featureKey,
        enabled: org.enabledFeatures.includes(featureKey),
      })),
    ),
  );
});

router.put(
  "/orgs/:orgId/features",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateFeaturesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const invalid = parsed.data.features.filter(
      (f) => !FEATURE_KEYS.includes(f),
    );
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown features: ${invalid.join(", ")}` });
      return;
    }
    const features = [...new Set(parsed.data.features)];
    const [updated] = await db
      .update(organizations)
      .set({ enabledFeatures: features, plan: "custom" })
      .where(eq(organizations.id, req.currentOrg!.id))
      .returning();
    await syncEntitlements(updated.id, features);
    res.json(UpdateFeaturesResponse.parse(serializeOrg(updated)));
  },
);

async function syncEntitlements(orgId: string, features: string[]) {
  await db
    .delete(featureEntitlements)
    .where(eq(featureEntitlements.orgId, orgId));
  if (features.length > 0) {
    await db
      .insert(featureEntitlements)
      .values(features.map((featureKey) => ({ orgId, featureKey, enabled: true })));
  }
}

export default router;
