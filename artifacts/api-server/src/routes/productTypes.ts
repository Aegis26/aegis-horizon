import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, productTypes } from "@workspace/db";
import {
  CreateProductTypeBody,
  CreateProductTypeResponse,
  ListProductTypesResponse,
  UpdateProductTypeBody,
  UpdateProductTypeResponse,
} from "@workspace/api-zod";
import { attachOrg, attachUser, requireFeature, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
const gate = [attachUser, attachOrg, requireFeature("sales")] as const;

function productTypeOut(row: typeof productTypes.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
  };
}

router.get("/orgs/:orgId/product-types", ...gate, async (req, res): Promise<void> => {
  const where = [eq(productTypes.orgId, req.currentOrg!.id)];
  if (req.currentMembership?.role !== "owner") {
    where.push(eq(productTypes.isActive, true));
  }
  const rows = await db
    .select()
    .from(productTypes)
    .where(and(...where))
    .orderBy(productTypes.name);
  res.json(ListProductTypesResponse.parse({ productTypes: rows.map(productTypeOut) }));
});

router.post(
  "/orgs/:orgId/product-types",
  ...gate,
  requireRole("owner"),
  async (req, res): Promise<void> => {
    const parsed = CreateProductTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [row] = await db
      .insert(productTypes)
      .values({
        orgId: req.currentOrg!.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();
    res.status(201).json(CreateProductTypeResponse.parse(productTypeOut(row)));
  },
);

router.patch(
  "/orgs/:orgId/product-types/:productTypeId",
  ...gate,
  requireRole("owner"),
  async (req, res): Promise<void> => {
    const parsed = UpdateProductTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const [row] = await db
      .update(productTypes)
      .set(parsed.data)
      .where(
        and(
          eq(productTypes.id, String(req.params.productTypeId)),
          eq(productTypes.orgId, req.currentOrg!.id),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Product type not found" });
      return;
    }
    res.json(UpdateProductTypeResponse.parse(productTypeOut(row)));
  },
);

export default router;