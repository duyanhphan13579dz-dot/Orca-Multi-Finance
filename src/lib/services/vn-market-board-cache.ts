import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as vndirect from "../providers/vndirect";
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

type LastGood = { board: VnMarketBoard; at: number };

function lastGoodStore(): { current: LastGood | null } {
  const g = globalThis as typeof globalThis & { __orcaVnBoardLast?: { current: LastGood | null } };
  if (!g.__orcaVnBoardLast) g.__orcaVnBoardLast = { current: null };
  return g.__orcaVnBoardLast;
}

function remember(board: VnMarketBoard) {
  if (!board.quotes.length && !board.indices.length) return;
  lastGoodStore().current = { board, at: Date.now() };
}

function recall(maxAgeMs = 4 * 60 * 60_000): VnMarketBoard | null {
  const lg = lastGoodStore().current;
  if (!lg) return null;
  if (Date.now() - lg.at > maxAgeMs) return null;
  return {
    ...lg.board,
    meta: {
      ...lg.board.meta,
      stale: true,
      cached: true,
      partial: true,
      note: `${lg.board.meta.note ?? ""} · last-good ${Math.round((Date.now() - lg.at) / 1000)}s`.trim(),
    },
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.then((v) => v).catch(() => null as T | null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function loadIndices(): Promise<{ items: IndexQuote[]; source: string; sourceTs: number | null }> {
  const vnd = await withTimeout(vndirect.getVndIndices(), 5_000);
  if (vnd?.items?.length) {
    return { items: sortIndices(vnd.items), source: "vndirect-indices", sourceTs: vnd.sourceTs };
  }
  try {
    const { getPublicIndices } = await import("../providers/public-vn-feed");
    const pub = await withTimeout(getPublicIndices(), 5_000);
    if (pub?.items?.length) {
      return { items: sortIndices(pub.items), source: "public-indices", sourceTs: pub.sourceTs ?? Date.now() };
    }
  } catch {
    /* */
  }
  try {
    const { getSsiIndices, ssiFcConfigured } = await import("../providers/ssi-fcdata");
    if (ssiFcConfigured()) {
      const ssi = await withTimeout(getSsiIndices(), 5_000);
      if (ssi?.items?.length) {
        return { items: sortIndices(ssi.items), source: "ssi-indices", sourceTs: Date.now() };
      }
    }
  } catch {
    /* */
  }
  return { items: [], source: "none", sourceTs: null };
}

async function loadQuotes(): Promise<{
  quotes: Quote[];
  sessionDate: string;
  source: string;
  sourceTs: number;
}> {
  try {
    const mq = await withTimeout(vndirect.getVndMarketQuotes(), 14_000);
    if (mq?.quotes?.length) {
      return {
        quotes: mq.quotes,
        sessionDate: mq.sessionDate ?? "",
        source: "vndirect",
        sourceTs: mq.sourceTs ?? Date.now(),
      };
    }
  } catch {
    /* */
  }

  try {
    const { getVpsQuotes } = await import("../providers/vps");
    const { LIQUID_BOARD } = await import("../providers/public-vn-feed");
    const vpsQuotes = await withTimeout(getVpsQuotes(LIQUID_BOARD), 8_000);
    if (vpsQuotes?.length) {
      return {
        quotes: vpsQuotes,
        sessionDate: "",
        source: "vps",
        sourceTs: Date.now(),
      };
    }
  } catch {
    /* */
  }

  try {
    const { getPublicQuotes, LIQUID_BOARD } = await import("../providers/public-vn-feed");
    const pub = await withTimeout(getPublicQuotes(LIQUID_BOARD), 8_000);
    if (pub?.quotes?.length) {
      return {
        quotes: pub.quotes,
        sessionDate: "",
        source: (pub.sources ?? []).join("+") || "public-vn",
        sourceTs: Date.now(),
      };
    }
  } catch {
    /* */
  }

  try {
    const { getMultiQuotes } = await import("./multi-quote");
    const { LIQUID_BOARD } = await import("../providers/public-vn-feed");
    const multi = await withTimeout(getMultiQuotes(LIQUID_BOARD.slice(0, 60)), 10_000);
    if (multi?.quotes?.length) {
      return {
        quotes: multi.quotes,
        sessionDate: "",
        source: multi.sources.join("+") || "multi-quote",
        sourceTs: multi.sourceTs ?? Date.now(),
      };
    }
  } catch {
    /* */
  }

  return { quotes: [], sessionDate: "", source: "none", sourceTs: Date.now() };
}

/**
 * Full VN board with server cache + last-good snapshot.
 * Trading: TTL 12s / stale 120s · After hours: TTL 60s / stale 15m.
 * Never drop the board while last-good is still warm (≤4h).
 */
export async function loadVnMarketBoardCached(
  boot?: () => void,
): Promise<VnMarketBoard | null> {
  boot?.();
  let ttl = 60_000;
  let stale = 900_000;
  try {
    const { getVnSession } = await import("../vn/sessions");
    if (getVnSession().trading) {
      ttl = 12_000;
      stale = 120_000;
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
        const [qPack, idxPack] = await Promise.all([loadQuotes(), loadIndices()]);
        if (!qPack.quotes.length && !idxPack.items.length) {
          return null;
        }
        const sources = [qPack.source, idxPack.source].filter((s) => s && s !== "none");
        const board: VnMarketBoard = {
          quotes: qPack.quotes,
          indices: idxPack.items,
          universeSize: qPack.quotes.length,
          sessionDate: qPack.sessionDate,
          meta: buildMeta({
            source: sources.join("+") || "vn-board",
            sourceTimestampMs: qPack.sourceTs || idxPack.sourceTs || Date.now(),
            partial: !qPack.quotes.length || !idxPack.items.length,
            note: !qPack.quotes.length
              ? "Quotes tạm thiếu — giữ chỉ số"
              : !idxPack.items.length
                ? "Chỉ số tạm thiếu — giữ quotes"
                : undefined,
          }),
        };
        remember(board);
        return board;
      },
    });

    if (res.value && (res.value.quotes.length || res.value.indices.length)) {
      remember(res.value);
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
    }
  } catch {
    /* fall to last-good */
  }

  return recall();
}
