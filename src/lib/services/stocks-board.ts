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
import { getMultiQuotes } from "./multi-quote";
import {
  getPublicIndices,
  getPublicQuotes,
  getPublicOhlcv,
  LIQUID_BOARD,
} from "../providers/public-vn-feed";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { loadVnMarketBoardCached } from "./vn-market-board-cache";

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
    const res = await cached<{ items: IndexQuote[]; meta: Meta } | null>("vn:indices:live:v4", {
      ttlMs: 12_000,
      staleMs: 300_000,
      softSwr: true,
      producer: async () => {
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
        if (!byCode.size) throw new Error("empty indices");
        return {
          items: sortIndices([...byCode.values()]),
          meta: buildMeta({
            source: sources.join("+") || "indices",
            sourceTimestampMs: newest,
          }),
        };
      },
    });
    return res.value;
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
        fetchVndDchartHistory(sym, "D", limit)
          .then((bars) => (bars?.length ? { bars, source: "vndirect-dchart" } : null))
          .catch(() => null),
        6_000,
      ),
      withTimeout(
        (isIndex ? vndirect.getVndIndexOhlcv(sym, limit) : vndirect.getVndOhlcv(sym, limit))
          .then((bars) => (bars?.length ? { bars, source: "vndirect" } : null))
          .catch(() => null),
        6_500,
      ),
      withTimeout(
        getPublicOhlcv(sym, limit, kind)
          .then((bars) => (bars?.length ? { bars, source: "public" } : null))
          .catch(() => null),
        6_500,
      ),
    ];
    if (ssiFcConfigured() && !isIndex) {
      tasks.push(
        withTimeout(
          getSsiDailyOhlc(sym, { pageSize: limit })
            .then((bars) => (bars?.length ? { bars, source: "ssi-fcdata" } : null))
            .catch(() => null),
          6_500,
        ),
      );
    }
    const settled = await Promise.all(tasks);
    const ok = settled.filter((x): x is Cand => Boolean(x?.bars?.length));
    if (!ok.length) return null;
    ok.sort((a, b) => b.bars.length - a.bars.length);
    return ok[0]!;
  };

  try {
    const res = await cached(`vn:ohlcv:${sym}:${limit}`, {
      ttlMs: 60_000,
      staleMs: 30 * 60_000,
      producer: async () => {
        const pack = await raceBars();
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
  universeSize?: number;
  sessionDate?: string | null;
} | null> {
  // Isolate cooldown → never fan-out; only cached path
  try {
    const { isIsolateCoolingDown } = await import("../data-engine/workers-guard");
    if (isIsolateCoolingDown()) {
      const fullBoard = await loadVnMarketBoardCached();
      if (fullBoard && (fullBoard.quotes.length || fullBoard.indices.length)) {
        return {
          indices: fullBoard.indices,
          quotes: fullBoard.quotes,
          universeSize: fullBoard.universeSize,
          sessionDate: fullBoard.sessionDate,
          meta: { ...fullBoard.meta, stale: true, partial: true, note: `${fullBoard.meta.note ?? ""} · cooldown`.trim() },
        };
      }
      return null;
    }
  } catch {
    /* */
  }

  // Tier 1: cached board (sequential cascade + last-good inside)
  try {
    const fullBoard = await loadVnMarketBoardCached();
    if (fullBoard && (fullBoard.quotes.length >= 1 || fullBoard.indices.length >= 1)) {
      return {
        indices: fullBoard.indices,
        quotes: fullBoard.quotes,
        universeSize: fullBoard.universeSize,
        sessionDate: fullBoard.sessionDate,
        meta: fullBoard.meta,
      };
    }
  } catch {
    /* */
  }

  // Tier 2: light sequential liquid fallback (no double-retry, no parallel indices+quotes race)
  try {
    const { getPublicQuotes } = await import("../providers/public-vn-feed");
    const pubQ = await getPublicQuotes(LIQUID_BOARD.slice(0, 40)).catch(() => null);
    const quotes = pubQ?.quotes ?? [];
    if (!quotes.length) return null;
    return {
      indices: [],
      quotes,
      universeSize: quotes.length,
      sessionDate: null,
      meta: buildMeta({
        source: (pubQ?.sources ?? ["public-vn"]).join("+"),
        sourceTimestampMs: Date.now(),
        partial: true,
        note: "Liquid public fallback — indices skipped (Workers budget)",
      }),
    };
  } catch {
    return null;
  }
}

/**
 * Prefer full HOSE/HNX/UPCOM catalog (~1900+ stocks) for OHLCV screeners.
 * Falls back to live board quotes, then LIQUID_BOARD.
 */
export async function getVnUniverseList(): Promise<{ symbols: string[]; meta: Meta } | null> {
  try {
    const { getVnUniverseSymbols } = await import("./vn-universe");
    const full = await getVnUniverseSymbols("ALL");
    if (full.length >= 100) {
      return {
        symbols: full,
        meta: buildMeta({
          source: "vndirect+ssi-universe",
          sourceTimestampMs: Date.now(),
          note: `full-universe n=${full.length}`,
        }),
      };
    }
  } catch {
    /* fall through */
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
      meta: board?.meta ?? buildMeta({ source: "board", sourceTimestampMs: Date.now() }),
    };
  } catch {
    return {
      symbols: [...LIQUID_BOARD],
      meta: buildMeta({ source: "liquid-board-fallback", sourceTimestampMs: Date.now(), partial: true }),
    };
  }
}
