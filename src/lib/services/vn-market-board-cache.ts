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
    const res = await cached<VnMarketBoard | null>("vn:market-board:v2", {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: async () => {
        const mq = await vndirect.getVndMarketQuotes();
        if (!mq.quotes?.length) return null;
        const idx = await vndirect
          .getVndIndices()
          .catch(() => ({ items: [] as IndexQuote[], sourceTs: null as number | null }));
        return {
          quotes: mq.quotes,
          indices: sortIndices(idx.items),
          universeSize: mq.quotes.length,
          sessionDate: mq.sessionDate,
          meta: buildMeta({ source: "vndirect", sourceTimestampMs: mq.sourceTs ?? Date.now() }),
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
