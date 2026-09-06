/**
 * IN-MEMORY RATE LIMITER — fixed-window counters.
 *
 * Sufficient for per-instance auth throttling in a single-process Next.js
 * server; NOT a cross-instance/Redis solution. Design decision: never block
 * legitimate traffic silently — counters age out and memory is bounded by
 * periodic pruning of expired buckets.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

/** Record an attempt for `key`; returns true when the attempt is allowed. */
export function takeRateLimit(
  key: string,
  limit: number,
  windowMs = WINDOW_MS,
  now = Date.now(),
): boolean {
  prune(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** Remaining allowed attempts for `key` (0 when exhausted). */
export function rateLimitRemaining(key: string, limit: number, now = Date.now()): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return limit;
  return Math.max(0, limit - b.count);
}

/** Drop expired buckets; also a hard cap so unbounded keys cannot leak memory. */
function prune(now: number): void {
  if (now - lastPrune < WINDOW_MS) return;
  lastPrune = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
  if (buckets.size > 10_000) {
    const cutoff = now - WINDOW_MS;
    for (const [k, b] of buckets) if (b.resetAt <= cutoff) buckets.delete(k);
  }
}

/** Testing/ops hook: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
  lastPrune = Date.now();
}
