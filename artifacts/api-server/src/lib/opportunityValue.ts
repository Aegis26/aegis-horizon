/** Values are optional on open deals, but a close must have an explicit amount (zero is valid). */
export function opportunityValueError(value: string | null | undefined, closing = false): string | null {
  if (value == null) {
    return closing ? "Deal value is required before marking won" : null;
  }
  if (value.trim() === "") {
    return closing ? "Deal value is required before marking won" : "Deal value must be a non-negative decimal";
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    return "Deal value must be a non-negative decimal";
  }
  return null;
}