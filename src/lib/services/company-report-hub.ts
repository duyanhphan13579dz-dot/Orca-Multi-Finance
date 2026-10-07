import "server-only";
import { buildStockAnalysis } from "./intelligence";
import { getVnQuotes, getVnOhlcv } from "./stocks";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { fetchVndirectFinancials } from "../financial/vndirect-fs";
import {
  getVndCompanyProfile,
  getVndEquitySnapshot,
  getVndValuationRatios,
  getVndShareholders,
} from "../providers/vndirect-company";
import { getOrGenerateCompanyIntelligence } from "./company-intelligence";
import { hubVnQuotes, hubNews, hubFinancialPackage, runInDataHub } from "../data-engine/hub";
import type { OhlcvBar } from "../types";

async function loadBars(symbol: string): Promise<OhlcvBar[]> {
  try {
    const o = await getVnOhlcv(symbol, 280);
    return (o?.bars as OhlcvBar[]) ?? [];
  } catch {
    return [];
  }
}

/** Parallel company-report data load — all through Data Hub request scope. */
export async function loadCompanyReportSources(sym: string) {
  return runInDataHub(() =>
    Promise.all([
      buildStockAnalysis(sym).catch(() => null),
      hubVnQuotes([sym])
        .catch(() => null)
        .then(async (hub) => hub ?? (await getVnQuotes([sym]).catch(() => null))),
      loadBars(sym),
      hubFinancialPackage(sym)
        .then(async (pkg) => {
          const periods = (pkg as { periods?: unknown })?.periods;
          if (Array.isArray(periods) && periods.length) {
            return { periods } as Awaited<ReturnType<typeof fetchVndirectFinancials>>;
          }
          return fetchVndirectFinancials(sym, { limitPeriods: 12 }).catch(() => null);
        })
        .catch(() => fetchVndirectFinancials(sym, { limitPeriods: 12 }).catch(() => null)),
      getVndValuationRatios(sym).catch(() => null),
      getVndEquitySnapshot(sym).catch(() => null),
      getVndCompanyProfile(sym).catch(() => null),
      getVndShareholders(sym).catch(() => []),
      getOrGenerateCompanyIntelligence(sym).catch(() => null),
      hubNews({ symbol: sym, limit: 8 }).catch(() => null),
      fetchVndDchartHistory("VNINDEX", "D", 280).catch(() => [] as OhlcvBar[]),
      import("../providers/vndirect")
        .then((m) => m.getVndForeignFlow().catch(() => null))
        .catch(() => null),
      import("../providers/vndirect")
        .then((m) => m.getVndIndices().catch(() => null))
        .catch(() => null),
    ]),
  );
}
