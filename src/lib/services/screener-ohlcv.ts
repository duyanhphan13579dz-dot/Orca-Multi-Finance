import "server-only";
import { getVnOhlcv } from "./stocks";
import type { OhlcvBar } from "../types";

type OhlcvPack = Awaited<ReturnType<typeof getVnOhlcv>>;

/**
 * Shared OHLCV fetch for screeners — one retry on empty/failure to cut
 * transient "screener không khả dụng" when a provider blips.
 */
export async function fetchOhlcvResilient(
  symbol: string,
  bars = 120,
): Promise<{ bars: OhlcvBar[]; pack: OhlcvPack | null }> {
  let pack = await getVnOhlcv(symbol, bars).catch(() => null);
  if (!pack?.bars?.length) {
    await new Promise((r) => setTimeout(r, 80 + Math.floor(Math.random() * 80)));
    pack = await getVnOhlcv(symbol, bars).catch(() => null);
  }
  return { bars: pack?.bars ?? [], pack };
}

/** Bounded concurrency map (same pattern used across screeners). */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}
