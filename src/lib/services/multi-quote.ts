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
 * Multi-source VN quotes — parallel fan-out + priority merge (không trung bình giá).
 * Ưu tiên: vndirect > vps > ssi-iboard > ssi-fcdata > vietcap > public-vn
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
    const quotes = (r.quotes ?? []).filter((q) => q?.symbol);
    const ok = quotes.length > 0;
    try {
      recordMarketSource(src, ok, latencyMs);
    } catch {
      /* */
    }
    return { src, quotes, latencyMs, ok };
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

function pricesConflict(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff >= CONFLICT_ABS || diff / Math.max(a, b) >= CONFLICT_PCT;
}

function pickPrice(prev: TaggedQuote | undefined, next: Quote, src: string, latencyMs: number): TaggedQuote {
  const tagged: TaggedQuote = { ...next, _src: src, _latencyMs: latencyMs };
  if (!prev) return tagged;

  const preferNext = rank(src) > rank(prev._src);
  const preferPrev = rank(src) < rank(prev._src);

  let price = prev.price;
  let winnerSrc = prev._src;
  if (next.price != null && Number.isFinite(next.price) && next.price > 0) {
    if (prev.price == null || !Number.isFinite(prev.price) || prev.price <= 0) {
      price = next.price;
      winnerSrc = src;
    } else if (preferNext) {
      price = next.price;
      winnerSrc = src;
    } else if (!preferPrev && latencyMs < prev._latencyMs) {
      price = next.price;
      winnerSrc = src;
    }
  }

  const fill = <K extends keyof Quote>(key: K): Quote[K] => {
    const pv = prev[key];
    const nv = next[key];
    if (pv != null && pv !== "" && !(typeof pv === "number" && !Number.isFinite(pv as number))) return pv;
    return nv as Quote[K];
  };

  return {
    ...prev,
    name: fill("name"),
    change: fill("change"),
    changePercent: fill("changePercent"),
    volume: fill("volume"),
    quoteVolume: fill("quoteVolume"),
    high: fill("high"),
    low: fill("low"),
    open: fill("open"),
    referencePrice: fill("referencePrice"),
    ceilingPrice: fill("ceilingPrice"),
    floorPrice: fill("floorPrice"),
    updatedAt: fill("updatedAt"),
    symbol: prev.symbol || next.symbol,
    price: price ?? next.price ?? prev.price,
    _src: winnerSrc,
    _latencyMs: winnerSrc === src ? latencyMs : prev._latencyMs,
  } as TaggedQuote;
}

function countConflicts(batches: SourceBatch[]): number {
  const bySym = new Map<string, number[]>();
  for (const b of batches) {
    for (const q of b.quotes) {
      if (q.price == null || !Number.isFinite(q.price) || q.price <= 0) continue;
      const arr = bySym.get(q.symbol) ?? [];
      arr.push(q.price);
      bySym.set(q.symbol, arr);
    }
  }
  let n = 0;
  for (const prices of bySym.values()) {
    if (prices.length < 2) continue;
    const base = prices[0];
    if (prices.some((p) => pricesConflict(base, p))) n++;
  }
  return n;
}

function coverageOf(bySym: Map<string, TaggedQuote>, wanted: string[]): number {
  if (!wanted.length) return 1;
  let hit = 0;
  for (const s of wanted) {
    const q = bySym.get(s);
    if (q?.price != null && Number.isFinite(q.price) && q.price > 0) hit++;
  }
  return hit / wanted.length;
}

/** Parallel multi-source quote fetch with progressive merge. */
export async function getMultiQuotes(symbols: string[]): Promise<MultiQuoteResult> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 80);
  if (!uniq.length) {
    return { quotes: [], sources: [], sourceTs: null, latencies: {}, conflicts: 0 };
  }

  const tasks: { src: string; p: Promise<SourceBatch> }[] = [
    { src: "vndirect", p: runSource("vndirect", () => vndirect.getVndQuotes(uniq), 5_500) },
    { src: "vps", p: runSource("vps", () => asPack(() => getVpsQuotes(uniq)), 5_000) },
    { src: "ssi-iboard", p: runSource("ssi-iboard", () => asPack(() => getSsiIboardQuotes(uniq)), 5_000) },
    { src: "vietcap", p: runSource("vietcap", () => getVietcapQuotes(uniq), 4_500) },
    {
      src: "public-vn",
      p: runSource("public-vn", async () => {
        const r = await getPublicQuotes(uniq);
        return { quotes: r.quotes ?? [], sourceTs: r.sourceTs ?? Date.now() };
      }, 5_000),
    },
  ];

  if (ssiFcConfigured()) {
    tasks.push({
      src: "ssi-fcdata",
      p: runSource(
        "ssi-fcdata",
        async () => {
          const r = await getSsiQuotes(uniq);
          if (Array.isArray(r)) return { quotes: r, sourceTs: r.length ? Date.now() : null };
          return r as QuotePack;
        },
        5_000,
      ),
    });
  }

  const bySym = new Map<string, TaggedQuote>();
  const latencies: Record<string, number> = {};
  const usedSources: string[] = [];
  const batches: SourceBatch[] = [];

  await new Promise<void>((resolve) => {
    let pending = tasks.length;
    if (!pending) {
      resolve();
      return;
    }
    const hardStop = setTimeout(() => resolve(), 7_500);
    let settled = false;

    for (const { src, p } of tasks) {
      void p.then((batch) => {
        batches.push(batch);
        latencies[src] = batch.latencyMs;
        if (batch.ok || batch.quotes.length) {
          usedSources.push(src);
          for (const q of batch.quotes) {
            const sym = String(q.symbol).toUpperCase();
            const prev = bySym.get(sym);
            bySym.set(sym, pickPrice(prev, { ...q, symbol: sym }, batch.src, batch.latencyMs));
          }
        }
        pending -= 1;
        if (!settled && coverageOf(bySym, uniq) >= 0.999) {
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

  if (coverageOf(bySym, uniq) < 0.85) {
    await Promise.race([
      Promise.all(tasks.map((t) => t.p.catch(() => null))),
      new Promise((r) => setTimeout(r, 1_200)),
    ]);
  }

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
