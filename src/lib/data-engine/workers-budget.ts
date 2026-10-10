import "server-only";
import { getVnSession } from "../vn/sessions";

/**
 * Cloudflare Workers resource budget helpers.
 * Error 1102 = Worker exceeded resource limits (CPU / memory / subrequests).
 * Prefer sequential fallback over parallel race. Cap everything.
 *
 * P2-B: snapshot concurrency is adaptive — lower during VN continuous trading
 * to avoid 1102; higher off-hours when hot-warm / screeners can fan out safely.
 *
 * P8c: user-facing walls capped ≤12s so platform never kills mid-response;
 * cron jobs use separate higher budgets per focused domain.
 */

export const WORKERS_BUDGET = {
  /** Parallel outbound provider calls inside one request */
  maxParallelProviders: 2,
  /** Approximate max subrequests per Worker invocation (user path) */
  maxSubrequestsPerRequest: 16,
  /** Wall budget for generic API handlers (P8c: ≤12s) */
  apiWallMs: 12_000,
  /** Board load wall (P8c: tighter) */
  boardWallMs: 10_000,
  /**
   * Baseline bulk BCTC / snapshot concurrency (off-hours).
   * Use resolveSnapshotConcurrency() for live adaptive value.
   */
  snapshotConcurrency: 3,
  /** Screener default universe size (fundamental) */
  screenerUniverse: 80,
  /** Screener hard max symbols */
  screenerUniverseMax: 120,
  /** Technical screener universe (VN100-class) */
  techUniverse: 60,
  /** OHLCV batch concurrency for technical screeners (P2-C) */
  ohlcvBatchConcurrency: 4,
  /** OHLCV bars for detail page */
  detailBars: 100,
  /** OHLCV bars for technical screener */
  screenerBars: 100,
  /** Soft timeout (ms) for a single provider call */
  providerSoftMs: 3_500,
  /** Soft timeout for heavy FS package */
  financialSoftMs: 6_000,
  /** Wall budget for entire detail produce (P8c: ≤12s) */
  detailWallMs: 12_000,
  /** Wall budget for technical screener — still capped under CF kill */
  techScreenWallMs: 14_000,
  /** Per-symbol OHLCV timeout in batch */
  ohlcvPerSymbolMs: 2_000,
  /** Soft produce deadline when hot miss (user path) */
  softProduceMs: 5_000,
  /** Cron per-domain wall (focused jobs) */
  cronDomainWallMs: 14_000,
  /** Cron max subrequests per focused job */
  cronMaxSubrequests: 18,
} as const;

export function clampUniverse(n: number | undefined, fallback = WORKERS_BUDGET.screenerUniverse): number {
  const v = n ?? fallback;
  return Math.max(10, Math.min(v, WORKERS_BUDGET.screenerUniverseMax));
}

/**
 * P2-B: adaptive snapshot concurrency.
 * - Continuous trading: 2 (protect subrequest budget)
 * - Auction: 3
 * - Off-hours / lunch / weekend: 4
 */
export function resolveSnapshotConcurrency(opts?: { forceLow?: boolean }): number {
  if (opts?.forceLow) return 2;
  try {
    const s = getVnSession();
    if (s.state === "morning_continuous" || s.state === "afternoon_continuous") return 2;
    if (s.trading) return 3;
    return 4;
  } catch {
    return WORKERS_BUDGET.snapshotConcurrency;
  }
}
