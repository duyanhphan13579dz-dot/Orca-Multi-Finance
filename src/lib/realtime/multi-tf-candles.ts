/**
 * MULTI-TIMEFRAME CANDLE ENGINE (Phase 1)
 *
 * Single base series (1m) per symbol → resampled live candles at every
 * timeframe. Unified across asset classes:
 *   - crypto: base comes from the Binance 1m kline WS stream (authoritative
 *     OHLCV) with REST seed fallback when WS is geo-blocked.
 *   - VN stocks: base comes from the VN market data engine (1m frames from
 *     OHLCV polling + tick interpolation) and REST seed history.
 *   - futures / forex / commodity: same path via seeded history + tick feeds.
 *
 * Invariants:
 *   - REST seed + live stream merge at the 1m base (later write wins, the
 *     bucket contribution is replaced by base-open key → no double counting).
 *   - Derived buckets are maintained incrementally: removal of the previous
 *     contribution for a base bar, then addition of the new one.
 *   - `candle.updated` / `candle.closed` typed envelopes are emitted on the
 *     canonical channels only when the (symbol, tf) is subscribed.
 */

import "server-only";
import { TF_MS, type ChartCandle } from "../chart-const";
import { CHANNEL } from "./channels";
import { emitEvent, onEvent, payloadOf } from "./event-envelope";
import { binanceWs } from "./binance-ws";

export interface BaseFrame {
  time: number; // open (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
  transport: string;
  quality?: string;
}

export interface LiveCandle {
  symbol: string;
  timeframe: string;
  candle: ChartCandle;
  closed: boolean;
  quality: string;
  transport: string;
  ts: number;
}

interface Contribution {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Bucket {
  candle: ChartCandle;
  closed: boolean;
  contribs: Map<number, Contribution>;
}

interface Series {
  assetType: string;
  base: Map<number, BaseFrame>;
  byTf: Map<string, Map<number, Bucket>>;
  subs: Map<string, number>; // tf → refcount
  tickOff: (() => void) | null;
  seedPromise: Promise<void> | null;
  lastPrune: number;
}

const BASE_TF = "1m";
const KEEP_BASE = 600; // ~10h of 1m bars
const KEEP_DERIVED = 1200;

function emptyBucket(open: number): Bucket {
  return { candle: { time: open, open: 0, high: 0, low: 0, close: 0, volume: 0 }, closed: false, contribs: new Map() };
}

function applyContribution(candle: ChartCandle, c: Contribution): void {
  if (candle.volume === 0 && candle.open === 0) {
    candle.open = c.o;
    candle.high = c.h;
    candle.low = c.l;
    candle.close = c.c;
    candle.volume = c.v;
    return;
  }
  candle.high = Math.max(candle.high, c.h);
  candle.low = Math.min(candle.low, c.l);
  candle.close = c.c;
  candle.volume = (candle.volume ?? 0) + c.v;
}

/** Rebuild a bucket from its contribution map (O(k), used on rare replaces). */
function rebuildBucket(bucket: Bucket): void {
  const first = bucket.candle;
  first.open = 0;
  first.high = 0;
  first.low = 0;
  first.close = 0;
  first.volume = 0;
  for (const [, c] of [...bucket.contribs.entries()].sort((a, b) => a[0] - b[0])) {
    if (first.volume === 0 && first.open === 0) {
      first.open = c.o;
      first.high = c.h;
      first.low = c.l;
      first.close = c.c;
      first.volume = c.v;
    } else {
      first.high = Math.max(first.high, c.h);
      first.low = Math.min(first.low, c.l);
      first.close = c.c;
      first.volume += c.v;
    }
  }
}

class MultiTimeframeCandleEngine {
  private series = new Map<string, Series>(); // SYMBOL → series

  hasSubs(symbol: string): boolean {
    return this.series.has(symbol.toUpperCase());
  }

  subscribedSymbols(): string[] {
    return [...this.series.keys()];
  }

  /**
   * Subscribe to live candles for a symbol at several timeframes.
   * `seed` (optional) fetches REST history once and merges it into the base.
   * Returns an unsubscribe function (refcounted per symbol+tf).
   */
  subscribe(
    symbol: string,
    assetType: string,
    timeframes: string[],
    opts: { seed?: () => Promise<ChartCandle[]>; klineBase?: boolean } = {},
  ): () => void {
    const sym = symbol.toUpperCase();
    let s = this.series.get(sym);
    if (!s) {
      s = {
        assetType,
        base: new Map(),
        byTf: new Map(),
        subs: new Map(),
        tickOff: null,
        seedPromise: null,
        lastPrune: Date.now(),
      };
      this.series.set(sym, s);
      // 1m base wiring: Binance kline (crypto) + central tick feed (all)
      if (opts.klineBase) this.wireKlineBase(sym, s);
      this.wireTick(sym, s);
    }

    // Seed merge (once per symbol)
    if (opts.seed && !s.seedPromise) {
      s.seedPromise = opts
        .seed()
        .then((bars) => {
          for (const b of bars) {
            this.applyBaseFrame(sym, {
              time: b.time,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
              volume: b.volume ?? 0,
              closed: true,
              transport: "rest:seed",
              quality: "VALID",
            });
          }
        })
        .catch(() => {
          /* seed is best-effort — live stream continues */
        });
    }

    const tfMap = s.subs;
    for (const tf of timeframes) tfMap.set(tf, (tfMap.get(tf) ?? 0) + 1);
    return () => {
      const cur = this.series.get(sym);
      if (!cur) return;
      for (const tf of timeframes) {
        const n = (cur.subs.get(tf) ?? 1) - 1;
        if (n <= 0) cur.subs.delete(tf);
        else cur.subs.set(tf, n);
      }
      if (cur.subs.size === 0) this.releaseSeries(sym, cur);
    };
  }

  private releaseSeries(sym: string, s: Series): void {
    s.tickOff?.();
    s.tickOff = null;
    this.series.delete(sym);
  }

  private wireKlineBase(sym: string, s: Series): void {
    binanceWs.requestKline(sym, BASE_TF);
    onEvent(CHANNEL.kline(sym, BASE_TF), (raw) => {
      const p = payloadOf<{ candle: { time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean } }>(raw);
      if (!p?.candle) return;
      const c = p.candle;
      this.applyBaseFrame(sym, { ...c, transport: "binance-ws:kline", quality: "VALID" });
    });
  }

  private wireTick(sym: string, s: Series): void {
    s.tickOff = onEvent(CHANNEL.tick(sym), (raw) => {
      const p = payloadOf<{ price: number; cumVolume?: number; cumQuoteVolume?: number; ts: number }>(raw);
      if (!p || !Number.isFinite(p.price) || p.price <= 0) return;
      this.feedTick(sym, s.assetType, p.price, p.ts ?? Date.now(), p.cumVolume ?? 0);
    });
  }

  /**
   * Ingest an authoritative base frame (1m). Used by the Binance WS kline
   * stream and by the VN engine.
   */
  applyBaseFrame(symbol: string, frame: BaseFrame): void {
    const sym = symbol.toUpperCase();
    const s = this.series.get(sym);
    const had = s?.base.get(frame.time);
    s?.base.set(frame.time, frame);
    if (s) {
      this.propagate(sym, frame, Boolean(had));
      this.prune(sym, s);
    }
  }

  /** Tick → update the current 1m base bar (used when no kline frame yet). */
  feedTick(symbol: string, assetType: string, price: number, ts: number, cumVolume = 0): void {
    const sym = symbol.toUpperCase();
    const s = this.series.get(sym);
    if (!s) return;
    const bucket = Math.floor(ts / 60_000) * 60_000;
    const existing = s.base.get(bucket);
    const frame: BaseFrame = {
      time: bucket,
      open: existing?.open ?? price,
      high: Math.max(existing?.high ?? price, price),
      low: Math.min(existing?.low ?? price, price),
      close: price,
      volume: Math.max(cumVolume, existing?.volume ?? 0),
      closed: ts >= bucket + 60_000,
      transport: existing?.transport ?? "tick:interp",
      quality: "VALID",
    };
    s.base.set(bucket, frame);
    this.propagate(sym, frame, Boolean(existing));
    this.prune(sym, s);
    void assetType;
  }

  /**
   * Seed REST history directly into a target timeframe's buckets (e.g. daily
   * OHLCV for VN). Live 1m propagation continues to overlay current buckets.
   * Idempotent: skips bucketOpens that already have live data.
   */
  seedTf(symbol: string, tf: string, bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[], assetType = "stock"): void {
    const sym = symbol.toUpperCase();
    if (!this.series.has(sym)) this.subscribe(sym, assetType, [tf]);
    const series = this.series.get(sym);
    if (!series) return;
    const tfMs = TF_MS[tf];
    if (!tfMs) return;
    let buckets = series.byTf.get(tf);
    if (!buckets) {
      buckets = new Map();
      series.byTf.set(tf, buckets);
    }
    const now = Date.now();
    for (const b of bars) {
      const open = Math.floor(b.time / tfMs) * tfMs;
      if (buckets.has(open)) continue; // live data wins
      const bucket = emptyBucket(open);
      bucket.candle = { time: open, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      bucket.closed = open + tfMs <= now;
      bucket.contribs.set(open, { o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume });
      buckets.set(open, bucket);
    }
  }

  /** Current live candle for (symbol, tf). */
  current(symbol: string, tf: string): LiveCandle | null {
    const s = this.series.get(symbol.toUpperCase());
    if (!s) return null;
    const buckets = s.byTf.get(tf);
    if (!buckets || buckets.size === 0) return null;
    const last = [...buckets.values()].sort((a, b) => b.candle.time - a.candle.time)[0];
    if (!last) return null;
    const fee = s.base.get(last.candle.time);
    return {
      symbol: symbol.toUpperCase(),
      timeframe: tf,
      candle: last.candle,
      closed: last.closed,
      quality: fee?.quality ?? "VALID",
      transport: fee?.transport ?? "engine:resample",
      ts: Date.now(),
    };
  }

  /** Full history (seeded REST + live) for (symbol, tf), ascending. */
  history(symbol: string, tf: string): ChartCandle[] {
    const s = this.series.get(symbol.toUpperCase());
    if (!s) return [];
    const buckets = s.byTf.get(tf);
    if (!buckets) return [];
    return [...buckets.values()].map((b) => b.candle).sort((a, b) => a.time - b.time);
  }

  tfSubscribed(symbol: string, tf: string): boolean {
    return (this.series.get(symbol.toUpperCase())?.subs.get(tf) ?? 0) > 0;
  }

  /* ------------------------- derived propagation ------------------------- */

  private propagate(sym: string, frame: BaseFrame, replaced: boolean): void {
    const s = this.series.get(sym);
    if (!s) return;
    const now = Date.now();
    for (const [tf, subsN] of s.subs) {
      if (subsN <= 0) continue;
      const tfMs = TF_MS[tf];
      if (!tfMs) continue;
      let buckets = s.byTf.get(tf);
      if (!buckets) {
        buckets = new Map();
        s.byTf.set(tf, buckets);
      }
      const open = Math.floor(frame.time / tfMs) * tfMs;
      let bucket = buckets.get(open);
      if (!bucket) {
        bucket = emptyBucket(open);
        buckets.set(open, bucket);
      }
      const newC: Contribution = { o: frame.open, h: frame.high, l: frame.low, c: frame.close, v: frame.volume };
      const prev = bucket.contribs.get(frame.time);
      if (prev) {
        // Exact fast-path removal: replaced bar is neither the bucket extreme
        // nor the first bar (open source) → O(1) adjust.
        const minKey = Math.min(...bucket.contribs.keys());
        const extreme = prev.h >= bucket.candle.high || prev.l <= bucket.candle.low || frame.time === minKey;
        bucket.contribs.delete(frame.time);
        if (extreme) {
          bucket.contribs.set(frame.time, newC);
          rebuildBucket(bucket);
        } else {
          // Fast path: extremes + open unchanged → O(1) close/volume adjust.
          bucket.candle.volume = Math.max(0, (bucket.candle.volume ?? 0) - prev.v + newC.v);
          bucket.candle.close = newC.c;
          bucket.contribs.set(frame.time, newC);
        }
      } else {
        applyContribution(bucket.candle, newC);
        bucket.contribs.set(frame.time, newC);
      }
      const closed = frame.closed && open + tfMs <= now;
      const wasClosed = bucket.closed;
      bucket.closed = closed;
      const live: LiveCandle = {
        symbol: sym,
        timeframe: tf,
        candle: bucket.candle,
        closed,
        quality: frame.quality ?? "VALID",
        transport: frame.transport,
        ts: now,
      };
      emitEvent(CHANNEL.candleUpdated(sym, tf), "candle.updated", live, {
        assetType: s.assetType,
        symbol: sym,
        ts: now,
      });
      if (closed && !wasClosed) {
        emitEvent(CHANNEL.candleClosed(sym, tf), "candle.closed", live, { assetType: s.assetType, symbol: sym, ts: now });
      }
    }
    void replaced;
  }

  private prune(sym: string, s: Series): void {
    if (Date.now() - s.lastPrune < 60_000) return;
    s.lastPrune = Date.now();
    const baseKeys = [...s.base.keys()].sort((a, b) => b - a);
    for (const k of baseKeys.slice(KEEP_BASE)) s.base.delete(k);
    for (const [, buckets] of s.byTf) {
      const keys = [...buckets.keys()].sort((a, b) => b - a);
      for (const k of keys.slice(KEEP_DERIVED)) buckets.delete(k);
    }
    void sym;
  }

  stats(): { symbols: number; baseBars: number; derivedTfs: number } {
    let base = 0;
    let derived = 0;
    for (const s of this.series.values()) {
      base += s.base.size;
      derived += s.byTf.size;
    }
    return { symbols: this.series.size, baseBars: base, derivedTfs: derived };
  }
}

const g = globalThis as typeof globalThis & { __orcaMultiTf?: MultiTimeframeCandleEngine };
export const multiTfCandles = g.__orcaMultiTf ?? new MultiTimeframeCandleEngine();
g.__orcaMultiTf = multiTfCandles;
