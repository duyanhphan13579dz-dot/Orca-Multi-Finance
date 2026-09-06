import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as vnstock from "../providers/vnstock";
import { env } from "../env";
import { validateBars, logQualityEvent } from "../quality";
import { vnDataEngine } from "../engines/vn-data-engine";
import { computeBarConfidence, aggregateConfidence, type DataConfidence } from "../confidence";
import { vnSlasForSession } from "../vn/sessions";
import { analyzeSeries, detectPatterns } from "../technical";
import { filterAndSortRows } from "../engines/screener";
import { VN_SECURITIES } from "../vn/master";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain service.
 * Primary provider: VNStock (env-configured, API-key authenticated).
 * When the provider is not configured or degraded, every function returns
 * null and API layer surfaces UNAVAILABLE — never fabricated data.
 */

export function vnstockConfigured(): boolean {
  return Boolean(env.vnstockApiKey);
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    const res = await cached("vn:indices", {
      ttlMs: 30_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const r = await vnDataEngine.resolveIndices();
        if (!r) throw new Error("no index provider");
        return r;
      },
    });
    const meta = buildMeta({
      source: res.value.providers.join("+"),
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.degraded,
      note: res.value.degraded ? "Có nguồn index không khả dụng lần này" : undefined,
      slas: vnSlasForSession(),
    });
    if (res.value.confidence) meta.dataConfidence = res.value.confidence;
    return { items: res.value.items, meta };
  } catch {
    return null;
  }
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  if (!symbols.length) return null;
  try {
    const res = await cached(`vn:quotes:${symbols.slice(0, 30).join(",")}`, {
      ttlMs: 15_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        // MULTI-PROVIDER: VNStock (primary) + VNDirect (secondary) —
        // health-aware routing, graceful fallback, reconciliation + confidence.
        const r = await vnDataEngine.resolveQuotes(symbols);
        if (!r.quotes.length) throw new Error("all vn providers failed");
        const confidenceParts: DataConfidence[] = [...r.bySymbol.values()].map((x) => x.confidence);
        return {
          quotes: r.quotes,
          fetchedAt: Date.now(),
          bySymbol: r.bySymbol,
          providers: r.providers,
          discrepancies: r.discrepancies.map((d) => ({ check: "provider_discrepancy", message: `${d.symbol}: ${d.values.map((v) => `${v.provider}=${v.price}`).join(" vs ")} (${d.deviationPct}%)` })),
          note: r.notes.join(" · ") || undefined,
          source: r.providers.join("+") + (r.fallback ? " (fallback)" : ""),
          degraded: r.degraded,
          confidence: aggregateConfidence(confidenceParts),
        };
      },
    });
    const meta = buildMeta({
      source: res.value.source,
      sourceTimestampMs: res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.degraded,
      note: res.value.note,
      slas: vnSlasForSession(),
    });
    meta.discrepancies = res.value.discrepancies;
    if (res.value.confidence) meta.dataConfidence = res.value.confidence;
    if (res.value.providers?.length) meta.providers = res.value.providers;
    return { quotes: res.value.quotes, meta };
  } catch {
    return null;
  }
}

export async function getVnOhlcv(symbol: string, limit = 250): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  try {
    const sym = symbol.toUpperCase();
    const res = await cached(`vn:ohlcv:${sym}:${limit}`, {
      ttlMs: 60_000,
      staleMs: 7 * 24 * 3_600_000,
      producer: async () => {
        // MULTI-PROVIDER + ARCHIVE FALLBACK: vnstock → vndirect → archive
        const r = await vnDataEngine.resolveOhlcv(sym, limit);
        if (!r) throw new Error("all vn ohlcv sources unavailable");
        // DATA QUALITY: validate + sanitize (dupes/out-of-order/invalid bars)
        const q = validateBars(r.bars);
        if (q.status !== "VALID") void logQualityEvent(r.provider, `ohlcv:${sym}`, q);
        if (q.status === "INVALID") throw new Error("invalid ohlcv series");
        const gapRatio = gapRatioOf(q.cleaned);
        const confidence = computeBarConfidence({
          quality: q.status,
          gapRatio,
          source: r.provider === "archive" ? "archive" : r.provider === "vndirect" ? "secondary" : "primary",
          barCount: q.cleaned.length,
          historySufficient: q.cleaned.length >= 120,
        });
        const note = r.fallback ? (r.provider === "archive" ? "Provider OHLCV offline — phục vụ từ archive lịch sử" : "VNStock lỗi — fallback VNDirect cho chuỗi OHLCV") : undefined;
        return { bars: q.cleaned, fetchedAt: Date.now(), source: r.provider, note, qualityStatus: q.status, confidence, degraded: r.degraded };
      },
    });
    const last = res.value.bars[res.value.bars.length - 1];
    const meta = buildMeta({
      source: res.value.source,
      sourceTimestampMs: last?.time ?? res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.degraded,
      note: res.value.note,
      slas: { liveSlaMs: 3_600_000, freshSlaMs: 8 * 3_600_000, delayedSlaMs: 48 * 3_600_000 },
    });
    meta.qualityStatus = res.value.qualityStatus;
    meta.dataConfidence = res.value.confidence;
    return { bars: res.value.bars, meta };
  } catch {
    return null;
  }
}

/** Gap ratio: phần thiếu giữa các bar liền kề trên tổng số gaps. */
function gapRatioOf(bars: OhlcvBar[]): number {
  if (bars.length < 2) return 0;
  const DAY = 86_400_000;
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].time - bars[i - 1].time;
    if (diff > DAY * 1.5) gaps += 1;
  }
  return gaps / (bars.length - 1);
}

export interface VnStockDetail {
  symbol: string;
  quote: Quote | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  financials: { income: Record<string, unknown>[] | null; balance: Record<string, unknown>[] | null; cashflow: Record<string, unknown>[] | null; ratios: Record<string, unknown>[] | null };
  notes: string[];
}

export async function getVnStockDetail(symbol: string): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  if (!vnstockConfigured()) return null;
  const [quotesRes, ohlcvRes, incomeRes, balanceRes, cashflowRes, ratiosRes] = await Promise.allSettled([
    getVnQuotes([sym]),
    getVnOhlcv(sym, 250),
    cached(`vn:fin:${sym}:income`, { ttlMs: 6 * 3_600_000, staleMs: 90 * 24 * 3_600_000, producer: () => vnstock.getVnFinancials(sym, "income", "quarter", 8) }),
    cached(`vn:fin:${sym}:balance`, { ttlMs: 6 * 3_600_000, staleMs: 90 * 24 * 3_600_000, producer: () => vnstock.getVnFinancials(sym, "balance", "quarter", 8) }),
    cached(`vn:fin:${sym}:cashflow`, { ttlMs: 6 * 3_600_000, staleMs: 90 * 24 * 3_600_000, producer: () => vnstock.getVnFinancials(sym, "cashflow", "quarter", 8) }),
    cached(`vn:fin:${sym}:ratios`, { ttlMs: 6 * 3_600_000, staleMs: 90 * 24 * 3_600_000, producer: () => vnstock.getVnFinancials(sym, "ratios", "quarter", 8) }),
  ]);
  const quote = quotesRes.status === "fulfilled" ? quotesRes.value?.quotes[0] ?? null : null;
  const bars = ohlcvRes.status === "fulfilled" ? ohlcvRes.value?.bars ?? [] : [];
  const failed: string[] = [];
  if (!quote) failed.push("quote");
  if (!bars.length) failed.push("ohlcv");
  if (incomeRes.status === "rejected") failed.push("income");
  if (balanceRes.status === "rejected") failed.push("balance");
  if (cashflowRes.status === "rejected") failed.push("cashflow");
  if (ratiosRes.status === "rejected") failed.push("ratios");
  if (!quote && !bars.length) return null;
  const detail: VnStockDetail = {
    symbol: sym,
    quote,
    bars,
    technical: bars.length ? analyzeSeries(bars) : null,
    patterns: bars.length ? detectPatterns(bars) : [],
    financials: {
      income: incomeRes.status === "fulfilled" ? incomeRes.value.value.map((x) => x as Record<string, unknown>) : null,
      balance: balanceRes.status === "fulfilled" ? balanceRes.value.value.map((x) => x as Record<string, unknown>) : null,
      cashflow: cashflowRes.status === "fulfilled" ? cashflowRes.value.value.map((x) => x as Record<string, unknown>) : null,
      ratios: ratiosRes.status === "fulfilled" ? ratiosRes.value.value.map((x) => x as Record<string, unknown>) : null,
    },
    notes: failed.length ? [`Một số bộ dữ liệu chưa khả dụng từ VNStock: ${failed.join(", ")}`] : [],
  };
  const meta = buildMeta({
    source: "vnstock",
    sourceTimestampMs: quote?.updatedAt ? Date.parse(quote.updatedAt) : bars.length ? bars[bars.length - 1].time : Date.now(),
    degraded: failed.length > 0,
    partial: failed.length > 0,
    note: detail.notes[0],
  });
  return { detail, meta };
}

/* -------------------------------- Screener -------------------------------- */

export interface VnScreenerParams {
  minChange?: number;
  maxChange?: number;
  minQuoteVolume?: number;
  sort?: "gainers" | "losers" | "volume";
  limit?: number;
  exchange?: "HOSE" | "HNX" | "UPCOM";
  sector?: string;
  symbols?: string[];
}

export interface VnScreenerRow extends Quote {
  name: string | null;
  exchange: string | null;
  sector: string | null;
}

/**
 * VN equity screener — real provider data only.
 * Universe (name/exchange/industry) from VNStock; taxonomy (sector) from the
 * canonical Security Master; quotes fetched in chunks (≤30/call).
 */
export async function screenVnStocks(params: VnScreenerParams): Promise<{ rows: VnScreenerRow[]; meta: Meta; note: string } | null> {
  if (!vnstockConfigured()) return null;
  try {
    const universe = await vnstock.getVnUniverse();
    if (!universe.length) return null;
    let universeSymbols = universe.map((u) => u.symbol);
    if (params.symbols && params.symbols.length > 0) {
      const wanted = new Set(params.symbols);
      universeSymbols = universeSymbols.filter((s) => wanted.has(s));
    }
    const master = new Map(VN_SECURITIES.map((s) => [s.symbol, s]));
    const bySym = new Map(universe.map((u) => [u.symbol, u]));
    let candidates = universeSymbols.filter((s) => {
      const m = master.get(s);
      if (params.exchange && m && m.exchange !== params.exchange) return false;
      if (params.sector && m && m.sector !== params.sector) return false;
      return true;
    });

    const perChunk = 30;
    const quotes: Quote[] = [];
    for (let i = 0; i < candidates.length && quotes.length < 200; i += perChunk) {
      const chunk = candidates.slice(i, i + perChunk);
      const q = await getVnQuotes(chunk);
      if (q) quotes.push(...q.quotes);
    }

    const enriched: VnScreenerRow[] = quotes.map((quote) => {
      const m = master.get(quote.symbol);
      const u = bySym.get(quote.symbol);
      return {
        ...quote,
        name: m?.name ?? u?.name ?? null,
        exchange: m?.exchange ?? u?.exchange ?? null,
        sector: m?.sector ?? u?.industry ?? null,
      };
    });

    const rows = filterAndSortRows(enriched, {
      minChange: params.minChange,
      maxChange: params.maxChange,
      minQuoteVolume: params.minQuoteVolume,
      sort: params.sort,
      limit: Math.min(params.limit ?? 40, 100),
    });

    const meta = buildMeta({
      source: "vnstock",
      sourceTimestampMs: Date.now(),
      slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
      note: `universe ${universeSymbols.length} · candidates ${candidates.length}`,
    });
    return { rows, meta, note: `universe ${universeSymbols.length} · candidates ${candidates.length}` };
  } catch {
    return null;
  }
}
