import "server-only";
import { env } from "../env";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getFinancialsForSymbol, vnProviderLayout } from "../financial";
import type { FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "../financial/types";
import type { FinancialHealthResult } from "../engines/fundamental";
import * as vndirect from "../providers/vndirect";
import {
  getSsiIndices,
  getSsiQuotes,
  getSsiDailyOhlc,
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import { ensureSsiWsStarted, ssiWs } from "../realtime/ssi-ws";
import { bootSsiMarketDataPipeline } from "../realtime/ssi-market-boot";
import { ensureVndirectWsStarted, vndirectWs } from "../realtime/vndirect-ws";
import { isRealtimeWsDisabled } from "../realtime/ws-policy";
import { analyzeSeries, detectPatterns } from "../technical";
import { computeAlphaBeta } from "../engines/alpha-beta";
import type { CandlePattern, IndexQuote, Meta, OhlcvBar, Quote, TechnicalSnapshot } from "../types";
import {
  getVndCompanyProfile,
  getVndEquitySnapshot,
  type VndCompanyProfile,
  type VndEquitySnapshot,
} from "../providers/vndirect-company";
import { getVndSymbolForeignFlow } from "../providers/vndirect-foreign-symbol";
import { getVnOrderBook, type VnOrderBook } from "./stock-orderbook";
import { getMultiQuotes } from "./multi-quote";
import {
  getPublicIndices,
  getPublicQuotes,
  getPublicOhlcv,
  LIQUID_BOARD,
} from "../providers/public-vn-feed";

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    if (ia < 0 && ib < 0) return a.code.localeCompare(b.code);
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
}

export function vnMarketConfigured(): boolean {
  return true;
}

export function vnstockConfigured(): boolean {
  return true;
}

export function vnPrimaryProvider(): "ssi-fcdata" | "vndirect" {
  return ssiFcConfigured() ? "ssi-fcdata" : "vndirect";
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    const tasks: Promise<{ items: IndexQuote[]; source: string; ts?: number } | null>[] = [];
    if (ssiFcConfigured()) {
      tasks.push(
        withTimeout(
          getSsiIndices().then((r) =>
            r?.items?.length ? { items: r.items, source: "ssi-fcdata", ts: Date.now() } : null,
          ),
          4_000,
        ),
      );
    }
    tasks.push(
      withTimeout(
        vndirect.getVndIndices().then((r) =>
          r?.items?.length
            ? { items: r.items, source: "vndirect", ts: r.sourceTs ?? Date.now() }
            : null,
        ),
        5_000,
      ),
    );
    tasks.push(
      withTimeout(
        getPublicIndices().then((pub) => {
          const items = Array.isArray(pub) ? pub : pub?.items;
          return items?.length
            ? {
                items,
                source: "public-indices",
                ts: (pub as { sourceTs?: number })?.sourceTs ?? Date.now(),
              }
            : null;
        }),
        5_000,
      ),
    );
    const settled = await Promise.all(tasks);
    const byCode = new Map<string, IndexQuote>();
    const sources: string[] = [];
    let newest = Date.now();
    for (const pack of settled) {
      if (!pack?.items?.length) continue;
      sources.push(pack.source);
      if (pack.ts) newest = Math.max(newest, pack.ts);
      for (const it of pack.items) {
        const code = String(it.code ?? "").toUpperCase();
        if (!code) continue;
        const prev = byCode.get(code);
        if (!prev || (it.value != null && it.value > 0)) byCode.set(code, it);
      }
    }
    if (!byCode.size) return null;
    return {
      items: sortIndices([...byCode.values()]),
      meta: buildMeta({
        source: sources.join("+") || "indices",
        sourceTimestampMs: newest,
      }),
    };
  } catch {
    return null;
  }
}

function mergeQuotePacks(
  packs: Array<{ quotes: Quote[]; source: string; sourceTs?: number | null } | null | undefined>,
): { quotes: Quote[]; sources: string[]; newest: number } {
  const bySym = new Map<string, Quote>();
  const used: string[] = [];
  let newest = Date.now();
  for (const pack of packs) {
    if (!pack?.quotes?.length) continue;
    used.push(pack.source);
    if (pack.sourceTs) newest = Math.max(newest, pack.sourceTs);
    for (const q of pack.quotes) {
      const sym = String(q.symbol ?? "").toUpperCase();
      if (!sym || !(Number(q.price) > 0)) continue;
      const prev = bySym.get(sym);
      if (!prev) {
        bySym.set(sym, { ...q, symbol: sym });
        continue;
      }
      bySym.set(sym, {
        ...q,
        ...prev,
        name: prev.name ?? q.name,
        volume: prev.volume ?? q.volume,
        quoteVolume: prev.quoteVolume ?? q.quoteVolume,
        open: prev.open ?? q.open,
        high: prev.high ?? q.high,
        low: prev.low ?? q.low,
        change: prev.change ?? q.change,
        changePercent: prev.changePercent ?? q.changePercent,
        referencePrice: prev.referencePrice ?? q.referencePrice,
        ceilingPrice: prev.ceilingPrice ?? q.ceilingPrice,
        floorPrice: prev.floorPrice ?? q.floorPrice,
      });
    }
  }
  return { quotes: [...bySym.values()], sources: used, newest };
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!syms.length) return { quotes: [], meta: buildMeta({ source: "empty", sourceTimestampMs: Date.now() }) };

  type Pack = { quotes: Quote[]; source: string; sourceTs?: number | null };
  const tasks: Promise<Pack | null>[] = [];

  if (ssiFcConfigured()) {
    tasks.push(
      withTimeout(
        getSsiQuotes(syms).then((r) =>
          r?.quotes?.length ? { quotes: r.quotes, source: "ssi-fcdata", sourceTs: Date.now() } : null,
        ),
        5_000,
      ),
    );
  }

  tasks.push(
    withTimeout(
      vndirect.getVndQuotes(syms).then((r) =>
        r?.quotes?.length
          ? { quotes: r.quotes, source: "vndirect", sourceTs: r.sourceTs ?? Date.now() }
          : null,
      ),
      5_500,
    ),
  );

  tasks.push(
    withTimeout(
      getMultiQuotes(syms).then((r) =>
        r?.quotes?.length ? { quotes: r.quotes, source: "multi-quote", sourceTs: Date.now() } : null,
      ),
      8_000,
    ),
  );

  tasks.push(
    withTimeout(
      getPublicQuotes(syms).then((r) =>
        r?.quotes?.length
          ? {
              quotes: r.quotes,
              source: (r.sources ?? []).join("+") || "public-vn",
              sourceTs: r.sourceTs ?? Date.now(),
            }
          : null,
      ),
      6_500,
    ),
  );

  try {
    const { getVietcapQuotes } = await import("../providers/vietcap");
    tasks.push(
      withTimeout(
        getVietcapQuotes(syms.slice(0, 20)).then((r) =>
          r?.quotes?.length ? { quotes: r.quotes, source: "vietcap", sourceTs: r.sourceTs ?? Date.now() } : null,
        ),
        6_000,
      ),
    );
  } catch {
    /* optional */
  }

  const settled = await Promise.all(tasks);
  const order = ["ssi-fcdata", "vndirect", "multi-quote", "public-vn", "vps", "ssi-iboard", "vietcap"];
  const ranked = [...settled].filter(Boolean).sort((a, b) => {
    const ia = order.findIndex((x) => a!.source === x || a!.source.startsWith(x));
    const ib = order.findIndex((x) => b!.source === x || b!.source.startsWith(x));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }) as Pack[];

  const merged = mergeQuotePacks(ranked);
  if (!merged.quotes.length) {
    return {
      quotes: [],
      meta: buildMeta({
        source: "unavailable",
        sourceTimestampMs: Date.now(),
        note: "all quote sources empty",
        partial: true,
      }),
    };
  }
  return {
    quotes: merged.quotes,
    meta: buildMeta({
      source: merged.sources.join("+") || "vn-quotes",
      sourceTimestampMs: merged.newest,
      partial: merged.quotes.length < syms.length,
    }),
  };
}

export async function getVnOhlcv(
  symbol: string,
  limit = 260,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  const isIndex = vndirect.isVnIndexSymbol(sym);
  const kind = isIndex ? ("index" as const) : ("stock" as const);

  const raceBars = async (): Promise<{ bars: OhlcvBar[]; source: string } | null> => {
    type Cand = { bars: OhlcvBar[]; source: string };
    const tasks: Promise<Cand | null>[] = [
      withTimeout(
        (async () => {
          try {
            const { fetchVndDchartHistory } = await import("../providers/vndirect-dchart");
            const bars = await fetchVndDchartHistory(sym, "D", Math.min(Math.max(limit, 40), 2000));
            return bars?.length ? { bars: bars.slice(-limit), source: "vndirect-dchart" } : null;
          } catch {
            return null;
          }
        })(),
        8_000,
      ),
      withTimeout(
        (isIndex ? vndirect.getVndIndexOhlcv(sym, limit) : vndirect.getVndOhlcv(sym, limit))
          .then((bars) => (bars?.length ? { bars, source: "vndirect" } : null))
          .catch(() => null),
        7_000,
      ),
      withTimeout(
        getPublicOhlcv(sym, limit, kind)
          .then((bars) => (bars?.length ? { bars, source: "public" } : null))
          .catch(() => null),
        7_000,
      ),
    ];
    if (ssiFcConfigured() && !isIndex) {
      tasks.push(
        withTimeout(
          getSsiDailyOhlc(sym, { pageSize: Math.max(limit, 320) })
            .then((bars) => (bars?.length ? { bars: bars.slice(-limit), source: "ssi-fcdata" } : null))
            .catch(() => null),
          7_000,
        ),
      );
    }
    const settled = await Promise.all(tasks);
    const ok = settled.filter((x): x is Cand => Boolean(x?.bars?.length));
    if (!ok.length) return null;
    ok.sort((a, b) => {
      const score = (c: Cand) => {
        const len = c.bars.length >= 20 ? c.bars.length : c.bars.length * 0.5;
        const bonus =
          c.source === "vndirect-dchart" ? 80 : c.source === "vndirect" ? 40 : c.source === "public" ? 20 : 0;
        return len + bonus;
      };
      return score(b) - score(a);
    });
    return ok[0]!;
  };

  try {
    let ohlcvTtl = 30_000;
    let ohlcvStale = 180_000;
    try {
      const { getVnSession } = await import("../vn/sessions");
      if (getVnSession().trading) {
        ohlcvTtl = 12_000;
        ohlcvStale = 90_000;
      }
    } catch {
      /* */
    }
    const res = await cached(`vn:ohlcv:race:${sym}:${limit}:v3`, {
      ttlMs: ohlcvTtl,
      staleMs: ohlcvStale,
      softSwr: true,
      producer: async () => {
        let pack = await raceBars();
        if (!pack || pack.bars.length < 20) {
          pack = (await raceBars()) ?? pack;
        }
        if (!pack?.bars?.length) throw new Error(`ohlcv empty ${sym}`);
        return pack;
      },
    });
    const pack = res.value as { bars: OhlcvBar[]; source: string };
    return {
      bars: pack.bars,
      meta: buildMeta({
        source: `${pack.source}-ohlcv`,
        sourceTimestampMs: pack.bars[pack.bars.length - 1]?.time ?? Date.now(),
      }),
    };
  } catch {
    try {
      const pack = await raceBars();
      if (pack?.bars?.length) {
        return {
          bars: pack.bars,
          meta: buildMeta({
            source: `${pack.source}-ohlcv`,
            sourceTimestampMs: pack.bars[pack.bars.length - 1]?.time,
          }),
        };
      }
    } catch {
      /* */
    }
    return null;
  }
}

export async function getVnMarketBoard(): Promise<{
  indices: IndexQuote[];
  quotes: Quote[];
  meta: Meta;
} | null> {
  try {
    const [idx, q] = await Promise.all([getVnIndices(), getVnQuotes(LIQUID_BOARD)]);
    const indices = idx?.items ?? [];
    const quotes = q?.quotes ?? [];
    if (!indices.length && !quotes.length) return null;
    return {
      indices,
      quotes,
      meta: buildMeta({
        source: [idx?.meta.source, q?.meta.source].filter(Boolean).join("+") || "board",
        sourceTimestampMs: Date.now(),
        partial: !indices.length || !quotes.length,
      }),
    };
  } catch {
    return null;
  }
}

export async function getVnUniverseList(): Promise<{ symbols: string[]; meta: Meta } | null> {
  try {
    const board = await getVnMarketBoard();
    const symbols = [...new Set((board?.quotes ?? []).map((q) => q.symbol).filter(Boolean))];
    if (!symbols.length) {
      return {
        symbols: [...LIQUID_BOARD],
        meta: buildMeta({ source: "liquid-board-fallback", sourceTimestampMs: Date.now(), partial: true }),
      };
    }
    return {
      symbols,
      meta: board?.meta ?? buildMeta({ source: "board", sourceTimestampMs: Date.now() }),
    };
  } catch {
    return {
      symbols: [...LIQUID_BOARD],
      meta: buildMeta({ source: "liquid-board-fallback", sourceTimestampMs: Date.now(), partial: true }),
    };
  }
}

export interface VnStockDetail {
  symbol: string;
  name: string | null;
  quote: Quote | null;
  bars: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  equity: VndEquitySnapshot | null;
  sharesOutstanding: number | null;
  profile: VndCompanyProfile | null;
  orderBook: VnOrderBook | null;
  foreignFlow: { latest: unknown; history: unknown } | null;
  financials: unknown;
  financialHealth: FinancialHealthResult | null;
  financialMeta: FinancialPackageMeta | null;
  financialGrowth: GrowthSnapshot | null;
  financialTtm: NormalizedPeriod | null;
  detailedRatios: unknown;
  ratioMap: Record<string, unknown>;
  metricsSources: string[];
  notes: string[];
}

export async function getVnStockDetail(symbol: string): Promise<{ detail: VnStockDetail; meta: Meta } | null> {
  const sym = symbol.toUpperCase();
  try {
    const [quoteRes, ohlcvRes] = await Promise.all([
      getVnQuotes([sym]).catch(() => null),
      getVnOhlcv(sym, 320).catch(() => null),
    ]);
    const quote = quoteRes?.quotes?.[0] ?? null;
    const bars = ohlcvRes?.bars ?? [];
    let technical: TechnicalSnapshot | null = null;
    let patterns: CandlePattern[] = [];
    if (bars.length >= 20) {
      try {
        technical = analyzeSeries(bars);
        patterns = detectPatterns(bars);
      } catch {
        /* */
      }
    }
    const detail: VnStockDetail = {
      symbol: sym,
      name: quote?.name ?? null,
      quote,
      bars,
      technical,
      patterns,
      equity: null,
      sharesOutstanding: null,
      profile: null,
      orderBook: null,
      foreignFlow: null,
      financials: { income: null, balance: null, cashflow: null, ratios: null },
      financialHealth: null,
      financialMeta: null,
      financialGrowth: null,
      financialTtm: null,
      detailedRatios: null,
      ratioMap: {},
      metricsSources: [],
      notes: [],
    };
    return {
      detail,
      meta: buildMeta({
        source: [quoteRes?.meta.source, ohlcvRes?.meta.source].filter(Boolean).join("+") || "vn",
        sourceTimestampMs: Date.now(),
        partial: !quote || !bars.length,
      }),
    };
  } catch {
    return null;
  }
}

void env;
void vnProviderLayout;
void ssiWs;
void vndirectWs;
