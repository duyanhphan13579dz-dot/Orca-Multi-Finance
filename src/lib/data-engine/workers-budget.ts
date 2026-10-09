import "server-only";

/**
 * Cloudflare Workers resource budget helpers.
 * Error 1102 = Worker exceeded resource limits (CPU / memory / subrequests).
 * Prefer sequential fallback over parallel race. Cap everything.
 */

export const WORKERS_BUDGET = {
  /** Parallel outbound provider calls inside one request */
  maxParallelProviders: 3,
  /** Approximate max subrequests per Worker invocation */
  maxSubrequestsPerRequest: 28,
  /** Wall budget for generic API handlers */
  apiWallMs: 14_000,
  /** Board load wall */
  boardWallMs: 12_000,
  /** Bulk BCTC / snapshot concurrency */
  snapshotConcurrency: 2,
  /** Screener default universe size (fundamental) */
  screenerUniverse: 80,
  /** Screener hard max symbols */
  screenerUniverseMax: 120,
  /** Technical screener universe (VN100-class) */
  techUniverse: 60,
  /** OHLCV batch concurrency for technical screeners */
  ohlcvBatchConcurrency: 4,
  /** OHLCV bars for detail page */
  detailBars: 100,
  /** OHLCV bars for technical screener */
  screenerBars: 100,
  /** Soft timeout (ms) for a single provider call */
  providerSoftMs: 4_000,
  /** Soft timeout for heavy FS package */
  financialSoftMs: 7_000,
  /** Wall budget for entire detail produce */
  detailWallMs: 14_000,
  /** Wall budget for technical screener (candlestick / divergence) */
  techScreenWallMs: 16_000,
  /** Per-symbol OHLCV timeout in batch */
  ohlcvPerSymbolMs: 2_500,
} as const;

export function clampUniverse(n: number | undefined, fallback = WORKERS_BUDGET.screenerUniverse): number {
  const v = n ?? fallback;
  return Math.max(10, Math.min(v, WORKERS_BUDGET.screenerUniverseMax));
}
