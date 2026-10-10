import "server-only";
import type { Meta, OhlcvBar } from "../types";
import { getVnOhlcv } from "./stocks";
import { WORKERS_BUDGET } from "../data-engine/workers-budget";

/**
 * Concurrent OHLCV batch for screeners.
 * - Workers-safe concurrency (default 6)
 * - Process-local L1 cache shared across screeners in the same isolate
 * - Priority symbols fetched first under deadline
 * - One provider cascade per symbol (getVnOhlcv already tries its fallbacks)
 * - Hard cap below the route's Worker wall budget
 */

export type OhlcvPack = { bars: OhlcvBar[]; meta: Meta } | null;

const DEFAULT_CONCURRENCY = WORKERS_BUDGET.ohlcvBatchConcurrency;
const DEFAULT_LIMIT_BARS = WORKERS_BUDGET.screenerBars;
const DEFAULT_PER_SYMBOL_MS = WORKERS_BUDGET.ohlcvPerSymbolMs;
const L1_TTL_MS = 5 * 60_000;

type L1Entry = { bars: OhlcvBar[]; meta: Meta; exp: number };
function l1Store(): Map<string, L1Entry> {
  const g = globalThis as typeof globalThis & { __orcaOhlcvL1?: Map<string, L1Entry> };
  if (!g.__orcaOhlcvL1) g.__orcaOhlcvL1 = new Map();
  return g.__orcaOhlcvL1;
}

function l1Key(sym: string, bars: number): string {
  return `${sym}:${bars}`;
}

function l1Get(sym: string, bars: number): { bars: OhlcvBar[]; meta: Meta } | null {
  const e = l1Store().get(l1Key(sym, bars));
  if (!e) return null;
  if (Date.now() > e.exp) {
    l1Store().delete(l1Key(sym, bars));
    return null;
  }
  return { bars: e.bars, meta: e.meta };
}

function l1Set(sym: string, barsNeeded: number, pack: { bars: OhlcvBar[]; meta: Meta }) {
  const store = l1Store();
  if (store.size > 400) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.exp < now) store.delete(k);
    }
    if (store.size > 400) {
      const keys = [...store.keys()].slice(0, 80);
      for (const k of keys) store.delete(k);
    }
  }
  store.set(l1Key(sym, barsNeeded), { ...pack, exp: Date.now() + L1_TTL_MS });
}

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
  resilient?: boolean;
  priority?: string[];
  skipCache?: boolean;
};

export async function batchVnOhlcv(
  symbols: string[],
  opts: OhlcvBatchOpts = {},
): Promise<Map<string, { bars: OhlcvBar[]; meta: Meta }>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bars = opts.bars ?? DEFAULT_LIMIT_BARS;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 10));
  const perSymbolMs = Math.min(opts.perSymbolMs ?? DEFAULT_PER_SYMBOL_MS, WORKERS_BUDGET.ohlcvPerSymbolMs + 1_000);
  const skipCache = opts.skipCache === true;
  const t0 = Date.now();
  // Never honor a caller-supplied deadline beyond the guard used by screener routes.
  const safeDeadlineMs = Math.min(opts.deadlineMs ?? WORKERS_BUDGET.techScreenWallMs - 1_500,
    WORKERS_BUDGET.techScreenWallMs - 1_500);
  const deadlineAt = t0 + Math.max(1_000, safeDeadlineMs);
  const out = new Map<string, { bars: OhlcvBar[]; meta: Meta }>();

  let ordered = uniq;
  if (opts.priority?.length) {
    const pri = new Set(opts.priority.map((s) => s.toUpperCase()));
    const head = uniq.filter((s) => pri.has(s));
    const tail = uniq.filter((s) => !pri.has(s));
    ordered = [...head, ...tail];
  }

  const needFetch: string[] = [];
  for (const sym of ordered) {
    if (!skipCache) {
      const hit = l1Get(sym, bars);
      if (hit?.bars?.length) {
        out.set(sym, hit);
        continue;
      }
    }
    needFetch.push(sym);
  }

  if (!needFetch.length) return out;

  await mapPool(
    needFetch,
    concurrency,
    async (sym) => {
      try {
        const remain = Math.max(0, deadlineAt - Date.now());
        const timeoutMs = Math.min(perSymbolMs, remain);
        if (timeoutMs <= 0) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let pack: Awaited<ReturnType<typeof getVnOhlcv>> | null;
        try {
          pack = await withTimeout(getVnOhlcv(sym, bars, "stock", controller.signal), timeoutMs);
        } finally {
          clearTimeout(timer);
        }
        if (pack?.bars?.length) {
          out.set(sym, pack);
          if (!skipCache) l1Set(sym, bars, pack);
        }
      } catch {
        /* skip */
      }
    },
    () => Date.now() >= deadlineAt,
  );

  return out;
}

export const SCREENER_UNIVERSE_CAP = WORKERS_BUDGET.techUniverse;
