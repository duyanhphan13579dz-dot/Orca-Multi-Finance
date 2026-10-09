import "server-only";

/**
 * Cloudflare Workers resource budget helpers.
 * Error 1102 = Worker exceeded resource limits (CPU / memory / subrequests).
 * Keep fan-out small; prefer sequential fallback over parallel race.
 */

/** Soft concurrency caps for bulk financial / screener work. */
export const WORKERS_BUDGET = {
  /** Parallel outbound provider calls inside one request */
  maxParallelProviders: 4,
  /** Bulk BCTC / snapshot concurrency */
  snapshotConcurrency: 3,
  /** Screener default universe size */
  screenerUniverse: 120,
  /** Screener hard max symbols */
  screenerUniverseMax: 200,
  /** OHLCV bars for detail page */
  detailBars: 120,
  /** OHLCV bars for screener */
  screenerBars: 180,
  /** Soft timeout (ms) for a single provider call */
  providerSoftMs: 5_000,
  /** Soft timeout for heavy FS package */
  financialSoftMs: 9_000,
  /** Wall budget for entire detail produce */
  detailWallMs: 18_000,
} as const;

export function clampUniverse(n: number | undefined, fallback = WORKERS_BUDGET.screenerUniverse): number {
  const v = n ?? fallback;
  return Math.max(10, Math.min(v, WORKERS_BUDGET.screenerUniverseMax));
}
