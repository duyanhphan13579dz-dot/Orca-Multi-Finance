import "server-only";
import type { FinancialProvider } from "./provider";
import { fetchVndirectFinancials } from "./vndirect-fs";

/**
 * Financial Provider Layout
 *
 * Returns the provider layout keyed on callsite-relative `.market.primary` / `.financial.primary`.
 *
 * We keep one canonical place for provider topology so `.vnProviderLayout()` never relies on
 * brittle relative requires to provider modules.
 */
export interface VnProviderLayout {
  market: {
    primary: string;
    fallback: string | null;
  };
  financial: {
    primary: string;
    fallback: string | null;
  };
}

export function vnProviderLayout(): VnProviderLayout {
  // VNDirect is the primary source for daily/history market data.
  // SSI remains the realtime overlay/fallback for quote ticks and orderbook only.
  // SSI is NEVER registered in `listFinancialProviders()` — financial statements remain VNDirect primary.
  return {
    market: {
      primary: "vndirect",
      fallback: "ssi-fcdata",
    },
    financial: {
      primary: "vndirect",
      fallback: "vndirect",
    },
  };
}

const vndirectProvider: FinancialProvider = {
  id: "vndirect-fs",
  role: "PRIMARY_SOURCE_OF_TRUTH",
  priority: 1,
  enabled: () => true,
  fetch: async (symbol, opts) => {
    const r = await fetchVndirectFinancials(symbol, opts);
    if (!r) return null;
    return {
      periods: r.periods,
      latencyMs: r.latencyMs,
      sourceId: "vndirect-fs",
      role: "PRIMARY_SOURCE_OF_TRUTH",
      priority: 1,
      note: "VNDIRECT DStock / api-finfo financial_statements — primary BCTC",
    };
  },
};

export function listFinancialProviders(): FinancialProvider[] {
  // SSI intentionally omitted — Market Data domain only.
  return [vndirectProvider];
}
