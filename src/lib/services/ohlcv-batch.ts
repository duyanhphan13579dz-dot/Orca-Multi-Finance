import "server-only";
import type { Meta, OhlcvBar } from "../types";
import { getVnOhlcv } from "./stocks";
import { fetchOhlcvResilient } from "./screener-ohlcv";
import { WORKERS_BUDGET } from "../data-engine/workers-budget";
import { buildMeta } from "../freshness";

/**
 * Concurrent OHLCV batch for screeners (candlestick / divergence / CANSLIM / Minervini).
 * - Workers-safe concurrency (default 6)
 * - Overall deadline → partial map
 * - Per-symbol timeout + resilient fallback when primary empty
 */

export type OhlcvPack = { bars: OhlcvBar[]; meta: Meta } | null;

const DEFAULT_CONCURRENCY = WORKERS_BUDGET.ohlcvBatchConcurrency;
const DEFAULT_LIMIT_BARS = WORKERS_BUDGET.screenerBars;
const DEFAULT_PER_SYMBOL_MS = WORKERS_BUDGET.ohlcvPerSymbolMs;

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
  bars?: number;
  concurrency?: number;
  deadlineMs?: number;
  perSymbolMs?: number;
  /** When true, try fetchOhlcvResilient if getVnOhlcv returns empty. */
  resilient?: boolean;
};

export async function batchVnOhlcv(
  symbols: string[],
  opts: OhlcvBatchOpts = {},
): Promise<Map<string, { bars: OhlcvBar[]; meta: Meta }>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bars = opts.bars ?? DEFAULT_LIMIT_BARS;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 10));
  const perSymbolMs = opts.perSymbolMs ?? DEFAULT_PER_SYMBOL_MS;
  const resilient = opts.resilient !== false;
  const t0 = Date.now();
  const deadlineAt = opts.deadlineMs != null ? t0 + opts.deadlineMs : null;
  const out = new Map<string, { bars: OhlcvBar[]; meta: Meta }>();

  await mapPool(
    uniq,
    concurrency,
    async (sym) => {
      try {
        let pack = await withTimeout(getVnOhlcv(sym, bars), perSymbolMs);
        if ((!pack?.bars?.length) && resilient) {
          const r = await withTimeout(fetchOhlcvResilient(sym, bars), perSymbolMs);
          if (r?.bars?.length) {
            pack = {
              bars: r.bars,
              meta:
                r.pack?.meta ??
                buildMeta({
                  source: "ohlcv-resilient",
                  sourceTimestampMs: Date.now(),
                }),
            };
          }
        }
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
export const SCREENER_UNIVERSE_CAP = WORKERS_BUDGET.techUniverse;
