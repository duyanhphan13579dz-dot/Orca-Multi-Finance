import "server-only";
import type { FinancialProvider } from "./provider";
import { fetchVndirectFinancials } from "./vndirect-fs";
import { ssiFcConfigured } from "../providers/ssi-fcdata";

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
    primary: "vndirect";
    fallback: "ssi-fcdata" | "vndirect";
  };
  financial: {
    primary: "vndirect";
    fallback: "vndirect";
  };
}

export function vnProviderLayout(): VnProviderLayout {
  // VNDIRECT là primary cho market data (chỉ số, bảng giá, quote, OHLCV, universe).
  // SSI FastConnect là fallbackMarket khi đã cấu hình.
  // Financial statements primary vẫn là VNDIRECT.
  const ssiLive = ssiFcConfigured();
  return {
    market: {
      primary: "vndirect",
      fallback: ssiLive ? "ssi-fcdata" : "vndirect",
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
      note: "VNDIRECT DStock / api-finfo financial_statements — PRIMARY (market + financial)",
    };
  },
};

export function listFinancialProviders(): FinancialProvider[] {
  // VNDIRECT là primaryMarket và primaryFinancial.
  return [vndirectProvider];
}
