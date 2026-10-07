import "server-only";
import { eventBus } from "../events";
import { TF_MS, type ChartCandle } from "../chart-const";
import { validateQuote, logQualityEvent } from "../quality";
import { binanceWs, KLINE_INTERVALS, type KlineCandle } from "./binance-ws";
import { marketTickRouter } from "./market-ticks";

/**
 * CANDLE AGGREGATION ENGINE — live current-candles from centralized tick/kline feed.
 * VN daily bars align to session close T15:00:00+07 (same as VNDIRECT history).
 * seed() locks live bar to last history candle so chart is not hard-snapshot.
 * forex: UTC buckets + market-tick from Biquote public poll.
 */

export interface Tick {
  symbol: string;
  price: number;
  cumVolume: number;
  cumQuoteVolume: number;
  ts: number;
  source?: "binance" | "vndirect" | "ssi-fallback" | "biquote";
  degraded?: boolean;
}

export type CandleAssetClass = "crypto" | "vn-stock" | "vn-index" | "forex";

export interface CandleSubscriptionOptions {
  assetClass: CandleAssetClass;
}

interface LiveBar extends ChartCandle {
  bucket: number;
  firstCum: number;
  lastCum: number;
  updates: number;
  lastEmit: number;
  source?: Tick["source"];
  degraded?: boolean;
}

const EMIT_THROTTLE_MS = 400;
const VALIDATE_THROTTLE_MS = 2_000;

function vnSessionDateKey(ts: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (ty: string) => parts.find((p) => p.type === ty)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function vnDayBucket(ts: number): number {
  return Date.parse(`${vnSessionDateKey(ts)}T15:00:00+07:00`);
}

function bucketFor(ts: number, tf: string, assetClass: "crypto" | "vn"): number {
  if (assetClass === "vn" && tf === "1d") return vnDayBucket(ts);
  const tfMs = TF_MS[tf];
  if (!tfMs) return ts;
  return Math.floor(ts / tfMs) * tfMs;
}

function toCandle(bar: LiveBar): ChartCandle {
  return {
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

class CandleAggregator {
  private subs = new Map<string, Map<string, number>>();
  private bars = new Map<string, LiveBar>();
  private tickOffs = new Map<string, () => void>();
  private klineActive = new Set<string>();
  private lastValidated = new Map<string, { at: number; status: string }>();

  hasSubs(symbol: string): boolean {
    return (this.subs.get(symbol.toUpperCase())?.size ?? 0) > 0;
  }

  subscribedSymbols(): string[] {
    return [...this.subs.keys()];
  }

  subscribe(symbol: string, tf: string, opts: CandleSubscriptionOptions): () => void {
    const sym = symbol.toUpperCase();
    let tfMap = this.subs.get(sym);
    if (!tfMap) {
      tfMap = new Map();
      this.subs.set(sym, tfMap);
    }
    if (tfMap.size === 0 && !this.tickOffs.has(sym)) {
      if (opts.assetClass === "crypto") {
        this.tickOffs.set(sym, eventBus.on(`tick:${sym}`, (p) => this.feed(p as Tick, "crypto")));
      } else if (opts.assetClass === "forex") {
        const marketOff = eventBus.on(`market-tick:${sym}`, (p) => this.feed(p as Tick, "crypto"));
        this.tickOffs.set(sym, () => {
          marketOff();
        });
      } else {
        const offMarket = marketTickRouter.subscribe(sym);
        const marketOff = eventBus.on(`market-tick:${sym}`, (p) => this.feed(p as Tick, "vn"));
        this.tickOffs.set(sym, () => {
          marketOff();
          offMarket();
        });
      }
    }
    const firstForTf = (tfMap.get(tf) ?? 0) === 0;
    tfMap.set(tf, (tfMap.get(tf) ?? 0) + 1);

    const key = `${sym}|${tf}`;
    let unwantKline: (() => void) | undefined;
    let offKline: (() => void) | undefined;
    if (opts.assetClass === "crypto" && firstForTf && KLINE_INTERVALS.has(tf)) {
      this.klineActive.add(key);
      unwantKline = binanceWs.requestKline(sym, tf);
      offKline = eventBus.on(`kline:${sym}:${tf}`, (p) => {
        const payload = p as { candle: KlineCandle };
        this.applyKline(sym, tf, payload.candle);
      });
    }

    return () => {
      const n = (tfMap!.get(tf) ?? 1) - 1;
      if (n <= 0) {
        tfMap!.delete(tf);
        this.klineActive.delete(key);
        unwantKline?.();
        offKline?.();
      } else {
        tfMap!.set(tf, n);
      }
      if (tfMap!.size === 0) {
        this.subs.delete(sym);
        this.tickOffs.get(sym)?.();
        this.tickOffs.delete(sym);
        this.lastValidated.delete(sym);
      }
    };
  }

  snapshot(symbol: string, tf: string): ChartCandle | null {
    const bar = this.bars.get(`${symbol.toUpperCase()}|${tf}`);
    return bar ? toCandle(bar) : null;
  }

  seed(symbol: string, tf: string, candle: ChartCandle, source: Tick["source"] = "vndirect"): void {
    const sym = symbol.toUpperCase();
    const key = `${sym}|${tf}`;
    if (this.klineActive.has(key)) return;
    this.bars.set(key, {
      bucket: candle.time,
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume ?? 0,
      firstCum: 0,
      lastCum: candle.volume ?? 0,
      updates: 1,
      lastEmit: 0,
      source,
      degraded: source !== "vndirect" && source !== "biquote" && source !== "binance",
    });
  }

  private applyKline(sym: string, tf: string, k: KlineCandle) {
    const key = `${sym}|${tf}`;
    const tfMs = TF_MS[tf];
    if (!tfMs) return;
    const bucket = Math.floor(k.time / tfMs) * tfMs;
    let bar = this.bars.get(key);
    if (!bar || bar.bucket !== bucket) {
      if (bar && bar.bucket < bucket) {
        eventBus.emit(`candle.closed:${sym}:${tf}`, {
          symbol: sym,
          timeframe: tf,
          candle: toCandle(bar),
          quality: "VALID",
          source: bar.source,
          degraded: bar.degraded,
        });
      }
      bar = {
        bucket,
        time: bucket,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        firstCum: 0,
        lastCum: 0,
        updates: 1,
        lastEmit: 0,
        source: "binance",
        degraded: false,
      };
    } else {
      bar.high = Math.max(bar.high, k.high);
      bar.low = Math.min(bar.low, k.low);
      bar.close = k.close;
      bar.volume = k.volume;
      bar.updates++;
    }
    this.bars.set(key, bar);

    if (k.closed) {
      eventBus.emit(`candle.closed:${sym}:${tf}`, {
        symbol: sym,
        timeframe: tf,
        candle: toCandle(bar),
        quality: "VALID",
        source: bar.source,
        degraded: bar.degraded,
      });
      this.bars.delete(key);
      return;
    }

    const now = Date.now();
    if (now - bar.lastEmit >= EMIT_THROTTLE_MS) {
      bar.lastEmit = now;
      eventBus.emit(`candle.updated:${sym}:${tf}`, {
        symbol: sym,
        timeframe: tf,
        candle: toCandle(bar),
        quality: "VALID",
        source: bar.source,
        degraded: bar.degraded,
      });
    }
  }

  feed(tick: Tick, assetClass: "crypto" | "vn" = "crypto") {
    const sym = tick.symbol.toUpperCase();
    const tfMap = this.subs.get(sym);
    if (!tfMap || tfMap.size === 0) return;

    const now = Date.now();
    let quality = "VALID";
    const lastV = this.lastValidated.get(sym);
    if (!lastV || now - lastV.at > VALIDATE_THROTTLE_MS) {
      const v = validateQuote(
        { symbol: sym, price: tick.price, ts: tick.ts },
        { assetClass: assetClass === "vn" ? "stock" : "crypto", staleMs: 5 * 60_000, sourceTimestampMs: tick.ts },
      );
      quality = v.status;
      this.lastValidated.set(sym, { at: now, status: quality });
      if (quality === "INVALID" || quality === "SUSPECT") {
        logQualityEvent({ symbol: sym, status: quality, source: tick.source ?? "tick" });
      }
    } else {
      quality = lastV.status;
    }

    for (const tf of tfMap.keys()) this.feedTf(tick, tf, quality, assetClass);
  }

  private feedTf(tick: Tick, tf: string, quality: string, assetClass: "crypto" | "vn") {
    const tfMs = TF_MS[tf];
    if (!tfMs && !(assetClass === "vn" && tf === "1d")) return;
    const sym = tick.symbol.toUpperCase();
    const key = `${sym}|${tf}`;
    if (this.klineActive.has(key)) return;

    let bar = this.bars.get(key);
    let bucket = bucketFor(tick.ts, tf, assetClass);
    if (assetClass === "vn" && (tf === "1w" || tf === "1M") && bar) {
      bucket = bar.bucket;
    }

    if (!bar || bar.bucket !== bucket) {
      if (bar && bar.bucket < bucket) {
        eventBus.emit(`candle.closed:${sym}:${tf}`, {
          symbol: sym,
          timeframe: tf,
          candle: toCandle(bar),
          quality,
          source: bar.source,
          degraded: bar.degraded,
        });
      }
      bar = {
        bucket,
        time: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
        firstCum: tick.cumVolume,
        lastCum: tick.cumVolume,
        updates: 1,
        lastEmit: 0,
        source: tick.source,
        degraded: tick.degraded ?? assetClass === "vn",
      };
    } else {
      bar.high = Math.max(bar.high, tick.price);
      bar.low = Math.min(bar.low, tick.price);
      bar.close = tick.price;
      bar.lastCum = tick.cumVolume;
      bar.volume = Math.max(0, bar.lastCum - bar.firstCum);
      bar.updates++;
      bar.source = tick.source;
      bar.degraded = tick.degraded ?? assetClass === "vn";
    }
    this.bars.set(key, bar);

    const now = Date.now();
    if (now - bar.lastEmit >= EMIT_THROTTLE_MS) {
      bar.lastEmit = now;
      eventBus.emit(`candle.updated:${sym}:${tf}`, {
        symbol: sym,
        timeframe: tf,
        candle: toCandle(bar),
        quality,
        source: bar.source,
        degraded: bar.degraded,
      });
    }
  }
}

export const candleAggregator = new CandleAggregator();
