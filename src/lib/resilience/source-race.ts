import "server-only";
import { isCircuitOpen } from "../health";

/**
 * Parallel multi-source race utilities for VN + global market data.
 * - Skip open circuits
 * - Per-source deadline (default 9s)
 * - Early resolve when coverage threshold met
 * - Merge strategies: firstWins | preferPrimary | fillGaps
 */

export type SourceTask<T> = {
  id: string;
  circuit?: string;
  run: () => Promise<T>;
  timeoutMs?: number;
};

export type SettledSource<T> = {
  id: string;
  ok: boolean;
  value: T | null;
  latencyMs: number;
  error?: string;
};

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`deadline:${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function settleSource<T>(
  task: SourceTask<T>,
  defaultTimeoutMs = 9_000,
): Promise<SettledSource<T>> {
  const circuit = task.circuit ?? task.id;
  if (isCircuitOpen(circuit) || isCircuitOpen(`sync:${circuit}`)) {
    return { id: task.id, ok: false, value: null, latencyMs: 0, error: "circuit_open" };
  }
  const t0 = performance.now();
  try {
    const value = await withDeadline(task.run(), task.timeoutMs ?? defaultTimeoutMs);
    return {
      id: task.id,
      ok: value != null,
      value,
      latencyMs: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return {
      id: task.id,
      ok: false,
      value: null,
      latencyMs: Math.round(performance.now() - t0),
      error: e instanceof Error ? e.message : "failed",
    };
  }
}

export async function raceSources<T>(
  tasks: SourceTask<T>[],
  opts?: {
    defaultTimeoutMs?: number;
    hardStopMs?: number;
    isEnough?: (value: T, id: string) => boolean;
  },
): Promise<SettledSource<T>[]> {
  const defaultTimeoutMs = opts?.defaultTimeoutMs ?? 9_000;
  const hardStopMs = opts?.hardStopMs ?? Math.max(defaultTimeoutMs + 2_000, 12_000);
  const results: SettledSource<T>[] = [];
  const pending = tasks.map((task) => settleSource(task, defaultTimeoutMs));

  await new Promise<void>((resolve) => {
    let left = pending.length;
    if (!left) {
      resolve();
      return;
    }
    const hard = setTimeout(() => resolve(), hardStopMs);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      resolve();
    };
    for (const p of pending) {
      void p.then((r) => {
        results.push(r);
        if (r.ok && r.value != null && opts?.isEnough?.(r.value, r.id)) finish();
        left -= 1;
        if (left <= 0) finish();
      });
    }
  });

  return results;
}

export function pickByPriority<T>(
  settled: SettledSource<T>[],
  priority: string[],
): SettledSource<T> | null {
  for (const id of priority) {
    const hit = settled.find((s) => s.id === id && s.ok && s.value != null);
    if (hit) return hit;
  }
  return settled.find((s) => s.ok && s.value != null) ?? null;
}

export function mergeIndexQuotes(
  batches: { source: string; items: import("../types").IndexQuote[] }[],
  priority: string[],
): import("../types").IndexQuote[] {
  const rank = (s: string) => {
    const i = priority.indexOf(s);
    return i < 0 ? 99 : i;
  };
  const sorted = [...batches].sort((a, b) => rank(a.source) - rank(b.source));
  const byCode = new Map<string, import("../types").IndexQuote>();
  for (const batch of sorted) {
    for (const item of batch.items) {
      const code = item.code.toUpperCase();
      const prev = byCode.get(code);
      if (!prev) {
        byCode.set(code, { ...item, code });
        continue;
      }
      byCode.set(code, {
        ...item,
        ...prev,
        code,
        name: prev.name || item.name,
        volume: prev.volume ?? item.volume,
        updatedAt: prev.updatedAt ?? item.updatedAt,
        change: prev.change ?? item.change,
        changePercent: prev.changePercent ?? item.changePercent,
        value: prev.value ?? item.value,
      });
    }
  }
  return [...byCode.values()];
}
