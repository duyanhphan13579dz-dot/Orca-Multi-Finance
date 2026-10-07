/** Shared types for stock financials table page */
export type FinTableTab = "income" | "balance" | "cashflow" | "ratios";

export type FinTablePayload = {
  symbol: string;
  financials: {
    income: Record<string, unknown>[] | null;
    balance: Record<string, unknown>[] | null;
    cashflow: Record<string, unknown>[] | null;
    ratios: Record<string, unknown>[] | null;
  };
  packageMeta?: {
    primarySource?: string | null;
    latestPeriod?: string | null;
    reportTypeLabel?: string | null;
    statementScope?: string | null;
    freshnessStatus?: string | null;
    note?: string | null;
  } | null;
  notes?: string[];
};

export function financialsApiUrl(symbol: string) {
  return `/api/v1/stocks/${encodeURIComponent(symbol)}/financials`;
}
