import "server-only";
import { env } from "../env";
import type { FinancialProvider } from "./provider";
import { fetchVndirectFinancials } from "./vndirect-fs";

/**
 * Source Priority Registry
 *
 * CURRENT (temporary):
 *   1. SSI Flashconnect — not configured → skipped
 *   2. VNDirect structured FS — active primary
 *
 * NEXT WEEK:
 *   Enable SSI as priority 1; VNDirect becomes fallback (priority 2).
 */

function ssiConfigured(): boolean {
  return Boolean(
    process.env.SSI_FLASHCONNECT_URL ||
      process.env.SSI_API_KEY ||
      process.env.SSI_BASE_URL,
  );
}

const ssiProvider: FinancialProvider = {
  id: "ssi-flashconnect",
  role: "PRIMARY_SOURCE_OF_TRUTH",
  priority: 1,
  enabled: () => ssiConfigured(),
  fetch: async () => {
    // Adapter lands when SSI credentials + endpoints are wired.
    return null;
  },
};

const vndirectProvider: FinancialProvider = {
  id: "vndirect-fs",
  role: "FAST_STRUCTURED_DATA_SOURCE",
  priority: 2,
  enabled: () => true,
  fetch: async (symbol, opts) => {
    const r = await fetchVndirectFinancials(symbol, opts);
    if (!r) return null;
    return {
      periods: r.periods,
      latencyMs: r.latencyMs,
      sourceId: "vndirect-fs",
      role: "FAST_STRUCTURED_DATA_SOURCE",
      priority: 2,
      note: "VNDirect financial_statements (tạm thời primary — SSI ưu tiên khi sẵn sàng)",
    };
  },
};

export function listFinancialProviders(): FinancialProvider[] {
  // env.vnstock reserved; intentionally not registered after VNStock decommission.
  void env;
  return [ssiProvider, vndirectProvider];
}
