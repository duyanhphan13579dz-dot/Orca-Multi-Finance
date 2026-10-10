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
        }),
      };
    }
  } catch {
    /* */
  }

  try {
    const vnd = await withTimeout(vndirect.getVndQuotes(syms), 5_000);
    if (vnd?.quotes?.length) {
      return {
        quotes: vnd.quotes,
        meta: buildMeta({
          source: "vndirect",
          sourceTimestampMs: vnd.sourceTs ?? Date.now(),
          partial: vnd.quotes.length < syms.length,
        }),
      };
    }
  } catch {
    /* */
  }

  return null;
}

export async function getVnIndices(): Promise<{ items: IndexQuote[]; meta: Meta } | null> {
  try {
    const vnd = await withTimeout(vndirect.getVndIndices(), 4_500);
    if (vnd?.items?.length) {
      return {
        items: sortIndices(vnd.items),
        meta: buildMeta({ source: "vndirect-indices", sourceTimestampMs: vnd.sourceTs ?? Date.now() }),
      };
    }
  } catch {
    /* */
  }

  try {
    if (ssiFcConfigured()) {
      const ssi = await withTimeout(getSsiIndices(), 4_000);
      if (ssi?.items?.length) {
        return {
          items: sortIndices(ssi.items),
          meta: buildMeta({ source: "ssi-fcdata", sourceTimestampMs: Date.now() }),
        };
      }
    }
  } catch {
    /* */
  }

  try {
    const pub = await withTimeout(getPublicIndices(), 4_000);
    if (pub?.items?.length) {
      return {
        items: sortIndices(pub.items),
        meta: buildMeta({ source: "public-indices", sourceTimestampMs: pub.sourceTs ?? Date.now() }),
      };
    }
  } catch {
    /* */
  }

  return null;
}

export async function getVnOhlcv(
  symbol: string,
  limit = 250,
  kind: "stock" | "index" = "stock",
  signal?: AbortSignal,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;

  try {
    if (signal?.aborted) return null;
    const publicSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
      : AbortSignal.timeout(8_000);
    const bars = await withTimeout(getPublicOhlcv(sym, limit, kind, publicSignal), 8_000);
    if (bars?.length) {
      return {
        bars,
        meta: buildMeta({ source: "public-ohlcv", sourceTimestampMs: Date.now() }),
      };
    }
  } catch {
    /* */
  }

  try {
    if (signal?.aborted) return null;
    const dchartSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(7_000)])
      : AbortSignal.timeout(7_000);
    const bars = await withTimeout(fetchVndDchartHistory(sym, "D", limit, dchartSignal), 7_000);
    if (bars?.length) {
      return {
        bars,
        meta: buildMeta({ source: "vndirect-dchart", sourceTimestampMs: Date.now() }),
      };
    }
  } catch {
    /* */
  }

  try {
    if (signal?.aborted) return null;
    if (ssiFcConfigured()) {
      const bars = await withTimeout(getSsiDailyOhlc(sym, { pageSize: limit, signal }), 6_000);
      if (bars?.length) {
        return {
          bars,
          meta: buildMeta({ source: "ssi-fcdata", sourceTimestampMs: Date.now() }),
        };
      }
    }
  } catch {
    /* */
  }

  return null;
}

/** P1: VN30-only board for first paint (<5s). */
export async function getVn30Board(): Promise<{
  indices: IndexQuote[];
  quotes: Quote[];
  universeSize: number;
  sessionDate: string | null;
  meta: Meta;
} | null> {
  try {
    const { VN30_BOARD } = await import("../providers/public-vn-feed");
    const [quotesPack, idxPack] = await Promise.all([
      withTimeout(getVnQuotes([...VN30_BOARD]), 4_000),
      withTimeout(getVnIndices(), 3_500),
    ]);
    const quotes = quotesPack?.quotes ?? [];
    const indices = idxPack?.items ?? [];
    if (!quotes.length && !indices.length) return null;
    return {
      indices,
      quotes,
      universeSize: quotes.length,
      sessionDate: null,
      meta: buildMeta({
        source: [quotesPack?.meta?.source, idxPack ? "indices" : null].filter(Boolean).join("+") || "vn30",
        sourceTimestampMs: Date.now(),
        partial: true,
        note: `VN30-first · ${quotes.length} mã`,
      }),
    };
  } catch {
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
