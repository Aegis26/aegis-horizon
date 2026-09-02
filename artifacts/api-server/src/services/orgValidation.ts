import { and, eq } from "drizzle-orm";
import { accounts, db, opportunities, orgUsers, territories } from "@workspace/db";

/** Reusable fail-closed tenant guards for any body-supplied foreign key. */
export async function isOrgMemberId(orgId: string, userId: string) {
  return Boolean((await db.select({ id: orgUsers.id }).from(orgUsers)
    .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.userId, userId))))[0]);
}
export async function isOrgTerritoryId(orgId: string, territoryId: string) {
  return Boolean((await db.select({ id: territories.id }).from(territories)
    .where(and(eq(territories.orgId, orgId), eq(territories.id, territoryId))))[0]);
}
export async function isOrgAccountId(orgId: string, accountId: string) {
  return Boolean((await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId))))[0]);
}
export async function isOrgOpportunityId(orgId: string, opportunityId: string) {
  return Boolean((await db.select({ id: opportunities.id }).from(opportunities)
    .where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, opportunityId))))[0]);
}