import "server-only";
import type { FinancialProvider } from "./provider";
import { fetchVndirectFinancials } from "./vndirect-fs";

/**
 * Financial Statement Source Registry
 *
 * Architecture lock (Orca Financial Data Engine):
 *   - VNDIRECT DStock / api-finfo = PRIMARY for BCTC (B/S, I/S, C/F)
 *   - SSI FastConnect = Market Data only (price, OHLCV, quote, order book, index)
 *   - SSI is NEVER registered here as a BCTC provider or fallback
 *
 * Pipeline: Collector → Raw → Validate → Normalize → Analytics
 * AI only consumes validated/normalized periods — never invents missing figures.
 */

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
