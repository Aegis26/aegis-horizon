export type DealDraft = {
  name: string;
  value: string;
  expectedCloseDate: string;
  probability: string;
  nextAction: string;
};

export function dealDraftFromOpportunity(opp: {
  name: string;
  value?: string | null;
  expectedCloseDate?: string | null;
  probability?: number | null;
  nextAction?: string | null;
}): DealDraft {
  return {
    name: opp.name,
    value: opp.value ?? "",
    expectedCloseDate: opp.expectedCloseDate ?? "",
    probability: opp.probability == null ? "" : String(opp.probability),
    nextAction: opp.nextAction ?? "",
  };
}

export function parseDealDraft(draft: DealDraft, won: boolean):
  | { error: string; data?: never }
  | { data: { name: string; value: string | null; expectedCloseDate: string | null; probability: number | null; nextAction: string | null }; error?: never } {
  const name = draft.name.trim();
  const value = draft.value.trim();
  const probability = draft.probability.trim();
  if (!name) return { error: "Deal name is required." } as const;
  if (value && (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
    return { error: "Value must be a non-negative USD amount." } as const;
  }
  if (probability && (!/^\d+$/.test(probability) || Number(probability) > 100)) {
    return { error: "Probability must be a whole number from 0 to 100." } as const;
  }
  if (won && !value) return { error: "A won deal requires a value." } as const;
  return {
    data: {
      name,
      value: value || null,
      expectedCloseDate: draft.expectedCloseDate || null,
      probability: probability ? Number(probability) : null,
      nextAction: draft.nextAction.trim() || null,
    },
  } as const;
}