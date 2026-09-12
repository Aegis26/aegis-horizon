import { eq } from "drizzle-orm";
import { db, organizationDeletionLedger } from "@workspace/db";

export type ActiveOrganizationDeletionStatus =
  | "pending"
  | "processing"
  | "failed";

export async function getOrganizationDeletionRecord(orgId: string): Promise<{
  status: string;
  requestedByUserId: string | null;
  requestedByUserHash: string | null;
} | null> {
  const [row] = await db
    .select({
      status: organizationDeletionLedger.status,
      requestedByUserId: organizationDeletionLedger.requestedByUserId,
      requestedByUserHash: organizationDeletionLedger.requestedByUserHash,
    })
    .from(organizationDeletionLedger)
    .where(eq(organizationDeletionLedger.organizationId, orgId));
  return row ?? null;
}

export async function getOrganizationDeletionStatus(
  orgId: string,
): Promise<ActiveOrganizationDeletionStatus | null> {
  const row = await getOrganizationDeletionRecord(orgId);
  if (
    row?.status === "pending" ||
    row?.status === "processing" ||
    row?.status === "failed"
  ) {
    return row.status;
  }
  return null;
}

export async function isOrganizationDeletionActive(
  orgId: string,
): Promise<boolean> {
  return (await getOrganizationDeletionStatus(orgId)) !== null;
}