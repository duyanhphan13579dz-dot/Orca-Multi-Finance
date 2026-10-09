import "server-only";
import { getVnOhlcv } from "./stocks";
import { getVndOhlcv, getVndIndexOhlcv, isVnIndexSymbol } from "../providers/vndirect";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { getPublicOhlcv } from "../providers/public-vn-feed";
import { firstHealthy, raceHealthy } from "../data-engine/resilience";
import type { OhlcvBar } from "../types";

type OhlcvPack = Awaited<ReturnType<typeof getVnOhlcv>>;

/**
 * Shared OHLCV fetch for screeners — sequential first to cut CF Workers subrequest burn.
 */
export async function fetchOhlcvResilient(
  symbol: string,
  bars = 260,
): Promise<{ bars: OhlcvBar[]; pack: OhlcvPack | null }> {
  const sym = symbol.trim().toUpperCase();
  const isIndex = isVnIndexSymbol(sym);
  const attempts = [
    {
      id: "vndirect-dchart",
      run: () => fetchVndDchartHistory(sym, "D", bars),
      accept: (v: OhlcvBar[]) => Array.isArray(v) && v.length >= 20,
    },
    {
      id: "vndirect-ohlcv",
      run: () => (isIndex ? getVndIndexOhlcv(sym, bars) : getVndOhlcv(sym, bars)),
      accept: (v: OhlcvBar[]) => Array.isArray(v) && v.length >= 20,
    },
    {
      id: "entrade-public-ohlcv",
      run: () => getPublicOhlcv(sym, bars, isIndex ? "index" : "stock"),
      accept: (v: OhlcvBar[]) => Array.isArray(v) && v.length >= 20,
    },
  ];

  // Sequential firstHealthy — fewer simultaneous subrequests than race (CF Error 1102).
  try {
    const hit = await firstHealthy(
      attempts.map((a) => ({
        id: a.id,
        run: async (_signal?: AbortSignal) => a.run(),
        accept: a.accept,
      })),
      { budgetMs: 8_000, perAttemptMs: 4_000, label: `screener-ohlcv:${sym}` },
    );
    return {
      bars: hit.value,
      pack: { bars: hit.value, meta: { source: hit.sourceId, sourceTimestampMs: Date.now() } } as any,
    };
  } catch {
    try {
      const hit = await raceHealthy<OhlcvBar[]>(
        attempts.map((a) => ({
          id: a.id,
          run: async (_signal?: AbortSignal) => a.run(),
          accept: a.accept,
        })),
        { perAttemptMs: 3_500, label: `screener-ohlcv-race:${sym}` },
      );
      return {
        bars: hit.value,
        pack: { bars: hit.value, meta: { source: hit.sourceId, sourceTimestampMs: Date.now() } } as any,
      };
    } catch {
      const pack = await getVnOhlcv(sym, bars).catch(() => null);
      return { bars: pack?.bars ?? [], pack };
    }
  }
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
