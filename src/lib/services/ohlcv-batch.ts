import "server-only";
import type { Meta, OhlcvBar } from "../types";
import { getVnOhlcv } from "./stocks";

/**
 * Concurrent OHLCV batch for screeners (candlestick / divergence / alerts).
 * - Concurrency cap avoids thundering herd on VNDirect dchart
 * - No sequential chunk sleep; single attempt per symbol (cache hits are fast)
 * - Default universe soft-cap 60 (callers may pass fewer)
 */

export type OhlcvPack = { bars: OhlcvBar[]; meta: Meta } | null;

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_LIMIT_BARS = 120;

/**
 * Run `worker` over `items` with at most `concurrency` in flight.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (!n) return [];
  const out = new Array<R>(n);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, n) }, async () => {
    while (true) {
      const i = next++;
      if (i >= n) break;
      out[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type OhlcvBatchOpts = {
  /** Bars per symbol (default 120). */
  bars?: number;
  /** Max parallel getVnOhlcv (default 10). */
  concurrency?: number;
};

/**
 * Fetch OHLCV for many symbols with concurrency limit.
 * Returns only symbols that produced non-empty bars.
 */
export async function batchVnOhlcv(
  symbols: string[],
  opts: OhlcvBatchOpts = {},
): Promise<Map<string, { bars: OhlcvBar[]; meta: Meta }>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bars = opts.bars ?? DEFAULT_LIMIT_BARS;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 16));
  const out = new Map<string, { bars: OhlcvBar[]; meta: Meta }>();

  await mapPool(uniq, concurrency, async (sym) => {
    try {
      const pack = await getVnOhlcv(sym, bars);
      if (pack?.bars?.length) out.set(sym, pack);
    } catch {
      /* skip — screener treats missing as skipped */
    }
  });

  return out;
}

/** Soft default universe size for screeners (was 120). */
export const SCREENER_UNIVERSE_CAP = 60;
