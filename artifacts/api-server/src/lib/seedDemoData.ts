import { db, accounts, opportunities, usageLogs } from "@workspace/db";

/** Seeds a freshly provisioned org with representative demo CRM data so the
 *  first-run experience isn't a wall of empty states. */
export async function seedDemoData(orgId: string, userId: string): Promise<void> {
  const demoAccounts = [
    {
      name: "Northwind Logistics",
      industry: "Transportation",
      website: "https://northwind.example.com",
      city: "Chicago",
      state: "IL",
      healthScore: "green",
      riskLevel: "low",
    },
    {
      name: "Apex Manufacturing",
      industry: "Industrial",
      website: "https://apexmfg.example.com",
      city: "Detroit",
      state: "MI",
      healthScore: "yellow",
      riskLevel: "medium",
    },
    {
      name: "Bluewater Financial",
      industry: "Financial Services",
      website: "https://bluewater.example.com",
      city: "New York",
      state: "NY",
      healthScore: "green",
      riskLevel: "low",
    },
    {
      name: "Helios Health Systems",
      industry: "Healthcare",
      website: "https://helios.example.com",
      city: "Austin",
      state: "TX",
      healthScore: "red",
      riskLevel: "high",
    },
  ];

  const inserted = await db
    .insert(accounts)
    .values(
      demoAccounts.map((a) => ({ ...a, orgId, ownerUserId: userId })),
    )
    .returning();

  const stages = [
    { name: "Fleet tracking rollout", stage: "prospecting", probability: 10, value: "48000", forecastCategory: "pipeline" },
    { name: "Plant expansion suite", stage: "qualified", probability: 25, value: "125000", forecastCategory: "pipeline" },
    { name: "Wealth desk platform", stage: "proposal", probability: 50, value: "86000", forecastCategory: "best_case" },
    { name: "Patient portal renewal", stage: "negotiation", probability: 75, value: "54000", forecastCategory: "committed" },
  ];

  await db.insert(opportunities).values(
    stages.map((s, i) => ({
      orgId,
      accountId: inserted[i % inserted.length].id,
      name: s.name,
      stage: s.stage,
      probability: s.probability,
      value: s.value,
      forecastCategory: s.forecastCategory,
      ownerUserId: userId,
      expectedCloseDate: new Date(Date.now() + (30 + i * 15) * 86400000)
        .toISOString()
        .slice(0, 10),
    })),
  );

  await db.insert(usageLogs).values([
    { orgId, userId, featureKey: "crm", action: "seed.accounts_created" },
    { orgId, userId, featureKey: "sales", action: "seed.opportunities_created" },
  ]);
}
