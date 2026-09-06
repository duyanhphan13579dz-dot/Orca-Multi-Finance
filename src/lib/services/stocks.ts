import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as vnstock from "../providers/vnstock";
import * as vndirect from "../providers/vndirect";
import { env } from "../env";
import { buildQuoteSet, logDiscrepancies, reconcileQuotes } from "../reconcile";
import { validateBars, logQualityEvent } from "../quality";
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
      producer: () => vnstock.getVnIndices(),
    });
    const meta = buildMeta({
      source: "vnstock",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
    });
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
        // RECONCILIATION: VNStock (primary) + VNDirect (secondary/validation)
        const [pri, sec] = await Promise.allSettled([vnstock.getVnQuotes(symbols), vndirect.getVndQuotes(symbols)]);
        const priQuotes = pri.status === "fulfilled" ? pri.value : null;
        const secQuotes = sec.status === "fulfilled" ? sec.value : null;
        if (!priQuotes && !secQuotes) throw new Error("both providers failed");
        let quotes: Quote[] = priQuotes ?? secQuotes?.quotes ?? [];
        const discrepancies: { check: string; message: string }[] = [];
        let note: string | undefined;
        let source = priQuotes ? "vnstock" : "vndirect";
        if (priQuotes && secQuotes) {
          const r = reconcileQuotes([
            buildQuoteSet("vnstock", 1, priQuotes),
            buildQuoteSet("vndirect", 2, secQuotes.quotes),
          ]);
          quotes = r.quotes;
          discrepancies.push(...r.discrepancies.map((d) => ({ check: "provider_discrepancy", message: `${d.symbol}: ${d.values.map((v) => `${v.provider}=${v.price}`).join(" vs ")} (${d.deviationPct}%)` })));
          note = r.notes.join(" · ");
          source = "vnstock+vndirect (reconciled)";
          void logDiscrepancies(r);
        } else if (!priQuotes && secQuotes) {
          note = "VNStock lỗi — fallback VNDirect (secondary)";
          source = "vndirect";
        }
        return { quotes, fetchedAt: Date.now(), discrepancies, note, source };
      },
    });
    const meta = buildMeta({
      source: res.value.source,
      sourceTimestampMs: res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      note: res.value.note,
      slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
    });
    meta.discrepancies = res.value.discrepancies;
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
        let bars: OhlcvBar[];
        let source = "vnstock";
        let note: string | undefined;
        try {
          bars = await vnstock.getVnOhlcv(sym, limit);
        } catch {
          bars = await vndirect.getVndOhlcv(sym, limit);
          source = "vndirect";
          note = "VNStock lỗi — fallback VNDirect cho chuỗi OHLCV";
        }
        // DATA QUALITY: validate + sanitize (dupes/out-of-order/invalid bars)
        const q = validateBars(bars);
        if (q.status !== "VALID") void logQualityEvent(source, `ohlcv:${sym}`, q);
        if (q.status === "INVALID") throw new Error("invalid ohlcv series");
        return { bars: q.cleaned, fetchedAt: Date.now(), source, note, qualityStatus: q.status };
      },
    });
    const last = res.value.bars[res.value.bars.length - 1];
    const meta = buildMeta({
      source: res.value.source,
      sourceTimestampMs: last?.time ?? res.value.fetchedAt,
      cached: res.cached,
      stale: res.stale,
      note: res.value.note,
      slas: { liveSlaMs: 3_600_000, freshSlaMs: 8 * 3_600_000, delayedSlaMs: 48 * 3_600_000 },
    });
    meta.qualityStatus = res.value.qualityStatus;
    return { bars: res.value.bars, meta };
  } catch {
    return null;
  }
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
