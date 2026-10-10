import "server-only";
import type { Meta, OhlcvBar } from "../types";
import { buildMeta } from "../freshness";
import { getVnOhlcv } from "./stocks";
import { WORKERS_BUDGET } from "../data-engine/workers-budget";

/**
 * Concurrent OHLCV batch for screeners (P2-C).
 * - Workers-safe concurrency (default 5)
 * - Process-local L1 cache shared across screeners in the same isolate
 * - Priority symbols fetched first under deadline
 * - resilient=true → firstHealthy cascade (dchart → vnd → public)
 * - Hard cap below the route's Worker wall budget
 * - Abort remaining workers when deadline hits
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

async function fetchOne(
  sym: string,
  bars: number,
  timeoutMs: number,
  resilient: boolean,
): Promise<{ bars: OhlcvBar[]; meta: Meta } | null> {
  if (resilient) {
    try {
      const { fetchOhlcvResilient } = await import("./screener-ohlcv");
      const hit = await withTimeout(fetchOhlcvResilient(sym, bars), timeoutMs);
      if (hit?.bars?.length) {
        return {
          bars: hit.bars,
          meta:
            (hit.pack as { meta?: Meta } | null)?.meta ??
            buildMeta({ source: "screener-ohlcv-resilient" }),
        };
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const pack = await withTimeout(getVnOhlcv(sym, bars, "stock", controller.signal), timeoutMs);
      if (pack?.bars?.length) return pack;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* */
  }
  return null;
}

/**
 * P2-C: batch OHLCV with concurrency 4–5, per-symbol timeout, hard deadline abort.
 * Processes in chunks of up to 12 for predictable subrequest bursts.
 */
export async function batchVnOhlcv(
  symbols: string[],
  opts: OhlcvBatchOpts = {},
): Promise<Map<string, { bars: OhlcvBar[]; meta: Meta }>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bars = opts.bars ?? DEFAULT_LIMIT_BARS;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, 8));
  const perSymbolMs = Math.min(
    opts.perSymbolMs ?? DEFAULT_PER_SYMBOL_MS,
    WORKERS_BUDGET.ohlcvPerSymbolMs + 800,
  );
  const skipCache = opts.skipCache === true;
  const resilient = opts.resilient === true;
  const t0 = Date.now();
  const safeDeadlineMs = Math.min(
    opts.deadlineMs ?? WORKERS_BUDGET.techScreenWallMs - 1_500,
    WORKERS_BUDGET.techScreenWallMs - 1_500,
  );
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

  // Chunk 8–12 symbols so subrequest bursts stay predictable under Workers budget
  const CHUNK = 12;
  for (let c = 0; c < needFetch.length; c += CHUNK) {
    if (Date.now() >= deadlineAt) break;
    const chunk = needFetch.slice(c, c + CHUNK);
    await mapPool(
      chunk,
      concurrency,
      async (sym) => {
        try {
          const remain = Math.max(0, deadlineAt - Date.now());
          const timeoutMs = Math.min(perSymbolMs, remain);
          if (timeoutMs <= 80) return;
          const pack = await fetchOne(sym, bars, timeoutMs, resilient);
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
  }

  return out;
}

export const SCREENER_UNIVERSE_CAP = WORKERS_BUDGET.techUniverse;
