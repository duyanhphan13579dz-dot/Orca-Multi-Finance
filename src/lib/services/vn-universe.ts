import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import type { Meta } from "../types";
import {
  fetchVndFullUniverse,
  filterUniverseByExchange,
  universeCountsByExchange,
  type VndUniverseItem,
  type VnExchange,
  VN_EXCHANGES,
} from "../providers/vndirect-universe";

export type { VndUniverseItem, VnExchange };
export { VN_EXCHANGES };

export type VnUniverseResult = {
  items: VndUniverseItem[];
  counts: Record<VnExchange | "OTHER", number>;
  total: number;
  exchange: VnExchange | "ALL";
  meta: Meta;
};

/**
 * Full listed equity universe (HOSE / HNX / UPCOM).
 * Cached 30m — safe for screeners and OHLCV batch warmers.
 * Every symbol is OHLCV-capable via getVnOhlcv cascade.
 */
export async function getVnFullUniverse(
  exchange: VnExchange | "ALL" = "ALL",
): Promise<VnUniverseResult> {
  const res = await cached("vn:universe:full:v2", {
    ttlMs: 30 * 60_000,
    staleMs: 6 * 3_600_000,
    producer: async () => fetchVndFullUniverse(),
  });

  const all = res.value as VndUniverseItem[];
  const items = filterUniverseByExchange(all, exchange);
  const counts = universeCountsByExchange(all);

  return {
    items,
    counts,
    total: items.length,
    exchange,
    meta: buildMeta({
      source: "vndirect+ssi-universe",
      sourceTimestampMs: Date.now(),
      cached: res.cached,
      stale: res.stale,
      note:
        exchange === "ALL"
          ? `HOSE ${counts.HOSE} · HNX ${counts.HNX} · UPCOM ${counts.UPCOM}`
          : `${exchange} listings`,
    }),
  };
}

/** Symbol list only — for batch OHLCV / screeners. */
export async function getVnUniverseSymbols(
  exchange: VnExchange | "ALL" = "ALL",
): Promise<string[]> {
  const u = await getVnFullUniverse(exchange);
  return u.items.map((x) => x.symbol);
}
