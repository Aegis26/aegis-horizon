type DecimalParts = {
  units: bigint;
  scale: number;
};

/**
 * Parse a non-negative decimal without going through a JavaScript number.
 * Commission calculations are financial writes, so binary floating-point
 * arithmetic is deliberately not used here.
 */
function decimalParts(value: string | number | null | undefined, label: string): DecimalParts {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`${label} must be a non-negative decimal`);
  const fraction = match[1] ?? "";
  const whole = raw.slice(0, raw.indexOf(".") >= 0 ? raw.indexOf(".") : raw.length);
  return {
    units: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

/** Round a positive rational value to the nearest integer, half up. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}

function centsString(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

/**
 * Calculate commission using integer decimal units. The result is always an
 * exact, two-decimal money string, with half-cent values rounded up.
 */
export function calculateCommissionAmount(
  opportunityValue: string | number | null | undefined,
  commissionPercentage: string | number,
): { opportunityValue: string; commissionAmount: string } {
  const value = decimalParts(opportunityValue, "opportunity value");
  const rate = decimalParts(commissionPercentage, "commission percentage");
  // Normalize the deal itself to cents before applying the rate. This keeps
  // the stored deal snapshot and commission calculation on the same monetary
  // value (for example, $0.005 becomes $0.01 before a 50% calculation).
  const valueCents = roundHalfUp(
    value.units * 100n,
    powerOfTen(value.scale),
  );
  // valueCents cents * rate percent / 100, rounded to cents.
  const amountCents = roundHalfUp(
    valueCents * rate.units,
    100n * powerOfTen(rate.scale),
  );
  return {
    opportunityValue: centsString(valueCents),
    commissionAmount: centsString(amountCents),
  };
}

export function normalizeCommissionPercentage(
  value: string | number | null | undefined,
): string {
  const parts = decimalParts(value, "commission percentage");
  if (parts.scale > 2) {
    throw new Error("commission percentage must have at most 2 decimal places");
  }
  if (parts.units > 100n * powerOfTen(parts.scale)) {
    throw new Error("commission percentage must be between 0 and 100");
  }
  return centsString(parts.units * powerOfTen(2 - parts.scale));
}
