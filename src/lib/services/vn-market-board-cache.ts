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

async function loadIndicesLight(): Promise<{ items: IndexQuote[]; source: string; sourceTs: number | null }> {
  const vnd = await withTimeout(vndirect.getVndIndices(), 4_000);
  if (vnd?.items?.length) {
    return { items: sortIndices(vnd.items), source: "vndirect-indices", sourceTs: vnd.sourceTs };
  }
  try {
    const { getPublicIndices } = await import("../providers/public-vn-feed");
    const pub = await withTimeout(getPublicIndices(), 4_000);
    if (pub?.items?.length) {
      return { items: sortIndices(pub.items), source: "public-indices", sourceTs: pub.sourceTs ?? Date.now() };
    }
  } catch {
    /* */
  }
  return { items: [], source: "none", sourceTs: null };
}

async function loadQuotesSequential(deadlineAt: number): Promise<{
  quotes: Quote[];
  sessionDate: string;
  source: string;
  sourceTs: number;
  tier: "vn30" | "full" | "liquid" | "none";
}> {
  const remain = () => Math.max(400, deadlineAt - Date.now());
  let vn30Seed: Quote[] = [];
  let sessionDate = "";

  // P1 Stage A — VN30 first (~3.5s) so homepage paints <5s
  if (Date.now() < deadlineAt - 600) {
    try {
      const { getPublicQuotes, VN30_BOARD } = await import("../providers/public-vn-feed");
      const pub = await withTimeout(
        getPublicQuotes([...VN30_BOARD]),
        Math.min(3_500, remain()),
      );
      if (pub?.quotes?.length) {
        vn30Seed = pub.quotes;
        // If almost out of budget, return VN30 immediately
        if (remain() < 2_500) {
          return {
            quotes: vn30Seed,
            sessionDate: "",
            source: (pub.sources ?? []).join("+") || "public-vn30",
            sourceTs: Date.now(),
            tier: "vn30",
          };
        }
      }
    } catch {
      /* */
    }
  }

  // Stage B — full HOSE board (vndirect) if budget left
  if (Date.now() < deadlineAt - 1_200) {
    try {
      const mq = await withTimeout(vndirect.getVndMarketQuotes(), Math.min(8_000, remain()));
      if (mq?.quotes?.length) {
        return {
          quotes: mq.quotes,
          sessionDate: mq.sessionDate ?? "",
          source: "vndirect",
          sourceTs: mq.sourceTs ?? Date.now(),
          tier: "full",
        };
      }
    } catch {
      /* */
    }
  }

  // Prefer VN30 seed over slower liquid expansion when we already have it
  if (vn30Seed.length) {
    return {
      quotes: vn30Seed,
      sessionDate: "",
      source: "public-vn30",
      sourceTs: Date.now(),
      tier: "vn30",
    };
  }

  if (Date.now() < deadlineAt - 500) {
    try {
      const { getPublicQuotes, LIQUID_BOARD } = await import("../providers/public-vn-feed");
      const pub = await withTimeout(getPublicQuotes(LIQUID_BOARD.slice(0, 60)), Math.min(5_000, remain()));
      if (pub?.quotes?.length) {
        return {
          quotes: pub.quotes,
          sessionDate: "",
          source: (pub.sources ?? []).join("+") || "public-vn",
          sourceTs: Date.now(),
          tier: "liquid",
        };
      }
    } catch {
      /* */
    }
  }

  if (Date.now() < deadlineAt - 500) {
    try {
      const { getVpsQuotes } = await import("../providers/vps");
      const { VN30_BOARD } = await import("../providers/public-vn-feed");
      const vpsQuotes = await withTimeout(getVpsQuotes([...VN30_BOARD]), Math.min(4_500, remain()));
      if (vpsQuotes?.length) {
        return {
          quotes: vpsQuotes,
          sessionDate: "",
          source: "vps-vn30",
          sourceTs: Date.now(),
          tier: "vn30",
        };
      }
    } catch {
      /* */
    }
  }

  return { quotes: [], sessionDate: "", source: "none", sourceTs: Date.now(), tier: "none" };
}

/**
 * Workers-safe VN board cache (v4).
 * Trading: TTL 15s / stale 180s · After hours: TTL 90s / stale 20m.
 */
export async function loadVnMarketBoardCached(
  boot?: () => void,
): Promise<VnMarketBoard | null> {
  boot?.();

  const fresh = lastGoodStore().current;
  if (fresh && Date.now() - fresh.at < 20_000 && fresh.board.quotes.length >= 15) {
    return {
      ...fresh.board,
      meta: {
        ...fresh.board.meta,
        cached: true,
        stale: false,
        note: `${fresh.board.meta.note ?? ""} · hot-last-good`.trim(),
      },
    };
  }

  let ttl = 90_000;
  let stale = 1_200_000;
  try {
    const { getVnSession } = await import("../vn/sessions");
    if (getVnSession().trading) {
      ttl = 15_000;
      stale = 180_000;
    }
  } catch {
    /* */
  }

  try {
    const res = await cached<VnMarketBoard | null>("vn:market-board:v4", {
      ttlMs: ttl,
      staleMs: stale,
      softSwr: true,
      producer: async () => {
        const deadlineAt = Date.now() + 10_000;
        const qPack = await loadQuotesSequential(deadlineAt);
        let idxPack = { items: [] as IndexQuote[], source: "none", sourceTs: null as number | null };
        if (Date.now() < deadlineAt - 600) {
          idxPack = await loadIndicesLight();
        }
        if (!qPack.quotes.length && !idxPack.items.length) {
          return null;
        }
        const sources = [qPack.source, idxPack.source].filter((s) => s && s !== "none");
        const isVn30 = qPack.tier === "vn30";
        const board: VnMarketBoard = {
          quotes: qPack.quotes,
          indices: idxPack.items,
          universeSize: qPack.quotes.length,
          sessionDate: qPack.sessionDate,
          meta: buildMeta({
            source: sources.join("+") || "vn-board",
            sourceTimestampMs: qPack.sourceTs || idxPack.sourceTs || Date.now(),
            partial: isVn30 || !qPack.quotes.length || !idxPack.items.length,
            note: isVn30
              ? `VN30-first · ${qPack.quotes.length} mã · full board background`
              : !qPack.quotes.length
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
