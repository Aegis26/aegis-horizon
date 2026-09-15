import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  accountDeletionLedger,
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
  ResendMemberInviteResponse,
  UpdateMemberRoleBody,
  UpdateMemberRoleResponse,
  ListFeaturesResponse,
  UpdateFeaturesBody,
  UpdateFeaturesResponse,
  DeleteOrganizationBody,
  DeleteOrganizationResponse,
} from "@workspace/api-zod";
import {
  attachUser,
  attachOrg,
  isAccountDeletionActive,
  requireRole,
} from "../middlewares/auth";
import { serializeOrg } from "./auth";
import { FEATURE_KEYS, featuresForPlan } from "../lib/catalog";
import { sendInvitationEmail } from "../lib/email";
import {
  createInvitationToken,
  invitationLink,
} from "../lib/invitations";
import { logger } from "../lib/logger";
import {
  deleteOrganization,
  OrganizationDeletionError,
} from "../services/orgDeletion";
import { removeEmployeeCommissionForMembership } from "../services/commissions";
import { effectiveMemberDisplayName } from "../lib/memberDisplayName";

const router: IRouter = Router();

router.use("/orgs/:orgId", attachUser, attachOrg);

const INVITATION_DELIVERY_FAILURE_MESSAGE =
  "The member was added, but the invitation email could not be delivered. Use Resend invitation to try again.";

async function deliverInvitation(args: {
  membershipId: string;
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
}) {
  try {
    const token = createInvitationToken({
      membershipId: args.membershipId,
      userId: args.userId,
      orgId: args.orgId,
      email: args.email.toLowerCase(),
    });
    await sendInvitationEmail(
      args.email,
      args.orgName,
      invitationLink(token),
    );
    return { status: "sent" as const, message: null };
  } catch {
    // Keep the pre-provisioned membership. Delivery can be retried from
    // Settings, and neither the token nor the recipient address is logged.
    logger.warn(
      { invitationDelivery: "failed" },
      "Invitation email delivery failed",
    );
    return {
      status: "failed" as const,
      message: INVITATION_DELIVERY_FAILURE_MESSAGE,
    };
  }
}

function memberResponse(
  membership: typeof orgUsers.$inferSelect,
  user: typeof users.$inferSelect,
) {
  return {
    id: membership.id,
    role: membership.role,
    displayName: effectiveMemberDisplayName(membership, user),
    createdAt: membership.createdAt.toISOString(),
    user: {
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      fullName: user.fullName,
    },
  };
}

router.get("/orgs/:orgId", async (req, res): Promise<void> => {
  res.json(GetOrgResponse.parse(serializeOrg(req.currentOrg!)));
});

async function handleOrganizationDeletion(
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = DeleteOrganizationBody.safeParse(req.body);
  if (
    !parsed.success ||
    !req.body ||
    typeof req.body !== "object" ||
    Object.keys(req.body).length !== 1
  ) {
    res.status(400).json({ error: 'Type "DELETE" in the confirmation field' });
    return;
  }

  if (req.organizationDeletionCompleted) {
    res.json(DeleteOrganizationResponse.parse({ success: true }));
    return;
  }

  try {
    await deleteOrganization(req.params.orgId as string, req.currentUser!.id);
    res.json(DeleteOrganizationResponse.parse({ success: true }));
  } catch (error) {
    if (!(error instanceof OrganizationDeletionError)) throw error;
    if (error.code === "not_found") {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    if (error.code === "forbidden") {
      res.status(403).json({ error: "Only the organization owner can delete" });
      return;
    }
    if (error.code === "in_progress") {
      res.status(409).json({ error: "Organization deletion is already in progress" });
      return;
    }
    if (error.code === "relational_delete_failed") {
      res.status(500).json({
        error: "Organization deletion was not completed. Retry is safe.",
      });
      return;
    }
    res.status(502).json({
      error: "Organization deletion was not completed. Retry is safe.",
    });
  }
}

// Canonical route. The org router middleware has already attached the user and
// organization context; requireRole("owner") is an exact owner-only gate.
router.delete(
  "/orgs/:orgId",
  requireRole("owner"),
  handleOrganizationDeletion,
);

// Compatibility alias for clients using the long-form resource name.
router.delete(
  "/organizations/:orgId",
  attachUser,
  attachOrg,
  requireRole("owner"),
  handleOrganizationDeletion,
);

router.patch(
  "/orgs/:orgId",
  requireRole("owner"),
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
      displayName: orgUsers.displayName,
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
        displayName: effectiveMemberDisplayName(r, r.user),
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
  requireRole("owner"),
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
    const requestedDisplayName =
      parsed.data.displayName?.trim() || parsed.data.fullName?.trim() || null;
    if (requestedDisplayName && requestedDisplayName.length > 120) {
      res.status(400).json({ error: "Display name must be 120 characters or fewer" });
      return;
    }

    let [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      // Pre-provision a local user; clerkId is linked on their first sign-in.
      [user] = await db
        .insert(users)
        .values({
          clerkId: `pending:${email}`,
          email,
          // Keep the original fullName field populated for compatibility with
          // existing invite consumers. The workspace override below remains
          // the source of truth for this organization's display.
          fullName: requestedDisplayName,
        })
        .returning();
    }
    if (await isAccountDeletionActive(user.id)) {
      res.status(409).json({ error: "This account is being deleted" });
      return;
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
      .values({
        orgId: org.id,
        userId: user.id,
        role: parsed.data.role,
        displayName: requestedDisplayName,
      })
      .returning();
    const delivery = await deliverInvitation({
      membershipId: membership.id,
      userId: user.id,
      email: user.email,
      orgId: org.id,
      orgName: org.name,
    });

    res.status(201).json(
      InviteMemberResponse.parse({
        ...memberResponse(membership, user),
        delivery,
      }),
    );
  },
);

router.post(
  "/orgs/:orgId/members/:memberId/resend-invite",
  requireRole("owner"),
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
      res.status(400).json({ error: "Owners do not need an invitation" });
      return;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, membership.userId));
    if (!user) {
      res.status(404).json({ error: "Member user not found" });
      return;
    }

    const delivery = await deliverInvitation({
      membershipId: membership.id,
      userId: user.id,
      email: user.email,
      orgId: req.currentOrg!.id,
      orgName: req.currentOrg!.name,
    });
    res.json(
      ResendMemberInviteResponse.parse({
        ...memberResponse(membership, user),
        delivery,
      }),
    );
  },
);

router.patch(
  "/orgs/:orgId/members/:memberId",
  requireRole("owner"),
  async (req, res): Promise<void> => {
    const parsed = UpdateMemberRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.role === undefined && parsed.data.displayName === undefined) {
      res.status(400).json({ error: "At least one member field must be provided" });
      return;
    }
    const requestedDisplayName =
      parsed.data.displayName === null
        ? null
        : parsed.data.displayName?.trim();
    if (
      parsed.data.displayName !== undefined &&
      requestedDisplayName !== null &&
      (requestedDisplayName === undefined ||
        requestedDisplayName.length < 1 ||
        requestedDisplayName.length > 120)
    ) {
      res.status(400).json({ error: "Display name must be between 1 and 120 characters" });
      return;
    }
    const memberId = Array.isArray(req.params.memberId)
      ? req.params.memberId[0]
      : req.params.memberId;

    const result = await db.transaction(async (tx) => {
      // Lock the target user before checking its deletion ledger and writing
      // membership state. Account deletion takes this same user-row lock
      // before its final ownership recheck, preventing a grant from slipping
      // between that check and local purge.
      const [membership] = await tx
        .select()
        .from(orgUsers)
        .where(
          and(eq(orgUsers.id, memberId), eq(orgUsers.orgId, req.currentOrg!.id)),
        )
        .for("update");
      if (!membership) return { kind: "missing" as const };

      const [targetUser] = await tx
        .select()
        .from(users)
        .where(eq(users.id, membership.userId))
        .for("update");
      if (!targetUser) return { kind: "missing" as const };

      const [deletion] = await tx
        .select({ status: accountDeletionLedger.status })
        .from(accountDeletionLedger)
        .where(eq(accountDeletionLedger.userId, targetUser.id));
      if (deletion?.status === "processing" || deletion?.status === "failed") {
        return { kind: "deleting" as const };
      }

      if (
        parsed.data.role !== undefined &&
        membership.role === "owner" &&
        parsed.data.role !== "owner"
      ) {
        const owners = await tx
          .select()
          .from(orgUsers)
          .where(
            and(
              eq(orgUsers.orgId, req.currentOrg!.id),
              eq(orgUsers.role, "owner"),
            ),
          );
        if (owners.length <= 1) return { kind: "last_owner" as const };
      }

      const updates: Partial<typeof orgUsers.$inferInsert> = {};
      if (parsed.data.role !== undefined) updates.role = parsed.data.role;
      if (parsed.data.displayName !== undefined) {
        updates.displayName = requestedDisplayName ?? null;
      }
      const [updated] = await tx
        .update(orgUsers)
        .set(updates)
        .where(eq(orgUsers.id, membership.id))
        .returning();
      return { kind: "updated" as const, updated, user: targetUser };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (result.kind === "deleting") {
      res.status(409).json({ error: "This account is being deleted" });
      return;
    }
    if (result.kind === "last_owner") {
      res.status(400).json({ error: "Cannot demote the last owner" });
      return;
    }
    const { updated, user } = result;

    res.json(
      UpdateMemberRoleResponse.parse({
        ...memberResponse(updated, user),
      }),
    );
  },
);

router.delete(
  "/orgs/:orgId/members/:memberId",
  requireRole("owner"),
  async (req, res): Promise<void> => {
    const memberId = Array.isArray(req.params.memberId)
      ? req.params.memberId[0]
      : req.params.memberId;
    const result = await db.transaction(async (tx) => {
      const [membership] = await tx
        .select()
        .from(orgUsers)
        .where(
          and(eq(orgUsers.id, memberId), eq(orgUsers.orgId, req.currentOrg!.id)),
        )
        .for("update");
      if (!membership) return { kind: "missing" as const };
      if (membership.role === "owner") return { kind: "owner" as const };

      // A removed member must not regain a stale rate if they are invited
      // back later. Historical commissions deliberately remain untouched.
      await removeEmployeeCommissionForMembership(
        tx,
        req.currentOrg!.id,
        membership.userId,
      );
      await tx.delete(orgUsers).where(eq(orgUsers.id, membership.id));
      return { kind: "removed" as const };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (result.kind === "owner") {
      res.status(400).json({ error: "Cannot remove an owner" });
      return;
    }
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
  requireRole("owner"),
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
