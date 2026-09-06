import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { validateBars, logQualityEvent } from "../quality";
import { vnDataEngine } from "../engines/vn-data-engine";
import { computeRatioRows } from "../engines/vn-ratio-engine";
import { computeBarConfidence, aggregateConfidence, type DataConfidence } from "../confidence";
import { vnSlasForSession } from "../vn/sessions";
import { analyzeSeries, detectPatterns } from "../technical";
import { filterAndSortRows } from "../engines/screener";
import { VN_SECURITIES } from "../vn/master";
import { getVndFinancials, getVndRatios, type FinancialPeriod, type FinancialReport } from "../providers/vndirect";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";

/**
 * Vietnam equity domain service — VNDirect (finfo) là provider DUY NHẤT.
 * Single-provider: không key, không fallback provider ngoài, không reconciliation.
 * Khi provider offline/lỗi/empty → mọi hàm trả null (API tầng trên trả
 * UNAVAILABLE) — không bao giờ chế số.
 */

export function vndirectConfigured(): boolean {
  // VNDirect finfo là REST public keyless — luôn "configured"; trạng thái thật
  // (reachable/timeout/rate-limit) do provider + health circuit phản ánh.
  return true;
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
      note: res.value.degraded ? "VNDirect index không khả dụng lần này" : undefined,
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
        // VNDirect single-source engine (health-aware + confidence).
        const r = await vnDataEngine.resolveQuotes(symbols);
        if (!r.quotes.length) throw new Error("vndirect failed");
        const confidenceParts: DataConfidence[] = [...r.bySymbol.values()].map((x) => x.confidence);
        return {
          quotes: r.quotes,
          fetchedAt: Date.now(),
          bySymbol: r.bySymbol,
          providers: r.providers,
          note: r.notes.join(" · ") || undefined,
          source: r.providers.join("+"),
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
        // VNDirect dailies → archive fallback (lịch sử tự lưu, không provider ngoài)
        const r = await vnDataEngine.resolveOhlcv(sym, limit);
        if (!r) throw new Error("all vn ohlcv sources unavailable");
        const q = validateBars(r.bars);
        if (q.status !== "VALID") void logQualityEvent(r.provider, `ohlcv:${sym}`, q);
        if (q.status === "INVALID") throw new Error("invalid ohlcv series");
        const gapRatio = gapRatioOf(q.cleaned);
        const confidence = computeBarConfidence({
          quality: q.status,
          gapRatio,
          source: r.provider === "archive" ? "archive" : "primary",
          barCount: q.cleaned.length,
          historySufficient: q.cleaned.length >= 120,
        });
        const note = r.fallback ? "VNDirect OHLCV offline — phục vụ từ archive lịch sử" : undefined;
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

export interface VnEquityDetail {
  symbol: string;
  quote: Quote | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  financials: { income: Record<string, unknown>[] | null; balance: Record<string, unknown>[] | null; cashflow: Record<string, unknown>[] | null; ratios: Record<string, unknown>[] | null };
  notes: string[];
}

const finCache = (key: string, producer: () => Promise<Record<string, unknown>[]>) =>
  cached(`vn:fin:${key}`, { ttlMs: 6 * 3_600_000, staleMs: 90 * 24 * 3_600_000, producer });

async function loadStatements(sym: string, report: FinancialReport, period: FinancialPeriod, limit: number): Promise<Record<string, unknown>[]> {
  try {
    return await getVndFinancials(sym, report, period, limit);
  } catch {
    return [];
  }
}

export async function getVnEquityDetail(symbol: string): Promise<{ detail: VnEquityDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const [quotesRes, ohlcvRes, incomeRes, balanceRes, cashflowRes, ratiosRes] = await Promise.allSettled([
    getVnQuotes([sym]),
    getVnOhlcv(sym, 250),
    finCache(`${sym}:income`, () => loadStatements(sym, "income", "quarter", 12)),
    finCache(`${sym}:balance`, () => loadStatements(sym, "balance", "quarter", 12)),
    finCache(`${sym}:cashflow`, () => loadStatements(sym, "cashflow", "quarter", 12)),
    finCache(`${sym}:ratios`, async () => {
      try {
        const raw = await getVndRatios(sym, 200);
        return raw as unknown as Record<string, unknown>[];
      } catch {
        return [];
      }
    }),
  ]);
  const quote = quotesRes.status === "fulfilled" ? quotesRes.value?.quotes[0] ?? null : null;
  const bars = ohlcvRes.status === "fulfilled" ? ohlcvRes.value?.bars ?? [] : [];
  const income = incomeRes.status === "fulfilled" ? incomeRes.value.value : [];
  const balance = balanceRes.status === "fulfilled" ? balanceRes.value.value : [];
  const cashflow = cashflowRes.status === "fulfilled" ? cashflowRes.value.value : [];
  const failed: string[] = [];
  if (!quote) failed.push("quote");
  if (!bars.length) failed.push("ohlcv");
  if (!income.length) failed.push("income");
  if (!balance.length) failed.push("balance");
  if (!cashflow.length) failed.push("cashflow");

  const price = quote?.price ?? bars[bars.length - 1]?.close ?? null;
  // Ratio: VNDirect raw (itemName) nếu có, cộng standard set từ deterministic engine;
  // không bao giờ để trống khi có statements.
  const providerRows = ratiosRes.status === "fulfilled" ? (ratiosRes.value.value as unknown[]) : [];
  const ratioRows = computeRatioRows(income, balance, cashflow, {
    price,
    providerRatioRows: providerRows.length ? (providerRows as Record<string, unknown>[]) : undefined,
  });

  if (!quote && !bars.length) return null;
  const detail: VnEquityDetail = {
    symbol: sym,
    quote,
    bars,
    technical: bars.length ? analyzeSeries(bars) : null,
    patterns: bars.length ? detectPatterns(bars) : [],
    financials: {
      income: income.length ? income : null,
      balance: balance.length ? balance : null,
      cashflow: cashflow.length ? cashflow : null,
      ratios: ratioRows.length ? (ratioRows as unknown as Record<string, unknown>[]) : null,
    },
    notes: failed.length ? [`Một số bộ dữ liệu chưa khả dụng từ VNDirect: ${failed.join(", ")}`] : [],
  };
  const meta = buildMeta({
    source: "vndirect",
    sourceTimestampMs: quote?.updatedAt ? Date.parse(quote.updatedAt) : bars.length ? bars[bars.length - 1].time : Date.now(),
    degraded: failed.length > 0,
    partial: failed.length > 0,
    note: detail.notes[0],
    slas: vnSlasForSession(),
  });
  meta.providers = ["vndirect"];
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
 * VN equity screener — quotes thật từ VNDirect; universe = Security Master
 * canonical (VN_SECURITIES); không phụ thuộc universe provider ngoài.
 */
export async function screenVnEquities(params: VnScreenerParams): Promise<{ rows: VnScreenerRow[]; meta: Meta; note: string } | null> {
  try {
    const master = new Map(VN_SECURITIES.map((s) => [s.symbol, s]));
    let universeSymbols = VN_SECURITIES.map((s) => s.symbol);
    if (params.symbols && params.symbols.length > 0) {
      const wanted = new Set(params.symbols.map((s) => s.toUpperCase()));
      universeSymbols = universeSymbols.filter((s) => wanted.has(s));
    }
    const candidates = universeSymbols.filter((s) => {
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
    if (!quotes.length) return null;

    const enriched: VnScreenerRow[] = quotes.map((quote) => {
      const m = master.get(quote.symbol);
      return {
        ...quote,
        name: m?.name ?? null,
        exchange: m?.exchange ?? null,
        sector: m?.sector ?? null,
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
      source: "vndirect",
      sourceTimestampMs: Date.now(),
      slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 3_600_000 },
      note: `universe ${universeSymbols.length} · candidates ${candidates.length}`,
    });
    meta.providers = ["vndirect"];
    return { rows, meta, note: `universe ${universeSymbols.length} · candidates ${candidates.length}` };
  } catch {
    return null;
  }
}
