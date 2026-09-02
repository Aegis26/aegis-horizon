import { format } from "date-fns";

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatDollars(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string | null | undefined) {
  if (!dateString) return "N/A";
  try {
    return format(new Date(dateString), "MMM d, yyyy");
  } catch (e) {
    return dateString;
  }
}

export function getInitials(name: string | null | undefined, email: string) {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return name.substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

/**
 * Formats API prediction/confidence values (0.0 to 1.0) into a percentage string (e.g. 50%).
 */
export function formatPredictionPercentage(value: number | string | null | undefined): string {
  if (value == null) return "N/A";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "N/A";
  const clamped = Math.max(0, Math.min(1, num));
  return `${Math.round(clamped * 100)}%`;
}
