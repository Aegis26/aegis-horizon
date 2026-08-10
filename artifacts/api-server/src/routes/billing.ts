import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, organizations } from "@workspace/db";
import {
  GetBillingCatalogResponse,
  CreateCheckoutSessionBody,
  CreateCheckoutSessionResponse,
} from "@workspace/api-zod";
import { attachUser, attachOrg, requireRole } from "../middlewares/auth";
import {
  ANNUAL_DISCOUNT_PERCENT,
  FEATURES,
  FEATURE_KEYS,
  PLANS,
  featuresForPlan,
} from "../lib/catalog";
import {
  getUncachableStripeClient,
  StripeNotConnectedError,
} from "../lib/stripeClient";

const router: IRouter = Router();

router.get("/billing/catalog", async (_req, res): Promise<void> => {
  res.json(
    GetBillingCatalogResponse.parse({
      plans: PLANS,
      features: FEATURES,
      annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT,
    }),
  );
});

router.post(
  "/orgs/:orgId/billing/checkout",
  attachUser,
  attachOrg,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateCheckoutSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { plan, features, interval } = parsed.data;
    const org = req.currentOrg!;

    // Resolve the feature set + line items being purchased.
    let lineItems: { name: string; description: string; monthlyCents: number }[];
    let purchasedFeatures: string[];
    if (plan && plan !== "custom") {
      const planDef = PLANS.find((p) => p.key === plan);
      if (!planDef) {
        res.status(400).json({ error: "Unknown plan" });
        return;
      }
      purchasedFeatures = planDef.includedFeatures;
      lineItems = [
        {
          name: `Meridian CRM ${planDef.name}`,
          description: planDef.description,
          monthlyCents: planDef.monthlyPriceCents,
        },
      ];
    } else {
      const selected = [...new Set(features ?? [])].filter((f) =>
        FEATURE_KEYS.includes(f),
      );
      if (selected.length === 0) {
        res.status(400).json({ error: "Select at least one feature" });
        return;
      }
      purchasedFeatures = selected;
      lineItems = FEATURES.filter((f) => selected.includes(f.key)).map((f) => ({
        name: f.name,
        description: f.description,
        monthlyCents: f.monthlyPriceCents,
      }));
    }

    const toUnitAmount = (monthlyCents: number) =>
      interval === "year"
        ? Math.round(monthlyCents * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100))
        : monthlyCents;

    try {
      const stripe = await getUncachableStripeClient();

      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.currentUser!.email,
          name: org.name,
          metadata: { orgId: org.id },
        });
        customerId = customer.id;
        await db
          .update(organizations)
          .set({ stripeCustomerId: customerId })
          .where(eq(organizations.id, org.id));
      }

      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const baseUrl = `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: lineItems.map((li) => ({
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: toUnitAmount(li.monthlyCents),
            recurring: { interval },
            product_data: { name: li.name },
          },
        })),
        success_url: `${baseUrl}/billing?checkout=success`,
        cancel_url: `${baseUrl}/billing?checkout=cancelled`,
        metadata: {
          orgId: org.id,
          plan: plan ?? "custom",
          features: purchasedFeatures.join(","),
        },
        subscription_data: {
          metadata: {
            orgId: org.id,
            plan: plan ?? "custom",
            features: purchasedFeatures.join(","),
          },
        },
      });

      if (!session.url) {
        res.status(502).json({ error: "Stripe did not return a checkout URL" });
        return;
      }
      res.json(CreateCheckoutSessionResponse.parse({ url: session.url }));
    } catch (err) {
      if (err instanceof StripeNotConnectedError) {
        req.log.warn({ err: err.message }, "Stripe not connected");
        res.status(503).json({
          error:
            "Billing is not connected yet. Connect the Stripe integration to enable checkout.",
        });
        return;
      }
      throw err;
    }
  },
);

export default router;
