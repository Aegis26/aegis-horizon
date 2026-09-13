import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
  commissions,
  db,
  employeeCommissions,
  orgUsers,
} from "@workspace/db";
import {
  GetCommissionSettingsResponse,
  GetEarnedCommissionsQueryParams,
  GetEarnedCommissionsResponse,
  UpdateCommissionSettingsBody,
  UpdateCommissionSettingsResponse,
} from "@workspace/api-zod";
import { attachOrg, attachUser, requireRole } from "../middlewares/auth";
import { normalizeCommissionPercentage } from "../services/commissionMath";
import { datePeriod } from "../services/commissionPeriods";
import { replaceCommissionSettings } from "../services/commissions";

const router: IRouter = Router();
const gate = [attachUser, attachOrg] as const;

function settingOut(row: typeof employeeCommissions.$inferSelect) {
  return {
    userId: row.userId,
    commissionPercentage: normalizeCommissionPercentage(row.commissionPercentage),
    isActive: row.isActive,
  };
}

function moneyCents(value: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error("Commission ledger contains an invalid money value");
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

function centsMoney(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function averageCents(total: bigint, count: number): bigint {
  if (count === 0) return 0n;
  return (total + BigInt(Math.floor(count / 2))) / BigInt(count);
}

router.get(
  "/orgs/:orgId/commissions/settings",
  ...gate,
  requireRole("owner"),
  async (req, res): Promise<void> => {
    const where = [eq(employeeCommissions.orgId, req.currentOrg!.id)];
    const rows = await db
      .select({ setting: employeeCommissions })
      .from(employeeCommissions)
      .innerJoin(
        orgUsers,
        and(
          eq(orgUsers.orgId, employeeCommissions.orgId),
          eq(orgUsers.userId, employeeCommissions.userId),
        ),
      )
      .where(and(...where))
      .orderBy(employeeCommissions.userId);
    res.json(
      GetCommissionSettingsResponse.parse({
        settings: rows.map(({ setting }) => settingOut(setting)),
      }),
    );
  },
);

router.put(
  "/orgs/:orgId/commissions/settings",
  ...gate,
  requireRole("owner"),
  async (req, res): Promise<void> => {
    const parsed = UpdateCommissionSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    try {
      const seen = new Set<string>();
      const normalized = parsed.data.settings.map((setting) => {
        if (seen.has(setting.userId)) {
          throw new Error("Each userId may appear only once");
        }
        seen.add(setting.userId);
        return {
          ...setting,
          commissionPercentage: normalizeCommissionPercentage(
            setting.commissionPercentage,
          ),
        };
      });
      const settings = await db.transaction(async (tx) => {
        await replaceCommissionSettings(tx, req.currentOrg!.id, normalized);
        return tx
          .select({ setting: employeeCommissions })
          .from(employeeCommissions)
          .innerJoin(
            orgUsers,
            and(
              eq(orgUsers.orgId, employeeCommissions.orgId),
              eq(orgUsers.userId, employeeCommissions.userId),
            ),
          )
          .where(eq(employeeCommissions.orgId, req.currentOrg!.id))
          .orderBy(employeeCommissions.userId);
      });
      res.json(
        UpdateCommissionSettingsResponse.parse({
          settings: settings.map(({ setting }) => settingOut(setting)),
        }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("commission percentage") ||
          error.message.includes("Every commission") ||
          error.message.includes("Each userId"))
      ) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/orgs/:orgId/commissions/earned",
  ...gate,
  async (req, res): Promise<void> => {
    const parsed = GetEarnedCommissionsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "period must be today, 7days, month, or year" });
      return;
    }
    const period = parsed.data.period;
    const { start, end } = datePeriod(period);
    const where = [
      eq(commissions.orgId, req.currentOrg!.id),
      gte(commissions.earnedDate, start),
      lt(commissions.earnedDate, end),
    ];
    // Exactly owner sees team totals. Admin, manager, user, and viewer are
    // deliberately constrained to their own historical local user id.
    if (req.currentMembership?.role !== "owner") {
      where.push(eq(commissions.userId, req.currentUser!.id));
    }
    const rows = await db
      .select()
      .from(commissions)
      .where(and(...where))
      .orderBy(desc(commissions.earnedDate), desc(commissions.createdAt));
    const total = rows.reduce((sum, row) => sum + moneyCents(row.commissionAmount), 0n);
    const records = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      employeeName: row.employeeName,
      opportunityId: row.opportunityId,
      opportunityName: row.opportunityName,
      opportunityValue: row.opportunityValue,
      commissionPercentage: row.commissionPercentage,
      commissionAmount: row.commissionAmount,
      earnedDate: row.earnedDate.toISOString(),
    }));
    res.json(
      GetEarnedCommissionsResponse.parse({
        period,
        totalCommission: centsMoney(total),
        dealCount: rows.length,
        averageCommission: centsMoney(averageCents(total, rows.length)),
        records,
      }),
    );
  },
);

export default router;
