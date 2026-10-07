import "server-only";

import { getFinancialsForSymbol } from "@/lib/financial/service";
import {
  buildFinancialForecast,
  type FinancialForecastResult,
  type HistPoint,
} from "@/lib/engines/financial-forecast";
import { getVndQuotes } from "@/lib/providers/vndirect";
import {
  getVndEquitySnapshot,
  getVndValuationRatios,
} from "@/lib/providers/vndirect-company";
import { cached } from "@/lib/cache";
import { buildMeta } from "@/lib/freshness";
import type { Meta } from "@/lib/types";

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowsToHistory(rows: Record<string, unknown>[] | null | undefined): HistPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: HistPoint[] = [];
  for (const r of rows) {
    const periodTypeRaw = String(r.periodType ?? "").toLowerCase();
    let periodType: HistPoint["periodType"] = "quarter";
    if (periodTypeRaw === "year" || periodTypeRaw === "annual") periodType = "year";
    else if (periodTypeRaw === "ttm") periodType = "ttm";
    else if (periodTypeRaw === "quarter" || periodTypeRaw === "semi") periodType = "quarter";
    else if (num(r.quarter) == null && num(r.year) != null) periodType = "year";

    const year = num(r.year);
    const quarter = num(r.quarter);
    const revenue =
      num(r.revenue) ?? num(r.netRevenue) ?? num(r.netSales) ?? null;
    const netIncome =
      num(r.netIncome) ?? num(r.netProfit) ?? num(r.netIncomeParent) ?? null;
    const equity = num(r.equity) ?? null;
    const period =
      typeof r.period === "string" && r.period
        ? r.period
        : periodType === "year"
          ? `Y${year ?? "?"}`
          : `Q${quarter ?? "?"}/${year ?? "?"}`;

    if (revenue == null && netIncome == null) continue;
    out.push({
      period,
      periodType,
      year,
      quarter: periodType === "quarter" ? quarter : null,
      revenue,
      netIncome,
      equity,
      netMargin:
        revenue != null && revenue > 0 && netIncome != null
          ? netIncome / revenue
          : null,
    });
  }
  return out;
}

export async function runStockForecast(
  symbolRaw: string,
): Promise<{ data: FinancialForecastResult; meta: Meta } | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) return null;

  const cachedRes = await cached(`forecast:v1:${symbol}`, {
    ttlMs: 120_000,
    staleMs: 300_000,
    producer: async () => {
      const [fin, quotes, equity, ratios] = await Promise.all([
        getFinancialsForSymbol(symbol),
        getVndQuotes([symbol]).catch(() => ({ quotes: [] as { symbol: string; price: number }[], sourceTs: null as number | null })),
        getVndEquitySnapshot(symbol).catch(() => null),
        getVndValuationRatios(symbol).catch(() => null),
      ]);

      const incomeHist = rowsToHistory(fin?.financials?.income ?? null);
      const balanceHist = rowsToHistory(fin?.financials?.balance ?? null);

      for (const h of incomeHist) {
        if (h.equity != null) continue;
        const match = balanceHist.find(
          (b) =>
            b.year === h.year &&
            (h.periodType === "year" || b.quarter === h.quarter),
        );
        if (match?.equity != null) h.equity = match.equity;
      }

      const quote = quotes.quotes.find((q) => q.symbol === symbol);
      const price = quote?.price ?? null;

      const healthShares =
        fin?.health &&
        typeof fin.health === "object" &&
        (fin.health as { anchors?: { shares?: number | null } }).anchors?.shares;

      const shares =
        equity?.sharesOutstanding ??
        (typeof healthShares === "number" ? healthShares : null);

      const trailingPe =
        ratios && typeof ratios.pe === "number" && ratios.pe > 0 ? ratios.pe : null;

      const data = buildFinancialForecast({
        symbol,
        history: incomeHist,
        currentPrice: price,
        sharesOutstanding: shares,
        trailingPe,
        costOfEquity: 0.12,
      });

      const meta = buildMeta({
        source: "vndirect-financials+forecast",
        sourceTimestampMs: quotes.sourceTs ?? Date.now(),
        hasData: incomeHist.length > 0,
      });

      return { data, meta };
    },
  });

  return cachedRes.value;
}
