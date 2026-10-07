import "server-only";
import type { Meta, OhlcvBar } from "../types";
import { getVnOhlcv } from "./stocks";

/**
 * Concurrent OHLCV batch for screeners (candlestick / divergence / CANSLIM / alerts).
 * - Concurrency cap avoids thundering herd on VNDirect dchart
 * - Optional overall deadline: return partial map when time is up (realtime path)
 * - Per-symbol timeout so one slow symbol does not stall the pool
 */

export type OhlcvPack = { bars: OhlcvBar[]; meta: Meta } | null;

const DEFAULT_CONCURRENCY = 12;
const DEFAULT_LIMIT_BARS = 120;
/** Soft per-symbol wall time in batch (getVnOhlcv itself may be faster via cache). */
const DEFAULT_PER_SYMBOL_MS = 4_000;

/**
 * Run `worker` over `items` with at most `concurrency` in flight.
 * Optional `shouldStop` aborts scheduling new work (in-flight still finish).
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<R[]> {
  const n = items.length;
  if (!n) return [];
  const out = new Array<R>(n);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, n) }, async () => {
    while (true) {
      if (shouldStop?.()) break;
      const i = next++;
      if (i >= n) break;
      out[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return p;
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export type OhlcvBatchOpts = {
  /** Bars per symbol (default 120). */
  bars?: number;
  /** Max parallel getVnOhlcv (default 12, max 20). */
  concurrency?: number;
  /** Overall wall-clock budget (ms). Partial results returned when exceeded. */
  deadlineMs?: number;
  /** Max time per symbol (ms). Default 4000. */
  perSymbolMs?: number;
};

/**
 * Fetch OHLCV for many symbols with concurrency limit.
 * Returns only symbols that produced non-empty bars.
 * With deadlineMs, prioritizes completing as many symbols as possible within budget.
 */
export async function batchVnOhlcv(
  symbols: string[],
  opts: OhlcvBatchOpts = {},
): Promise<Map<string, { bars: OhlcvBar[]; meta: Meta }>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bars = opts.bars ?? DEFAULT_LIMIT_BARS;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 20));
  const perSymbolMs = opts.perSymbolMs ?? DEFAULT_PER_SYMBOL_MS;
  const t0 = Date.now();
  const deadlineAt = opts.deadlineMs != null ? t0 + opts.deadlineMs : null;
  const out = new Map<string, { bars: OhlcvBar[]; meta: Meta }>();

  await mapPool(
    uniq,
    concurrency,
    async (sym) => {
      try {
        const pack = await withTimeout(getVnOhlcv(sym, bars), perSymbolMs);
        if (pack?.bars?.length) out.set(sym, pack);
      } catch {
        /* skip */
      }
    },
    deadlineAt != null ? () => Date.now() >= deadlineAt : undefined,
  );

  return out;
}

/** Default cap = full VN100 for technical screeners. */
export const SCREENER_UNIVERSE_CAP = 100;
