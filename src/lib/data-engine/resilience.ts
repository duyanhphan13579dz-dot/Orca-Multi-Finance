import "server-only";
import { isCircuitOpen, recordFailure, recordSuccess } from "../health";

/**
 * Connection resilience primitives for the Data Engine Hub:
 * - hard timeout per attempt
 * - sequential primary → fallback with shared deadline budget
 * - circuit-aware skip of known-bad providers
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`timeout after ${ms}ms (${label})`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  ms: number,
  producer: (signal: AbortSignal) => Promise<T>,
  label = "op",
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(50, ms));
  const started = performance.now();
  return (async () => {
    try {
      const value = await producer(ctrl.signal);
      if (ctrl.signal.aborted) throw new TimeoutError(label, ms);
      return value;
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
        throw new TimeoutError(label, ms);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      void started;
    }
  })();
}

export type FallbackAttempt<T> = {
  id: string;
  /** Prefer skipping when circuit is open (unless force). */
  run: (signal: AbortSignal) => Promise<T>;
  /** Optional accept predicate — reject soft-empty results so next source runs. */
  accept?: (value: T) => boolean;
};

export type FallbackResult<T> = {
  value: T;
  sourceId: string;
  attempts: Array<{ id: string; ok: boolean; ms: number; error?: string }>;
  totalMs: number;
};

/**
 * Try sources in order until one accepts, respecting a shared wall-clock budget.
 * Skips providers with open circuit breakers (health registry).
 */
export async function firstHealthy<T>(
  attempts: FallbackAttempt<T>[],
  opts?: {
    /** Total budget for the whole chain (ms). Default 8s. */
    budgetMs?: number;
    /** Per-attempt timeout; remaining budget is also applied. Default 3.5s. */
    perAttemptMs?: number;
    /** If true, ignore circuit open state. */
    force?: boolean;
    label?: string;
  },
): Promise<FallbackResult<T>> {
  const budgetMs = opts?.budgetMs ?? 8_000;
  const perAttemptMs = opts?.perAttemptMs ?? 3_500;
  const label = opts?.label ?? "firstHealthy";
  const chainStarted = performance.now();
  const log: FallbackResult<T>["attempts"] = [];

  let lastErr: unknown = null;

  for (const a of attempts) {
    const elapsed = performance.now() - chainStarted;
    const remain = budgetMs - elapsed;
    if (remain < 80) break;

    if (!opts?.force && isCircuitOpen(a.id)) {
      log.push({ id: a.id, ok: false, ms: 0, error: "circuit_open" });
      continue;
    }

    const slice = Math.min(perAttemptMs, remain);
    const t0 = performance.now();
    try {
      const value = await withTimeout(slice, (signal) => a.run(signal), `${label}:${a.id}`);
      const ms = Math.round(performance.now() - t0);
      const ok = a.accept ? a.accept(value) : value != null;
      if (!ok) {
        log.push({ id: a.id, ok: false, ms, error: "empty" });
        recordFailure(a.id, "empty_result");
        continue;
      }
      log.push({ id: a.id, ok: true, ms });
      recordSuccess(a.id, ms);
      return {
        value,
        sourceId: a.id,
        attempts: log,
        totalMs: Math.round(performance.now() - chainStarted),
      };
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      const msg = e instanceof Error ? e.message : String(e);
      log.push({ id: a.id, ok: false, ms, error: msg.slice(0, 160) });
      recordFailure(a.id, msg.slice(0, 200));
      lastErr = e;
    }
  }

  const err =
    lastErr instanceof Error
      ? lastErr
      : new Error(`${label}: all sources failed (${log.map((x) => x.id).join(",") || "none"})`);
  (err as Error & { attempts?: unknown }).attempts = log;
  throw err;
}

/** Rank source ids: healthy + lower avg latency first. Uses process health registry. */
export function rankSourceIds(
  ids: string[],
  health: Array<{ provider: string; status: string; avgLatencyMs: number | null; circuit?: string }>,
): string[] {
  const map = new Map(health.map((h) => [h.provider, h]));
  const score = (id: string) => {
    const h = map.get(id);
    if (!h) return 5000;
    if (h.circuit === "open" || h.status === "down") return 50_000;
    if (h.status === "degraded") return 10_000 + (h.avgLatencyMs ?? 2000);
    if (h.status === "unknown") return 3000;
    return h.avgLatencyMs ?? 500;
  };
  return [...ids].sort((a, b) => score(a) - score(b));
}
