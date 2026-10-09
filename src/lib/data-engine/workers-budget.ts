import "server-only";

/**
 * Cloudflare Workers resource budget helpers.
 * Error 1102 = Worker exceeded resource limits (CPU / memory / subrequests).
 * Keep fan-out small; prefer sequential fallback over parallel race.
 */

export const WORKERS_BUDGET = {
  /** Parallel outbound provider calls inside one request */
  maxParallelProviders: 4,
  /** Bulk BCTC / snapshot concurrency */
  snapshotConcurrency: 3,
  /** Screener default universe size (fundamental) */
  screenerUniverse: 120,
  /** Screener hard max symbols */
  screenerUniverseMax: 200,
  /** Technical screener universe (VN100-class) */
  techUniverse: 100,
  /** OHLCV batch concurrency for technical screeners */
  ohlcvBatchConcurrency: 6,
  /** OHLCV bars for detail page */
  detailBars: 120,
  /** OHLCV bars for technical screener */
  screenerBars: 120,
  /** Soft timeout (ms) for a single provider call */
  providerSoftMs: 5_000,
  /** Soft timeout for heavy FS package */
  financialSoftMs: 9_000,
  /** Wall budget for entire detail produce */
  detailWallMs: 18_000,
  /** Wall budget for technical screener (candlestick / divergence) */
  techScreenWallMs: 20_000,
  /** Per-symbol OHLCV timeout in batch */
  ohlcvPerSymbolMs: 3_000,
} as const;

export function clampUniverse(n: number | undefined, fallback = WORKERS_BUDGET.screenerUniverse): number {
  const v = n ?? fallback;
  return Math.max(10, Math.min(v, WORKERS_BUDGET.screenerUniverseMax));
}
