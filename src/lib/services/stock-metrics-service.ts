/**
 * Multi-source VN equity metrics per symbol.
 *
 * Data plane:
 *  - Quotes: VNDirect → VPS / SSI-iboard / SSI-FC / Vietcap / public-vn (getMultiQuotes)
 *  - BCTC: VNDirect api-finfo
 *  - Equity + market multiples: VNDirect company
 *  - Ratios: ratio-engine (liquidity · leverage · profitability · efficiency · valuation · cash · DuPont)
 *
 * Bulk path batches quotes in ONE multi-source call then fans out BCTC/ratios per ticker.
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
  latencies?: Record<string, number>;
  conflicts?: number;
};

export type StockMetricsBundle = {
  symbol: string;
  quote: Quote | null;
  price: number | null;
  changePercent: number | null;
  sharesOutstanding: number | null;
  marketCap: number | null;
  ratios: RatioEngineResult | null;
  /** Flat key→value for screeners / tables */
  ratioMap: Record<string, number | null>;
  sources: StockMetricsSources;
  period: string | null;
  qualityScore: number | null;
  notes: string[];
};

function ratioMapFrom(result: RatioEngineResult | null): Record<string, number | null> {
  if (!result) return {};
  const out: Record<string, number | null> = {};
  for (const r of result.flat) out[r.key] = r.value;
  out._quality = result.quality.score;
  return out;
}

function emptyMulti(): MultiQuoteResult {
  return { quotes: [], sources: [], sourceTs: null, latencies: {}, conflicts: 0 };
}

async function buildBundleFromParts(
  symbol: string,
  multi: MultiQuoteResult,
  fs: Awaited<ReturnType<typeof fetchVndirectFinancials>> | null,
  equity: VndEquitySnapshot | null,
  vndRatios: VndValuationRatios | null,
): Promise<StockMetricsBundle | null> {
  const notes: string[] = [];
  const quote =
    multi.quotes.find((q) => q.symbol.toUpperCase() === symbol) ?? multi.quotes[0] ?? null;
  const price = quote?.price && quote.price > 0 ? quote.price : null;
  const shares =
    equity?.sharesOutstanding && equity.sharesOutstanding > 0 ? equity.sharesOutstanding : null;

  if (!fs?.periods?.length && price == null) return null;

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
  if (ratios) notes.push(`Ratios ${ratios.quality.filled}/${ratios.quality.total}`);

  const marketCap =
    ratios?.marketCap ?? vndRatios?.marketCap ?? equity?.marketCapReported ?? null;

  return {
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
      latencies: multi.latencies,
      conflicts: multi.conflicts,
    },
    period: ratios?.period ?? picked.label,
    qualityScore: ratios?.quality.score ?? null,
    notes,
  };
}

/**
 * Single ticker: multi-source quote ∥ BCTC ∥ equity ∥ market ratios → detailed indicators.
 */
export async function getStockMetricsBundle(
  symbolRaw: string,
  opts?: { skipCache?: boolean },
): Promise<{ bundle: StockMetricsBundle; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3 || symbol.length > 12) return null;

  const run = async (): Promise<{ bundle: StockMetricsBundle; meta: Meta } | null> => {
    const [multi, fs, equity, vndRatios] = await Promise.all([
      getMultiQuotes([symbol]).catch(emptyMulti),
      fetchVndirectFinancials(symbol, { limitPeriods: 12 }).catch(() => null),
      getVndEquitySnapshot(symbol).catch((): VndEquitySnapshot | null => null),
      getVndValuationRatios(symbol).catch((): VndValuationRatios | null => null),
    ]);

    const bundle = await buildBundleFromParts(symbol, multi, fs, equity, vndRatios);
    if (!bundle) return null;

    const meta = buildMeta({
      source: [...multi.sources, fs ? "vndirect-fs" : null, "ratio-engine"]
        .filter(Boolean)
        .join("+"),
      sourceTimestampMs: multi.sourceTs ?? Date.now(),
      note: bundle.notes[0],
      partial: !fs?.periods?.length || bundle.price == null,
    });

    return { bundle, meta };
  };

  if (opts?.skipCache) return run();

  try {
    const res = await cached(`stock:metrics:v2:${symbol}`, {
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

/**
 * Bulk: ONE multi-source quote call for all symbols, then parallel BCTC + ratios per ticker.
 */
export async function getStockMetricsBulk(
  symbols: string[],
  opts?: { concurrency?: number; skipCache?: boolean },
): Promise<{
  items: StockMetricsBundle[];
  scanned: number;
  hit: number;
  sourcesUsed: string[];
  quoteSources: string[];
  conflicts: number;
}> {
  const uniq = [
    ...new Set(
      symbols
        .map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter((s) => s.length >= 3 && s.length <= 12),
    ),
  ].slice(0, 80);

  const concurrency = Math.min(Math.max(opts?.concurrency ?? 6, 1), 12);

  const multi = await getMultiQuotes(uniq).catch(emptyMulti);
  const quoteBySym = new Map<string, Quote>();
  for (const q of multi.quotes) {
    quoteBySym.set(q.symbol.toUpperCase(), q);
  }

  const items: StockMetricsBundle[] = [];
  const sources = new Set<string>(multi.sources);

  await mapPool(uniq, concurrency, async (sym) => {
    try {
      const singleMulti: MultiQuoteResult = {
        quotes: quoteBySym.has(sym) ? [quoteBySym.get(sym)!] : [],
        sources: multi.sources,
        sourceTs: multi.sourceTs,
        latencies: multi.latencies,
        conflicts: multi.conflicts,
      };

      const fetchParts = async () => {
        const [fs, equity, vndRatios] = await Promise.all([
          fetchVndirectFinancials(sym, { limitPeriods: 12 }).catch(() => null),
          getVndEquitySnapshot(sym).catch((): VndEquitySnapshot | null => null),
          getVndValuationRatios(sym).catch((): VndValuationRatios | null => null),
        ]);
        return buildBundleFromParts(sym, singleMulti, fs, equity, vndRatios);
      };

      let bundle: StockMetricsBundle | null;
      if (opts?.skipCache) {
        bundle = await fetchParts();
      } else {
        const res = await cached(`stock:metrics:v2:${sym}`, {
          ttlMs: 60_000,
          staleMs: 300_000,
          softSwr: true,
          producer: async () => {
            const b = await fetchParts();
            if (!b) return null;
            return {
              bundle: b,
              meta: buildMeta({
                source: [...multi.sources, b.sources.financials, "ratio-engine"]
                  .filter(Boolean)
                  .join("+"),
                sourceTimestampMs: multi.sourceTs ?? Date.now(),
              }),
            };
          },
        });
        bundle = res.value?.bundle ?? null;
      }

      if (!bundle) return;
      items.push(bundle);
      if (bundle.sources.financials) sources.add(bundle.sources.financials);
      if (bundle.sources.marketRatios) sources.add(bundle.sources.marketRatios);
    } catch {
      /* skip symbol */
    }
  });

  items.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    items,
    scanned: uniq.length,
    hit: items.length,
    sourcesUsed: [...sources],
    quoteSources: multi.sources,
    conflicts: multi.conflicts,
  };
}
