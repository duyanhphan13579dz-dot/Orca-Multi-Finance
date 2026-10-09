import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { WORKERS_BUDGET } from "./workers-budget";

/**
 * Per-request Workers resource guard.
 *
 * Cloudflare Error 1102 = exceeded CPU / memory / subrequest limits.
 * Every heavy API path should run inside `runGuarded` so we:
 *  - share one wall-clock deadline
 *  - cap concurrent outbound work
 *  - count approximate subrequests and stop before the platform kills us
 *  - enter "overload" mode → serve last-good / empty shell only
 */

export type GuardState = {
  startedAt: number;
  wallMs: number;
  maxSubrequests: number;
  subrequests: number;
  inFlight: number;
  maxConcurrent: number;
  overload: boolean;
  label: string;
  notes: string[];
};

const als = new AsyncLocalStorage<GuardState>();

function storeOf(): GuardState | undefined {
  return als.getStore();
}

export function getGuard(): GuardState | undefined {
  return storeOf();
}

export function isOverloaded(): boolean {
  const g = storeOf();
  if (!g) return false;
  if (g.overload) return true;
  if (g.subrequests >= g.maxSubrequests) {
    g.overload = true;
    g.notes.push("subrequest_cap");
    return true;
  }
  if (Date.now() - g.startedAt >= g.wallMs) {
    g.overload = true;
    g.notes.push("wall_budget");
    return true;
  }
  return false;
}

export function budgetLeftMs(): number {
  const g = storeOf();
  if (!g) return 8_000;
  return Math.max(0, g.wallMs - (Date.now() - g.startedAt));
}

/** Call before every outbound provider hop. Returns false if should skip. */
export function tryAcquireSubrequest(n = 1): boolean {
  const g = storeOf();
  if (!g) return true;
  if (g.overload) return false;
  if (g.subrequests + n > g.maxSubrequests) {
    g.overload = true;
    g.notes.push(`subreq_block(+${n})`);
    return false;
  }
  if (Date.now() - g.startedAt >= g.wallMs - 200) {
    g.overload = true;
    g.notes.push("wall_near");
    return false;
  }
  g.subrequests += n;
  return true;
}

export function recordSubrequests(n: number) {
  const g = storeOf();
  if (!g) return;
  g.subrequests += Math.max(0, n);
  if (g.subrequests >= g.maxSubrequests) {
    g.overload = true;
    g.notes.push("subreq_hit");
  }
}

/**
 * Run async work under concurrency + subrequest + wall budget.
 * Returns null on timeout / overload / error.
 */
export async function guardedCall<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { cost?: number; timeoutMs?: number },
): Promise<T | null> {
  const g = storeOf();
  const cost = opts?.cost ?? 1;
  if (g && !tryAcquireSubrequest(cost)) return null;

  const timeoutMs =
    opts?.timeoutMs ??
    Math.min(WORKERS_BUDGET.providerSoftMs, g ? budgetLeftMs() : WORKERS_BUDGET.providerSoftMs);

  if (g) {
    const waitStart = Date.now();
    while (g.inFlight >= g.maxConcurrent) {
      if (Date.now() - waitStart > 1_500 || isOverloaded()) return null;
      await new Promise((r) => setTimeout(r, 25));
    }
    g.inFlight += 1;
  }

  try {
    const result = await Promise.race([
      fn().catch(() => null as T | null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(200, timeoutMs))),
    ]);
    return result;
  } finally {
    if (g) g.inFlight = Math.max(0, g.inFlight - 1);
  }
}

export type GuardOpts = {
  label?: string;
  wallMs?: number;
  maxSubrequests?: number;
  maxConcurrent?: number;
};

/** Wrap an entire API handler / producer. Nested calls reuse outer guard. */
export async function runGuarded<T>(fn: () => Promise<T>, opts?: GuardOpts): Promise<T> {
  const existing = storeOf();
  if (existing) return fn();

  const state: GuardState = {
    startedAt: Date.now(),
    wallMs: opts?.wallMs ?? WORKERS_BUDGET.apiWallMs,
    maxSubrequests: opts?.maxSubrequests ?? WORKERS_BUDGET.maxSubrequestsPerRequest,
    subrequests: 0,
    inFlight: 0,
    maxConcurrent: opts?.maxConcurrent ?? WORKERS_BUDGET.maxParallelProviders,
    overload: false,
    label: opts?.label ?? "api",
    notes: [],
  };

  return als.run(state, fn);
}

export function guardMeta(): {
  overload: boolean;
  subrequests: number;
  elapsedMs: number;
  notes: string[];
} | null {
  const g = storeOf();
  if (!g) return null;
  return {
    overload: g.overload,
    subrequests: g.subrequests,
    elapsedMs: Date.now() - g.startedAt,
    notes: g.notes.slice(-6),
  };
}

type OverloadBucket = { count: number; until: number };
function overloadBucket(): OverloadBucket {
  const g = globalThis as typeof globalThis & { __orcaOverload?: OverloadBucket };
  if (!g.__orcaOverload) g.__orcaOverload = { count: 0, until: 0 };
  return g.__orcaOverload;
}

export function markIsolateOverload() {
  const b = overloadBucket();
  b.count += 1;
  if (b.count >= 2) {
    b.until = Date.now() + 60_000;
    b.count = 0;
  }
}

export function isIsolateCoolingDown(): boolean {
  const b = overloadBucket();
  if (Date.now() < b.until) return true;
  if (Date.now() - b.until > 120_000) b.count = 0;
  return false;
}
