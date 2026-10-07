import "server-only";
import { isCircuitOpen, recordFailure, recordSuccess } from "../health";

/**
 * Connection resilience primitives for the Data Engine Hub:
 * - hard timeout per attempt
 * - sequential primary → fallback with shared deadline budget
 * - parallel race / gather for multi-source
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
  run: (signal: AbortSignal) => Promise<T>;
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
 */
export async function firstHealthy<T>(
  attempts: FallbackAttempt<T>[],
  opts?: {
    budgetMs?: number;
    perAttemptMs?: number;
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

/** Rank source ids: healthy + lower avg latency first. */
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

/**
 * Fire all attempts in parallel; return the first that accepts.
 */
export async function raceHealthy<T>(
  attempts: FallbackAttempt<T>[],
  opts?: {
    perAttemptMs?: number;
    force?: boolean;
    label?: string;
  },
): Promise<FallbackResult<T>> {
  const perAttemptMs = opts?.perAttemptMs ?? 4_000;
  const label = opts?.label ?? "raceHealthy";
  const chainStarted = performance.now();
  const active = attempts.filter((a) => opts?.force || !isCircuitOpen(a.id));
  if (!active.length) {
    throw new Error(`${label}: no sources (all circuits open)`);
  }

  return new Promise<FallbackResult<T>>((resolve, reject) => {
    let remaining = active.length;
    let settled = false;
    const log: FallbackResult<T>["attempts"] = [];

    for (const a of active) {
      const t0 = performance.now();
      void withTimeout(perAttemptMs, (signal) => a.run(signal), `${label}:${a.id}`)
        .then((value) => {
          const ms = Math.round(performance.now() - t0);
          const ok = a.accept ? a.accept(value) : value != null;
          if (!ok) {
            log.push({ id: a.id, ok: false, ms, error: "empty" });
            recordFailure(a.id, "empty_result");
            remaining -= 1;
            if (!settled && remaining <= 0) {
              reject(new Error(`${label}: all empty`));
            }
            return;
          }
          log.push({ id: a.id, ok: true, ms });
          recordSuccess(a.id, ms);
          if (!settled) {
            settled = true;
            resolve({
              value,
              sourceId: a.id,
              attempts: log,
              totalMs: Math.round(performance.now() - chainStarted),
            });
          }
        })
        .catch((e) => {
          const ms = Math.round(performance.now() - t0);
          const msg = e instanceof Error ? e.message : String(e);
          log.push({ id: a.id, ok: false, ms, error: msg.slice(0, 160) });
          recordFailure(a.id, msg.slice(0, 200));
          remaining -= 1;
          if (!settled && remaining <= 0) {
            reject(new Error(`${label}: all failed`));
          }
        });
    }
  });
}

/**
 * Run all attempts in parallel; return every accepted result (for merge).
 */
export async function gatherHealthy<T>(
  attempts: FallbackAttempt<T>[],
  opts?: {
    perAttemptMs?: number;
    force?: boolean;
    label?: string;
  },
): Promise<{
  hits: Array<{ sourceId: string; value: T; ms: number }>;
  attempts: FallbackResult<T>["attempts"];
  totalMs: number;
}> {
  const perAttemptMs = opts?.perAttemptMs ?? 5_000;
  const label = opts?.label ?? "gatherHealthy";
  const t0 = performance.now();
  const log: FallbackResult<T>["attempts"] = [];
  const hits: Array<{ sourceId: string; value: T; ms: number }> = [];

  await Promise.all(
    attempts.map(async (a) => {
      if (!opts?.force && isCircuitOpen(a.id)) {
        log.push({ id: a.id, ok: false, ms: 0, error: "circuit_open" });
        return;
      }
      const started = performance.now();
      try {
        const value = await withTimeout(perAttemptMs, (signal) => a.run(signal), `${label}:${a.id}`);
        const ms = Math.round(performance.now() - started);
        const ok = a.accept ? a.accept(value) : value != null;
        if (!ok) {
          log.push({ id: a.id, ok: false, ms, error: "empty" });
          recordFailure(a.id, "empty_result");
          return;
        }
        log.push({ id: a.id, ok: true, ms });
        recordSuccess(a.id, ms);
        hits.push({ sourceId: a.id, value, ms });
      } catch (e) {
        const ms = Math.round(performance.now() - started);
        const msg = e instanceof Error ? e.message : String(e);
        log.push({ id: a.id, ok: false, ms, error: msg.slice(0, 160) });
        recordFailure(a.id, msg.slice(0, 200));
      }
    }),
  );

  return { hits, attempts: log, totalMs: Math.round(performance.now() - t0) };
}
