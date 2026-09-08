import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as vnstock from "../providers/vnstock";
import { getFinancialsForSymbol } from "../financial/service";
import type { FinancialPackageMeta } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import { env } from "../env";
import { buildQuoteSet, logDiscrepancies, reconcileQuotes } from "../reconcile";
import { validateBars, logQualityEvent } from "../quality";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain service.
 * Full market board via VNDirect (api-finfo); VNStock optional for enrichment/reconcile.
 * Financials via Financial Report Data Engine (VNStock → VNDirect FS → cache).
 * Never fabricates Vietnam market numbers.
 */

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function vnstockConfigured(): boolean {
  return Boolean(env.vnstockApiKey);
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    const res = await cached("vn:indices:v3", {
      ttlMs: 45_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        if (vnstockConfigured()) {
          try {
            return await vnstock.getVnIndices();
          } catch {
            /* fall through */
          }
        }
        return vndirect.getVndIndices();
      },
    });
    const meta = buildMeta({
      source: res.value.sourceTs != null ? "vndirect|vnstock" : "vndirect",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      note: "Chỉ số VN (VNINDEX/VN30/HNX/UPCOM)",
      slas: { liveSlaMs: 30_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
    });
    return { items: sortIndices(res.value.items), meta };
  } catch {
    return null;
  }
}

/** Full VN equity market board — all listed stocks for latest session. */
export async function getVnMarketBoard(): Promise<{
  quotes: Quote[];
  indices: IndexQuote[];
  universe: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[];
  sessionDate: string;
  meta: Meta;
} | null> {
  try {
    const res = await cached("vn:market-board:v2", {
      ttlMs: 60_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const [board, indices, universe] = await Promise.all([
          vndirect.getVndMarketQuotes(),
          vndirect.getVndIndices().catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null })),
          vndirect.getVndUniverse().catch(
            () => [] as { symbol: string; name: string | null; exchange: string | null; industry: string | null }[],
          ),
        ]);
        const bySym = new Map(universe.map((u) => [u.symbol, u]));
        const quotes = board.quotes.map((q) => {
          const u = bySym.get(q.symbol);
          return u ? { ...q, name: q.name ?? u.name } : q;
        });
        return {
          quotes,
          indices: sortIndices(indices.items),
          universe,
          sessionDate: board.sessionDate,
          sourceTs: board.sourceTs ?? indices.sourceTs,
        };
      },
    });
    const meta = buildMeta({
      source: "vndirect (api-finfo) full market",
      sourceTimestampMs: res.value.sourceTs,
      cached: res.cached,
      stale: res.stale,
      note: `Phiên ${res.value.sessionDate} · ${res.value.quotes.length} mã · ${res.value.universe.length} listed`,
      slas: { liveSlaMs: 60_000, freshSlaMs: 600_000, delayedSlaMs: 6 * 3_600_000 },
    });
    return {
      quotes: res.value.quotes,
      indices: res.value.indices,
      universe: res.value.universe,
      sessionDate: res.value.sessionDate,
      meta,
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<
  | { items: { symbol: string; name: string | null; exchange: string | null; industry: string | null }[]; meta: Meta }
  | null
> {
  try {
    const res = await cached("vn:universe:v1", {
      ttlMs: 6 * 3_600_000,
      staleMs: 7 * 24 * 3_600_000,
      producer: async () => {
        if (vnstockConfigured()) {
          try {
            return await vnstock.getVnUniverse();
          } catch {
            /* fall through */
          }
        }
        return vndirect.getVndUniverse();
      },
    });
    return {
      items: res.value,
      meta: buildMeta({ source: "vndirect|vnstock", sourceTimestampMs: Date.now(), cached: res.cached, stale: res.stale }),
    };
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
        const [pri, sec] = await Promise.allSettled([
          vnstockConfigured() ? vnstock.getVnQuotes(symbols) : Promise.reject(new Error("vnstock off")),
          vndirect.getVndQuotes(symbols),
        ]);
        const priQuotes = pri.status === "fulfilled" ? pri.value : null;
        const secQuotes = sec.status === "fulfilled" ? sec.value : null;
        if (!priQuotes && !secQuotes) throw new Error("both providers failed");
        let quotes: Quote[] = priQuotes ?? secQuotes?.quotes ?? [];
        let source = priQuotes ? "vnstock" : "vndirect";
        let sourceTs: number | null = secQuotes?.sourceTs ?? null;
        if (priQuotes && secQuotes) {
          const r = reconcileQuotes([
            buildQuoteSet("vnstock", 1, priQuotes),
            buildQuoteSet("vndirect", 2, secQuotes.quotes),
          ]);
          quotes = r.quotes;
          const winners = [...new Set(r.winnerProviders.values())];
          source = winners.length ? winners.join("|") : source;
          void logDiscrepancies(r);
        }
        return { quotes, source, sourceTs };
      },
    });
    return {
      quotes: res.value.quotes,
      meta: buildMeta({
        source: res.value.source,
        sourceTimestampMs: res.value.sourceTs,
        cached: res.cached,
        stale: res.stale,
      }),
    };
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
          if (vndirect.isVnIndexSymbol(sym)) {
            bars = await vndirect.getVndIndexOhlcv(sym, limit);
            source = "vndirect-index";
            note = "Chuỗi OHLCV chỉ số từ VNDirect";
          } else if (!vnstockConfigured()) {
            throw new Error("vnstock off");
          } else {
            bars = await vnstock.getVnOhlcv(sym, limit);
          }
        } catch {
          bars = await vndirect.getVndOhlcv(sym, limit);
          source = "vndirect";
          note = "Chuỗi OHLCV từ VNDirect";
        }
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
  financials: {
    income: Record<string, unknown>[] | null;
    balance: Record<string, unknown>[] | null;
    cashflow: Record<string, unknown>[] | null;
    ratios: Record<string, unknown>[] | null;
  };
  financialHealth: FinancialHealthResult | null;
  financialMeta: FinancialPackageMeta | null;
  notes: string[];
}

export async function getVnStockDetail(symbol: string): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const [quotesRes, ohlcvRes, finRes] = await Promise.allSettled([
    getVnQuotes([sym]),
    getVnOhlcv(sym, 250),
    getFinancialsForSymbol(sym),
  ]);
  const quote = quotesRes.status === "fulfilled" ? quotesRes.value?.quotes[0] ?? null : null;
  const bars = ohlcvRes.status === "fulfilled" ? ohlcvRes.value?.bars ?? [] : [];
  const fin = finRes.status === "fulfilled" ? finRes.value : null;
  const failed: string[] = [];
  if (!quote) failed.push("quote");
  if (!bars.length) failed.push("ohlcv");
  if (!fin?.financials.income && !fin?.financials.balance) failed.push("financials");
  if (!quote && !bars.length && !fin) return null;

  const notes: string[] = [];
  if (failed.length) notes.push(`Một số bộ dữ liệu chưa khả dụng: ${failed.join(", ")}`);
  if (fin?.notes?.length) notes.push(...fin.notes);

  const detail: VnStockDetail = {
    symbol: sym,
    quote,
    bars,
    technical: bars.length ? analyzeSeries(bars) : null,
    patterns: bars.length ? detectPatterns(bars) : [],
    financials: fin?.financials ?? { income: null, balance: null, cashflow: null, ratios: null },
    financialHealth: fin?.health ?? null,
    financialMeta: fin?.packageMeta ?? null,
    notes,
  };
  const meta = buildMeta({
    source: fin?.packageMeta?.primarySource
      ? `market+financial-engine|${fin.packageMeta.primarySource}`
      : quote || bars.length
        ? "vndirect|vnstock"
        : "unavailable",
    sourceTimestampMs: quote?.updatedAt
      ? Date.parse(quote.updatedAt)
      : bars.length
        ? bars[bars.length - 1].time
        : Date.now(),
    degraded: failed.length > 0,
    partial: failed.length > 0,
    note: notes[0],
  });
  return { detail, meta };
}
