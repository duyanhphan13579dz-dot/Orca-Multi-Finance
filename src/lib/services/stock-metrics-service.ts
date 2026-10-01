/**
 * Multi-source VN equity pack per symbol:
 *  - Quotes: VNDirect → VPS / SSI / Vietcap / public (via getMultiQuotes)
 *  - BCTC: VNDirect api-finfo
 *  - Equity + market multiples: VNDirect company
 *  - Detailed ratios: ratio-engine (valuation-ready)
 */
import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getMultiQuotes, type MultiQuoteResult } from "./multi-quote";
import { fetchVndirectFinancials } from "../financial/vndirect-fs";
import {
  computeDetailedRatios,
  pickMetricsFromPeriods,
  type RatioEngineResult,
} from "../financial/ratio-engine";
import {
  getVndEquitySnapshot,
  getVndValuationRatios,
  type VndEquitySnapshot,
  type VndValuationRatios,
} from "../providers/vndirect-company";
import { mapPool } from "../financial/snapshots";
import type { Meta, Quote } from "../types";

export type StockMetricsSources = {
  quote: string[];
  financials: string | null;
  equity: string | null;
  marketRatios: string | null;
};

export type StockMetricsBundle = {
  symbol: string;
  quote: Quote | null;
  price: number | null;
  changePercent: number | null;
  sharesOutstanding: number | null;
  marketCap: number | null;
  ratios: RatioEngineResult | null;
  ratioMap: Record<string, number | null>;
  sources: StockMetricsSources;
  period: string | null;
  qualityScore: number | null;
  notes: string[];
};

function ratioMapFrom(result: RatioEngineResult | null): Record<string, number | null> {
  if (!result) return {};
  const out: Record<string, number | null> = {};
  for (const r of result.flat) {
    out[r.key] = r.value;
  }
  out._quality = result.quality.score;
  return out;
}

export async function getStockMetricsBundle(
  symbolRaw: string,
  opts?: { skipCache?: boolean },
): Promise<{ bundle: StockMetricsBundle; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3 || symbol.length > 12) return null;

  const run = async (): Promise<{ bundle: StockMetricsBundle; meta: Meta } | null> => {
    const notes: string[] = [];

    const [multi, fs, equity, vndRatios] = await Promise.all([
      getMultiQuotes([symbol]).catch(
        (): MultiQuoteResult => ({
          quotes: [],
          sources: [],
          sourceTs: null,
          latencies: {},
          conflicts: 0,
        }),
      ),
      fetchVndirectFinancials(symbol, { limitPeriods: 12 }).catch(() => null),
      getVndEquitySnapshot(symbol).catch((): VndEquitySnapshot | null => null),
      getVndValuationRatios(symbol).catch((): VndValuationRatios | null => null),
    ]);

    const quote =
      multi.quotes.find((q) => q.symbol.toUpperCase() === symbol) ?? multi.quotes[0] ?? null;
    const price = quote?.price && quote.price > 0 ? quote.price : null;
    const shares =
      equity?.sharesOutstanding && equity.sharesOutstanding > 0
        ? equity.sharesOutstanding
        : null;

    if (!fs?.periods?.length && price == null) {
      return null;
    }

    const picked = pickMetricsFromPeriods(fs?.periods ?? []);
    let ratios: RatioEngineResult | null = null;
    try {
      ratios = computeDetailedRatios({
        metrics: picked.metrics,
        prior: picked.prior,
        priceQuote: price,
        sharesOutstanding: shares,
        marketMultiples: vndRatios
          ? {
              pe: vndRatios.pe,
              pb: vndRatios.pb,
              ps: vndRatios.ps,
              evEbitda: vndRatios.evEbitda,
              dividendYield: vndRatios.dividendYield,
              marketCap: vndRatios.marketCap ?? equity?.marketCapReported ?? null,
            }
          : { marketCap: equity?.marketCapReported ?? null },
        periodLabel: picked.label,
      });
    } catch {
      notes.push("ratio-engine lỗi — bỏ qua chỉ số chi tiết");
    }

    if (multi.sources.length) notes.push(`Giá: ${multi.sources.join("+")}`);
    if (fs?.periods?.length) notes.push(`BCTC: ${fs.periods.length} kỳ · vndirect-fs`);
    else notes.push("Thiếu BCTC VNDirect");
    if (ratios) notes.push(`Ratios fill ${ratios.quality.filled}/${ratios.quality.total}`);

    const marketCap =
      ratios?.marketCap ?? vndRatios?.marketCap ?? equity?.marketCapReported ?? null;

    const bundle: StockMetricsBundle = {
      symbol,
      quote,
      price,
      changePercent: quote?.changePercent ?? null,
      sharesOutstanding: shares,
      marketCap,
      ratios,
      ratioMap: ratioMapFrom(ratios),
      sources: {
        quote: multi.sources,
        financials: fs?.periods?.length ? "vndirect-fs" : null,
        equity: equity?.source ?? null,
        marketRatios: vndRatios ? "vndirect-ratios" : null,
      },
      period: ratios?.period ?? picked.label,
      qualityScore: ratios?.quality.score ?? null,
      notes,
    };

    const meta = buildMeta({
      source: [...multi.sources, fs ? "vndirect-fs" : null, "ratio-engine"]
        .filter(Boolean)
        .join("+"),
      sourceTimestampMs: multi.sourceTs ?? Date.now(),
      note: notes[0],
      partial: !fs?.periods?.length || price == null,
    });

    return { bundle, meta };
  };

  if (opts?.skipCache) return run();

  try {
    const res = await cached(`stock:metrics:v1:${symbol}`, {
      ttlMs: 60_000,
      staleMs: 300_000,
      softSwr: true,
      producer: run,
    });
    return res.value;
  } catch {
    return run();
  }
}

export async function getStockMetricsBulk(
  symbols: string[],
  opts?: { concurrency?: number; skipCache?: boolean },
): Promise<{
  items: StockMetricsBundle[];
  scanned: number;
  hit: number;
  sourcesUsed: string[];
}> {
  const uniq = [
    ...new Set(
      symbols
        .map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter((s) => s.length >= 3),
    ),
  ].slice(0, 80);
  const concurrency = Math.min(Math.max(opts?.concurrency ?? 6, 1), 12);
  const items: StockMetricsBundle[] = [];
  const sources = new Set<string>();

  await mapPool(uniq, concurrency, async (sym) => {
    try {
      const r = await getStockMetricsBundle(sym, { skipCache: opts?.skipCache });
      if (!r) return;
      items.push(r.bundle);
      for (const s of r.bundle.sources.quote) sources.add(s);
      if (r.bundle.sources.financials) sources.add(r.bundle.sources.financials);
    } catch {
      /* skip */
    }
  });

  items.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    items,
    scanned: uniq.length,
    hit: items.length,
    sourcesUsed: [...sources],
  };
}
