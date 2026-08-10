// Feature catalog + plan definitions for the modular CRM.
// Prices are in cents/month. Annual billing gets ANNUAL_DISCOUNT_PERCENT off.

export const ANNUAL_DISCOUNT_PERCENT = 20;

export interface FeatureDef {
  key: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  category: string;
}

export const FEATURES: FeatureDef[] = [
  {
    key: "crm",
    name: "Core CRM",
    description: "Accounts, contacts, and activity timeline.",
    monthlyPriceCents: 2500,
    category: "Core",
  },
  {
    key: "sales",
    name: "Sales Pipeline",
    description: "Opportunities, stages, and deal tracking.",
    monthlyPriceCents: 3000,
    category: "Core",
  },
  {
    key: "tasks",
    name: "Tasks & Reminders",
    description: "Task management with due dates and reminders.",
    monthlyPriceCents: 1000,
    category: "Core",
  },
  {
    key: "analytics",
    name: "Analytics & Reporting",
    description: "Dashboards, reports, and forecasting.",
    monthlyPriceCents: 3500,
    category: "Insights",
  },
  {
    key: "ai_copilot",
    name: "AI Copilot",
    description: "AI-driven predictions, scoring, and recommendations.",
    monthlyPriceCents: 5000,
    category: "Insights",
  },
  {
    key: "automation",
    name: "Workflow Automation",
    description: "Trigger-based workflows and process automation.",
    monthlyPriceCents: 4000,
    category: "Operations",
  },
  {
    key: "territories",
    name: "Territory Management",
    description: "Territories, quotas, and assignment rules.",
    monthlyPriceCents: 2000,
    category: "Operations",
  },
  {
    key: "quotes",
    name: "Quotes & CPQ",
    description: "Quote generation and configure-price-quote.",
    monthlyPriceCents: 3000,
    category: "Revenue",
  },
  {
    key: "contracts",
    name: "Contract Management",
    description: "Contract lifecycle and renewal tracking.",
    monthlyPriceCents: 2500,
    category: "Revenue",
  },
  {
    key: "support",
    name: "Customer Support",
    description: "Cases, SLAs, and support inbox.",
    monthlyPriceCents: 3000,
    category: "Service",
  },
  {
    key: "documents",
    name: "Document Hub",
    description: "File storage attached to CRM records.",
    monthlyPriceCents: 1500,
    category: "Service",
  },
  {
    key: "integrations",
    name: "Integrations & API",
    description: "Webhooks, API access, and third-party sync.",
    monthlyPriceCents: 2000,
    category: "Platform",
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export interface PlanDef {
  key: "essential" | "professional" | "enterprise";
  name: string;
  description: string;
  monthlyPriceCents: number;
  includedFeatures: string[];
}

export const PLANS: PlanDef[] = [
  {
    key: "essential",
    name: "Essential",
    description: "Core CRM for small teams getting organized.",
    monthlyPriceCents: 4900,
    includedFeatures: ["crm", "sales", "tasks"],
  },
  {
    key: "professional",
    name: "Professional",
    description: "Growing teams that need insight and automation.",
    monthlyPriceCents: 12900,
    includedFeatures: [
      "crm",
      "sales",
      "tasks",
      "analytics",
      "automation",
      "territories",
      "documents",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "The full platform, every module included.",
    monthlyPriceCents: 24900,
    includedFeatures: FEATURE_KEYS,
  },
];

export function featuresForPlan(plan: string): string[] {
  const found = PLANS.find((p) => p.key === plan);
  return found ? found.includedFeatures : [];
}

export function priceForSelection(
  featureKeys: string[],
  interval: "month" | "year",
): number {
  const monthly = FEATURES.filter((f) => featureKeys.includes(f.key)).reduce(
    (sum, f) => sum + f.monthlyPriceCents,
    0,
  );
  if (interval === "year") {
    return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100));
  }
  return monthly;
}
