import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as vndirect from "../providers/vndirect";
import {
  getSsiIndices,
  getSsiDailyOhlc,
  ssiFcConfigured,
} from "../providers/ssi-fcdata";
import type { IndexQuote, Meta, OhlcvBar, Quote } from "../types";
import {
  marketSourceIdFor,
  recordMarketSource,
} from "../realtime/market-source-monitor";
import { getMultiQuotes } from "./multi-quote";
import {
  getPublicIndices,
  getPublicQuotes,
  getPublicOhlcvPack,
  LIQUID_BOARD,
} from "../providers/public-vn-feed";
import { getVnUniverse } from "./vn-universe";

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

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.then((v) => v).catch(() => null as T | null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function getVnQuotes(symbols: string[]): Promise<{ quotes: Quote[]; meta: Meta } | null> {
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (!syms.length) return { quotes: [], meta: buildMeta({ source: "empty", sourceTimestampMs: Date.now() }) };

  try {
    const multi = await getMultiQuotes(syms);
    if (multi.quotes.length) {
      return {
        quotes: multi.quotes,
        meta: buildMeta({
          source: multi.sources.join("+") || "multi-quote",
          sourceTimestampMs: multi.sourceTs ?? Date.now(),
          partial: multi.quotes.length < syms.length,
          note:
            multi.conflicts > 0
              ? `price-conflicts=${multi.conflicts}; latencies=${JSON.stringify(multi.latencies)}`
              : `latencies=${JSON.stringify(multi.latencies)}`,
        }),
      };
    }
  } catch {
    /* fall through */
  }

  try {
    const pub = await withTimeout(getPublicQuotes(syms), 6_500);
    if (pub?.quotes?.length) {
      return {
        quotes: pub.quotes,
        meta: buildMeta({
          source: (pub.sources ?? []).join("+") || "public-vn",
          sourceTimestampMs: pub.sourceTs ?? Date.now(),
          partial: pub.quotes.length < syms.length,
          note: "multi-quote empty — public last resort",
        }),
      };
    }
  } catch {
    /* ignore */
  }

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
        (isIndex ? vndirect.getVndIndexOhlcv(sym, limit) : vndirect.getVndOhlcv(sym, limit))
          .then((bars) => (bars?.length ? { bars, source: "vndirect" } : null))
          .catch(() => null),
        7_000,
      ),
      withTimeout(
        getPublicOhlcvPack(sym, limit, kind)
          .then((pack) => (pack?.bars?.length ? { bars: pack.bars, source: `public:${pack.source}` } : null))
          .catch(() => null),
        7_000,
      ),
    ];
    // dchart lives on a different VNDirect host than api-finfo, so it survives an
    // api-finfo outage and adds intraday-grade candles to the race.
    tasks.push(
      withTimeout(
        import("../providers/vndirect-dchart")
          .then((m) => m.fetchVndDchartHistory(sym, "D", limit))
          .then((bars) => (bars?.length ? { bars, source: "vndirect-dchart" } : null))
          .catch(() => null),
        7_000,
      ),
    );
    if (ssiFcConfigured()) {
      tasks.push(
        withTimeout(
          (isIndex
            ? import("../providers/ssi-market-catalog")
                .then((m) => m.getSsiIndexHistory(sym, { pageSize: Math.max(limit, 200) }))
                .then((rows) =>
                  rows
                    .filter((r) => !r.synthetic)
                    .map((r) => ({
                      time: r.time,
                      open: r.open,
                      high: r.high,
                      low: r.low,
                      close: r.close,
                      volume: r.volume ?? 0,
                    })),
                )
            : getSsiDailyOhlc(sym, { pageSize: limit })
          )
            .then((bars) => (bars?.length ? { bars, source: "ssi-fcdata" } : null))
            .catch(() => null),
          7_000,
        ),
      );
    }
    const settled = await Promise.all(tasks);
    const ok = settled.filter((x): x is Cand => Boolean(x?.bars?.length));
    if (!ok.length) return null;
    ok.sort((a, b) => {
      const aOk = a.bars.length >= 20 ? 1 : 0;
      const bOk = b.bars.length >= 20 ? 1 : 0;
      if (aOk !== bOk) return bOk - aOk;
      return b.bars.length - a.bars.length;
    });
    return ok[0]!;
  };

  try {
    const res = await cached(`vn:ohlcv:${sym}:${limit}`, {
      ttlMs: 60_000,
      staleMs: 30 * 60_000,
      producer: async () => {
        const pack = await raceBars();
        if (!pack?.bars?.length) throw new Error(`ohlcv empty ${sym}`);
        const monitorId = marketSourceIdFor(pack.source);
        if (monitorId) recordMarketSource(monitorId, true, 0);
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
  universeSize?: number;
  sessionDate?: string | null;
} | null> {
  const loadOnce = async () => {
    const [idx, q] = await Promise.all([
      getVnIndices().catch(() => null),
      getVnQuotes(LIQUID_BOARD).catch(() => null),
    ]);
    return {
      indices: idx?.items ?? [],
      quotes: q?.quotes ?? [],
      sources: [idx?.meta?.source, q?.meta?.source].filter(Boolean) as string[],
    };
  };
  try {
    let pack = await loadOnce();
    if (!pack.indices.length && !pack.quotes.length) {
      await new Promise((r) => setTimeout(r, 350));
      pack = await loadOnce();
    }
    if (!pack.indices.length && !pack.quotes.length) {
      try {
        const [pubIdx, pubQ] = await Promise.all([
          getPublicIndices().catch(() => null),
          getPublicQuotes(LIQUID_BOARD.slice(0, 50)).catch(() => null),
        ]);
        const items = pubIdx?.items ?? [];
        if (items.length) {
          pack.indices = items;
          pack.sources.push("public-indices");
        }
        if (pubQ?.quotes?.length) {
          pack.quotes = pubQ.quotes;
          pack.sources.push(...(pubQ.sources ?? ["public-vn"]));
        }
      } catch {
        /* */
      }
    }
    if (!pack.indices.length && !pack.quotes.length) return null;
    return {
      indices: pack.indices,
      quotes: pack.quotes,
      universeSize: pack.quotes.length || LIQUID_BOARD.length,
      sessionDate: null,
      meta: buildMeta({
        source: pack.sources.join("+") || "board",
        sourceTimestampMs: Date.now(),
        partial: !pack.indices.length || !pack.quotes.length,
        note: !pack.indices.length
          ? "Chỉ số tạm thiếu — quotes public"
          : !pack.quotes.length
            ? "Quotes tạm thiếu — chỉ số public"
            : undefined,
      }),
    };
  } catch {
    return null;
  }
}

/**
 * Full listed-equity universe (VNDirect + SSI iBoard, cached 6h).
 * Falls back to board quotes and finally LIQUID_BOARD — always labelled via meta.source.
 */
export async function getVnUniverseList(opts?: {
  exchange?: string | null;
  limit?: number | null;
}): Promise<{ symbols: string[]; meta: Meta } | null> {
  const exchange = (opts?.exchange ?? "").trim().toUpperCase();
  try {
    const universe = await getVnUniverse();
    let rows = universe.rows;
    if (exchange && exchange !== "ALL") {
      rows = rows.filter((r) => String(r.exchange ?? "").toUpperCase().includes(exchange));
    }
    const limit = Number(opts?.limit ?? 0);
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, Math.floor(limit));
    const symbols = rows.map((r) => r.symbol);
    if (symbols.length >= 20) {
      return {
        symbols,
        meta: buildMeta({
          source: universe.source,
          sourceTimestampMs: universe.producedAt,
          cached: universe.cached,
          stale: universe.stale,
          partial: universe.partial,
          note: `${symbols.length} mã niêm yết${exchange && exchange !== "ALL" ? ` · ${exchange}` : ""}`,
        }),
      };
    }
  } catch {
    /* fall through to board quotes */
  }

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
      meta: board?.meta ?? buildMeta({ source: "board", sourceTimestampMs: Date.now(), partial: true }),
    };
  } catch {
    return {
      symbols: [...LIQUID_BOARD],
      meta: buildMeta({ source: "liquid-board-fallback", sourceTimestampMs: Date.now(), partial: true }),
    };
  }
}
