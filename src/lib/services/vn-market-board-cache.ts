import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as vndirect from "../providers/vndirect";
import { getVndMarketSnapshot } from "../providers/vndirect-market-quotes";
import type { IndexQuote, Meta, Quote } from "../types";

const INDEX_PRIORITY = ["VNINDEX", "VN30", "HNX", "UPCOM", "HNX30", "VN100"];

function sortIndices(items: IndexQuote[]): IndexQuote[] {
  return [...items].sort((a, b) => {
    const ia = INDEX_PRIORITY.indexOf(a.code);
    const ib = INDEX_PRIORITY.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export type VnMarketBoard = {
  quotes: Quote[];
  indices: IndexQuote[];
  universeSize: number;
  sessionDate: string;
  meta: Meta;
};

/**
 * Full VN board with server cache.
 * Trading: TTL 10s / stale 45s · After hours: TTL 60s / stale 10m.
 * Soft SWR: serve cache immediately, refresh in background.
 */
export async function loadVnMarketBoardCached(
  boot?: () => void,
): Promise<VnMarketBoard | null> {
  boot?.();
  let ttl = 60_000;
  let stale = 600_000;
  try {
    const { getVnSession } = await import("../vn/sessions");
    if (getVnSession().trading) {
      ttl = 10_000;
      stale = 45_000;
    }
  } catch {
    /* */
  }
  try {
    const res = await cached<VnMarketBoard | null>("vn:market-board:v3", {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: async () => {
        // Whole-board snapshot (shared cache with the multi-quote layer).
        const mq = await getVndMarketSnapshot();
        if (!mq.quotes?.length) return null;
        const idx = await vndirect
          .getVndIndices()
          .catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null }));
        return {
          quotes: mq.quotes,
          indices: sortIndices(idx.items),
          universeSize: mq.quotes.length,
          sessionDate: mq.sessionDate,
          meta: buildMeta({
            source: "vndirect",
            sourceTimestampMs: mq.sourceTs ?? Date.now(),
            note: `full board · ${mq.quotes.length} mã · ${mq.pagesFetched} page(s)`,
          }),
        };
      },
    });
    if (!res.value) return null;
    return {
      ...res.value,
      meta: {
        ...res.value.meta,
        cached: res.cached,
        stale: res.stale,
        note: res.cached
          ? `${res.value.meta.note ?? ""} · cache${res.stale ? " stale" : ""}`.trim()
          : res.value.meta.note,
      },
    };
  } catch {
    return null;
  }
}

export type VnMarketBoardFilter = {
  exchange?: string | null;
  limit?: number | null;
  symbols?: string[] | null;
};

/**
 * Filter a full board pack by explicit symbols and/or row limit.
 * Exchange filtering needs the listing map (DStock rows carry no floor code) —
 * use `loadVnMarketBoardByExchange` for that.
 */
export function filterVnMarketBoard(board: VnMarketBoard, filter?: VnMarketBoardFilter): VnMarketBoard {
  let quotes: Quote[] = board.quotes;
  const symbols = (filter?.symbols ?? []).map((s) => s.toUpperCase().trim()).filter(Boolean);
  if (symbols.length) {
    const want = new Set(symbols);
    quotes = quotes.filter((q) => want.has(String(q.symbol ?? "").toUpperCase()));
  }
  const limit = Number(filter?.limit ?? 0);
  if (Number.isFinite(limit) && limit > 0) quotes = quotes.slice(0, Math.floor(limit));
  return { ...board, quotes, universeSize: quotes.length };
}

/** Full listed board for a single exchange code (hose|hnx|upcom) using the universe map. */
export async function loadVnMarketBoardByExchange(
  exchange: string,
  opts?: { limit?: number | null },
): Promise<VnMarketBoard | null> {
  const board = await loadVnMarketBoardCached();
  if (!board) return null;
  try {
    const { getVnUniverse } = await import("./vn-universe");
    const universe = await getVnUniverse();
    const want = (exchange ?? "").trim().toUpperCase();
    const codes = new Set(
      universe.rows
        .filter((r) => String(r.exchange ?? "").toUpperCase().includes(want))
        .map((r) => r.symbol),
    );
    if (codes.size) {
      const quotes = board.quotes.filter((q) => codes.has(String(q.symbol ?? "").toUpperCase()));
      return { ...board, quotes, universeSize: quotes.length };
    }
  } catch {
    /* fall through to unfiltered board */
  }
  return filterVnMarketBoard(board, { limit: opts?.limit });
}
