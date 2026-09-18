import "server-only";
import type { Quote } from "../types";
import * as vndirect from "../providers/vndirect";
import { getVpsQuotes } from "../providers/vps";
import { getVietcapQuotes } from "../providers/vietcap";
import { getSsiIboardQuotes } from "../providers/ssi-iboard";
import { getSsiQuotes, ssiFcConfigured } from "../providers/ssi-fcdata";

/**
 * Reconciliation giá đa nguồn — KHÔNG trung bình.
 *
 * Ưu tiên giá (cao → thấp):
 *   1. vndirect     — nguồn chính dự án
 *   2. vps          — feed realtime public, latency thấp
 *   3. ssi-iboard   — bảng giá sàn
 *   4. ssi-fcdata   — nếu có key
 *   5. vietcap      — profile (ít realtime hơn)
 *
 * Field phụ (volume, name, ceiling…) chỉ fill khi field đang null.
 * Lệch giá lớn giữa nguồn → log, vẫn giữ giá theo ưu tiên.
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
};

const rank = (src: string) => PRICE_PRIORITY[src] ?? 0;

const CONFLICT_PCT = 0.015;
const CONFLICT_ABS = 200;

type TaggedQuote = Quote & { _src: string; _latencyMs: number };

type SourceBatch = {
  src: string;
  quotes: Quote[];
  latencyMs: number;
  ok: boolean;
};

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
  fn: () => Promise<{ quotes: Quote[]; sourceTs: number | null }>,
  timeoutMs: number,
): Promise<SourceBatch> {
  const t0 = performance.now();
  try {
    const r = await withDeadline(fn(), timeoutMs);
    return {
      src,
      quotes: r.quotes ?? [],
      latencyMs: Math.round(performance.now() - t0),
      ok: (r.quotes?.length ?? 0) > 0,
    };
  } catch {
    return {
      src,
      quotes: [],
      latencyMs: Math.round(performance.now() - t0),
      ok: false,
    };
  }
}

function pickPrice(
  existing: TaggedQuote | undefined,
  incoming: Quote,
  src: string,
  latencyMs: number,
): TaggedQuote {
  const tagged: TaggedQuote = { ...incoming, _src: src, _latencyMs: latencyMs };
  if (!existing) return tagged;

  const er = rank(existing._src);
  const ir = rank(src);

  let price = existing.price;
  let priceSrc = existing._src;
  if (ir > er && incoming.price != null && incoming.price > 0) {
    price = incoming.price;
    priceSrc = src;
  } else if (er >= ir && (existing.price == null || existing.price <= 0) && incoming.price != null) {
    price = incoming.price;
    priceSrc = src;
  }

  const preferIncomingForChg = priceSrc === src;
  const change = preferIncomingForChg
    ? (incoming.change ?? existing.change)
    : (existing.change ?? incoming.change);
  const changePercent = preferIncomingForChg
    ? (incoming.changePercent ?? existing.changePercent)
    : (existing.changePercent ?? incoming.changePercent);

  const fill = <T>(a: T | null | undefined, b: T | null | undefined): T | null =>
    a != null && a !== ("" as unknown) ? (a as T) : b != null ? (b as T) : null;

  return {
    ...existing,
    ...incoming,
    symbol: existing.symbol,
    price,
    change,
    changePercent,
    open: fill(existing.open, incoming.open),
    high: fill(existing.high, incoming.high),
    low: fill(existing.low, incoming.low),
    volume: fill(existing.volume, incoming.volume),
    quoteVolume: fill(existing.quoteVolume, incoming.quoteVolume),
    referencePrice: fill(existing.referencePrice, incoming.referencePrice),
    ceilingPrice: fill(existing.ceilingPrice, incoming.ceilingPrice),
    floorPrice: fill(existing.floorPrice, incoming.floorPrice),
    name: fill(existing.name, incoming.name),
    assetClass: existing.assetClass ?? incoming.assetClass ?? "stock",
    updatedAt: existing.updatedAt ?? incoming.updatedAt,
    _src: priceSrc,
    _latencyMs: priceSrc === src ? latencyMs : existing._latencyMs,
  };
}

function countConflicts(batches: SourceBatch[]): number {
  const bySym = new Map<string, { src: string; price: number }[]>();
  for (const b of batches) {
    if (!b.ok) continue;
    for (const q of b.quotes) {
      if (q.price == null || q.price <= 0) continue;
      const arr = bySym.get(q.symbol) ?? [];
      arr.push({ src: b.src, price: q.price });
      bySym.set(q.symbol, arr);
    }
  }
  let n = 0;
  for (const [sym, arr] of bySym) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => rank(b.src) - rank(a.src));
    const a = arr[0]!;
    const b = arr[1]!;
    const abs = Math.abs(a.price - b.price);
    const pct = abs / Math.max(a.price, 1);
    if (abs > CONFLICT_ABS && pct > CONFLICT_PCT) {
      n += 1;
      if (process.env.NODE_ENV !== "production" || process.env.ORCA_LOG_QUOTE_CONFLICT === "1") {
        console.warn(
          `[quote-conflict] ${sym}: ${a.src}=${a.price} vs ${b.src}=${b.price} (Δ${abs.toFixed(0)} / ${(pct * 100).toFixed(2)}%) → keep ${a.src}`,
        );
      }
    }
  }
  return n;
}

export async function getMultiQuotes(symbols: string[]): Promise<MultiQuoteResult> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 100);
  if (!uniq.length) {
    return { quotes: [], sources: [], sourceTs: null, latencies: {}, conflicts: 0 };
  }

  /**
   * Latency strategy:
   * - Tier A: vndirect + vps — timeout 7s, parallel
   * - Tier B: ssi-iboard — timeout 6.5s
   * - Tier C: ssi-fc / vietcap — timeout 5–5.5s if symbols still missing
   */

  const tierA = Promise.all([
    runSource("vndirect", () => vndirect.getVndQuotes(uniq), 7_000),
    runSource("vps", () => getVpsQuotes(uniq), 7_000),
  ]);

  const tierB = runSource("ssi-iboard", () => getSsiIboardQuotes(uniq), 6_500);

  const tierCTasks: Promise<SourceBatch>[] = [
    runSource("vietcap", () => getVietcapQuotes(uniq), 5_000),
  ];
  if (ssiFcConfigured()) {
    tierCTasks.push(runSource("ssi-fcdata", () => getSsiQuotes(uniq), 5_500));
  }

  const tierCPromise = Promise.all(tierCTasks);
  const [aBatches, bBatch] = await Promise.all([tierA, tierB]);

  const primary = [...aBatches, bBatch];
  const covered = new Set<string>();
  for (const b of primary) {
    for (const q of b.quotes) {
      if (q.price != null && q.price > 0) covered.add(q.symbol);
    }
  }
  const missing = uniq.filter((s) => !covered.has(s));

  let cBatches: SourceBatch[] = [];
  if (missing.length > 0) {
    cBatches = await tierCPromise;
  } else {
    cBatches = await Promise.race([
      tierCPromise,
      new Promise<SourceBatch[]>((r) => setTimeout(() => r([]), 200)),
    ]);
  }

  const batches = [...primary, ...cBatches].sort((a, b) => rank(b.src) - rank(a.src));

  const bySym = new Map<string, TaggedQuote>();
  const usedSources: string[] = [];
  const latencies: Record<string, number> = {};

  for (const batch of batches) {
    latencies[batch.src] = batch.latencyMs;
    if (!batch.ok && !batch.quotes.length) continue;
    usedSources.push(batch.src);
    for (const q of batch.quotes) {
      const prev = bySym.get(q.symbol);
      bySym.set(q.symbol, pickPrice(prev, q, batch.src, batch.latencyMs));
    }
  }

  const conflicts = countConflicts(batches);

  const quotes: Quote[] = [...bySym.values()].map(({ _src, _latencyMs, ...rest }) => ({
    ...rest,
  }));

  quotes.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    quotes,
    sources: [...new Set(usedSources)],
    sourceTs: quotes.length ? Date.now() : null,
    latencies,
    conflicts,
  };
}
