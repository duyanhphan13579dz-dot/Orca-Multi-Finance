import "server-only";
import type { Quote } from "../types";
import * as vndirect from "../providers/vndirect";
import { getVpsQuotes } from "../providers/vps";
import { getVietcapQuotes } from "../providers/vietcap";
import { getSsiIboardQuotes } from "../providers/ssi-iboard";
import { getSsiQuotes, ssiFcConfigured } from "../providers/ssi-fcdata";
import { getPublicQuotes } from "../providers/public-vn-feed";
import { recordMarketSource } from "../realtime/market-source-monitor";
import { isCircuitOpen } from "../health";

/**
 * Multi-source VN quotes — primary-first then selective fan-out.
 * 1) VNDirect alone (fast path) when coverage ≥ PRIMARY_COVERAGE_OK
 * 2) Only then open VPS / SSI / Vietcap / public to fill gaps
 * Priority merge: never average prices.
 */

export type MultiQuoteResult = {
  quotes: Quote[];
  sources: string[];
  sourceTs: number | null;
  latencies: Record<string, number>;
  conflicts: number;
};

const PRICE_PRIORITY: Record<string, number> = {
  vndirect: 100,
  vps: 90,
  "ssi-iboard": 80,
  "ssi-fcdata": 70,
  vietcap: 40,
  "public-vn": 30,
};

const rank = (src: string) => PRICE_PRIORITY[src] ?? 0;
const CONFLICT_PCT = 0.015;
const CONFLICT_ABS = 200;
/** Fan-out when primary covers less than this fraction (lower = more multi-source fills). */
const PRIMARY_COVERAGE_OK = 0.75;

type TaggedQuote = Quote & { _src: string; _latencyMs: number };
type SourceBatch = { src: string; quotes: Quote[]; latencyMs: number; ok: boolean };
type QuotePack = { quotes: Quote[]; sourceTs: number | null };

async function asPack(fn: () => Promise<Quote[]>): Promise<QuotePack> {
  const quotes = await fn();
  return { quotes: quotes ?? [], sourceTs: quotes?.length ? Date.now() : null };
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("deadline")), ms);
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

async function runSource(
  src: string,
  fn: () => Promise<QuotePack>,
  timeoutMs: number,
): Promise<SourceBatch> {
  if (isCircuitOpen(src) || isCircuitOpen(`sync:${src}`)) {
    return { src, quotes: [], latencyMs: 0, ok: false };
  }
  const t0 = performance.now();
  try {
    const r = await withDeadline(fn(), timeoutMs);
    const latencyMs = Math.round(performance.now() - t0);
    const quotes = (r.quotes ?? []).filter((q) => q?.symbol && Number(q.price) > 0);
    try {
      recordMarketSource(src, quotes.length > 0, latencyMs);
    } catch {
      /* */
    }
    return { src, quotes, latencyMs, ok: quotes.length > 0 };
  } catch {
    const latencyMs = Math.round(performance.now() - t0);
    try {
      recordMarketSource(src, false, latencyMs);
    } catch {
      /* */
    }
    return { src, quotes: [], latencyMs, ok: false };
  }
}

function priceConflict(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  const diff = Math.abs(a - b);
  return diff > CONFLICT_ABS || diff / Math.max(a, b) > CONFLICT_PCT;
}

function pickPrice(
  prev: TaggedQuote | undefined,
  next: Quote,
  src: string,
  latencyMs: number,
): TaggedQuote {
  const tagged: TaggedQuote = { ...next, _src: src, _latencyMs: latencyMs };
  if (!prev) return tagged;
  const pr = rank(prev._src);
  const nr = rank(src);
  if (nr > pr) return tagged;
  if (nr < pr) {
    return {
      ...prev,
      volume: prev.volume ?? next.volume,
      quoteVolume: prev.quoteVolume ?? next.quoteVolume,
      open: prev.open ?? next.open,
      high: prev.high ?? next.high,
      low: prev.low ?? next.low,
      name: prev.name ?? next.name,
      referencePrice: prev.referencePrice ?? next.referencePrice,
      ceilingPrice: prev.ceilingPrice ?? next.ceilingPrice,
      floorPrice: prev.floorPrice ?? next.floorPrice,
    };
  }
  // same rank — keep previous price, fill gaps
  return {
    ...prev,
    volume: prev.volume ?? next.volume,
    quoteVolume: prev.quoteVolume ?? next.quoteVolume,
    open: prev.open ?? next.open,
    high: prev.high ?? next.high,
    low: prev.low ?? next.low,
    name: prev.name ?? next.name,
  };
}

function countConflicts(batches: SourceBatch[]): number {
  const bySym = new Map<string, number[]>();
  for (const b of batches) {
    for (const q of b.quotes) {
      const sym = String(q.symbol).toUpperCase();
      const arr = bySym.get(sym) ?? [];
      if (q.price > 0) arr.push(q.price);
      bySym.set(sym, arr);
    }
  }
  let n = 0;
  for (const prices of bySym.values()) {
    if (prices.length < 2) continue;
    const base = prices[0];
    for (let i = 1; i < prices.length; i++) {
      if (priceConflict(base, prices[i])) {
        n++;
        break;
      }
    }
  }
  return n;
}

function coverageOf(bySym: Map<string, TaggedQuote>, wanted: string[]): number {
  if (!wanted.length) return 1;
  let hit = 0;
  for (const s of wanted) if (bySym.has(s)) hit++;
  return hit / wanted.length;
}

function applyBatch(bySym: Map<string, TaggedQuote>, batch: SourceBatch) {
  for (const q of batch.quotes) {
    const sym = String(q.symbol).toUpperCase();
    const prev = bySym.get(sym);
    bySym.set(sym, pickPrice(prev, { ...q, symbol: sym }, batch.src, batch.latencyMs));
  }
}

function finish(
  bySym: Map<string, TaggedQuote>,
  usedSources: string[],
  latencies: Record<string, number>,
  batches: SourceBatch[],
): MultiQuoteResult {
  const conflicts = countConflicts(batches);
  const quotes: Quote[] = [...bySym.values()]
    .map(({ _src, _latencyMs, ...rest }) => rest)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    quotes,
    sources: [...new Set(usedSources)].sort((a, b) => rank(b) - rank(a)),
    sourceTs: quotes.length ? Date.now() : null,
    latencies,
    conflicts,
  };
}

/** Parallel multi-source quote fetch with primary-first progressive merge. */
export async function getMultiQuotes(symbols: string[]): Promise<MultiQuoteResult> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 80);
  if (!uniq.length) {
    return { quotes: [], sources: [], sourceTs: null, latencies: {}, conflicts: 0 };
  }

  const bySym = new Map<string, TaggedQuote>();
  const latencies: Record<string, number> = {};
  const usedSources: string[] = [];
  const batches: SourceBatch[] = [];

  const primary = await runSource("vndirect", () => vndirect.getVndQuotes(uniq), 4_500);
  latencies.vndirect = primary.latencyMs;
  batches.push(primary);
  if (primary.ok || primary.quotes.length) {
    usedSources.push("vndirect");
    applyBatch(bySym, primary);
  }

  if (coverageOf(bySym, uniq) >= PRIMARY_COVERAGE_OK) {
    return finish(bySym, usedSources, latencies, batches);
  }

  const fallbackTasks: { src: string; p: Promise<SourceBatch> }[] = [
    { src: "vps", p: runSource("vps", () => asPack(() => getVpsQuotes(uniq)), 5_500) },
    {
      src: "ssi-iboard",
      p: runSource("ssi-iboard", () => asPack(() => getSsiIboardQuotes(uniq)), 5_500),
    },
    { src: "vietcap", p: runSource("vietcap", () => getVietcapQuotes(uniq), 5_000) },
    {
      src: "public-vn",
      p: runSource(
        "public-vn",
        async () => {
          const r = await getPublicQuotes(uniq);
          return { quotes: r.quotes ?? [], sourceTs: r.sourceTs ?? Date.now() };
        },
        5_500,
      ),
    },
  ];

  if (ssiFcConfigured()) {
    fallbackTasks.push({
      src: "ssi-fcdata",
      p: runSource(
        "ssi-fcdata",
        async () => {
          const r = await getSsiQuotes(uniq);
          if (Array.isArray(r)) return { quotes: r, sourceTs: r.length ? Date.now() : null };
          return r as QuotePack;
        },
        5_500,
      ),
    });
  }

  await new Promise<void>((resolve) => {
    let pending = fallbackTasks.length;
    if (!pending) {
      resolve();
      return;
    }
    const hardStop = setTimeout(() => resolve(), 7_000);
    let settled = false;

    for (const { src, p } of fallbackTasks) {
      void p.then((batch) => {
        batches.push(batch);
        latencies[src] = batch.latencyMs;
        if (batch.ok || batch.quotes.length) {
          usedSources.push(src);
          applyBatch(bySym, batch);
        }
        pending -= 1;
        if (!settled && coverageOf(bySym, uniq) >= 0.98) {
          settled = true;
          clearTimeout(hardStop);
          resolve();
        }
        if (pending <= 0) {
          settled = true;
          clearTimeout(hardStop);
          resolve();
        }
      });
    }
  });

  return finish(bySym, usedSources, latencies, batches);
}
