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
  // SSI FastConnect là primary cho data thị trường (chỉ số, bảng giá, quote, OHLCV, universe).
  // SSI là NEVER registered in `listFinancialProviders()` — financial statements primary vẫn là VNDIRECT.
  const ssiLive = ssiFcConfigured();
  return {
    market: {
      primary: ssiLive ? "ssi-fcdata" : "vndirect",
      fallback: ssiLive ? "vndirect" : "vndirect",
    },
    financial: {
      primary: "vndirect",
      fallback: "vndirect",
    },
  };
}

// SSI FastConnect — Market Data (không phải financial statements).
// `ssiCfgured()` nằm trong provider module để tránh circular import.
function ssiFcConfigured(): boolean {
  try {
    // Defer to the actual provider implementation used across the codebase.
    const { ssiFcConfigured: real } = require("../providers/ssi-fcdata");
    return typeof real === "function" ? real() : false;
  } catch {
    return false;
  }
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
