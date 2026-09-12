import "server-only";
import { eventBus } from "../events";
import { TF_MS, type ChartCandle } from "../chart-const";
import { validateQuote, logQualityEvent } from "../quality";
import { binanceWs, KLINE_INTERVALS, type KlineCandle } from "./binance-ws";
import { ensureSsiWsStarted } from "./ssi-ws";

/**
 * CANDLE AGGREGATION ENGINE — live current-candles from centralized tick/kline feed.
 * Perf notes:
 *   - validateQuote throttled per symbol (not every tick)
 *   - when kline WS is authoritative for a TF, tick path is skipped for that TF
 *   - emit throttle keeps SSE clients from flooding
 */

export interface Tick {
  symbol: string;
  price: number;
  cumVolume: number;
  cumQuoteVolume: number;
  ts: number;
}

interface LiveBar extends ChartCandle {
  bucket: number;
  firstCum: number;
  lastCum: number;
  updates: number;
  lastEmit: number;
}

const EMIT_THROTTLE_MS = 900;
const VALIDATE_THROTTLE_MS = 2_000;

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

  subscribe(symbol: string, tf: string, opts?: { crypto?: boolean }): () => void {
    const sym = symbol.toUpperCase();
    let tfMap = this.subs.get(sym);
    if (!tfMap) {
      tfMap = new Map();
      this.subs.set(sym, tfMap);
    }
    if (tfMap.size === 0 && !this.tickOffs.has(sym)) {
      if (opts?.crypto) {
        this.tickOffs.set(sym, eventBus.on(`tick:${sym}`, (p) => this.feed(p as Tick, "crypto")));
      } else {
        ensureSsiWsStarted();
        const indexOff = eventBus.on(`ssi:index:${sym}`, (p) => this.feedSsiIndex(p as { code: string; value: number; volume?: number; eventTime: number }));
        const quoteOff = eventBus.on(`ssi:quote:${sym}`, (p) => this.feedSsiQuote(p as { symbol: string; price: number; volume?: number | null; eventTime: number }));
        this.tickOffs.set(sym, () => { indexOff(); quoteOff(); });
      }
    }
    const firstForTf = (tfMap.get(tf) ?? 0) === 0;
    tfMap.set(tf, (tfMap.get(tf) ?? 0) + 1);

    let unwantKline: (() => void) | null = null;
    let offKline: (() => void) | null = null;
    const key = `${sym}|${tf}`;
    if (opts?.crypto && firstForTf && KLINE_INTERVALS.has(tf)) {
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
      });
    }
  }

  feed(tick: Tick, assetClass: "crypto" | "vn" = "crypto") {
    const tfMap = this.subs.get(tick.symbol.toUpperCase());
    if (!tfMap || tfMap.size === 0) return;

    let anyTickTf = false;
    for (const tf of tfMap.keys()) {
      if (!this.klineActive.has(`${tick.symbol.toUpperCase()}|${tf}`)) {
        anyTickTf = true;
        break;
      }
    }
    if (!anyTickTf) return;

    const sym = tick.symbol.toUpperCase();
    const now = Date.now();
    let quality = "VALID";
    const prev = this.lastValidated.get(sym);
    if (!prev || now - prev.at >= VALIDATE_THROTTLE_MS) {
      const q = validateQuote(
        {
          price: tick.price,
          open: null,
          high: null,
          low: null,
          volume: 0,
          changePercent: null,
          updatedAt: new Date(tick.ts).toISOString(),
        },
        { assetClass: assetClass === "vn" ? "stock" : "crypto", staleMs: 5 * 60_000, sourceTimestampMs: tick.ts },
      );
      quality = q.status;
      // Never cache an INVALID verdict: one malformed tick must not black-hole
      // every following (valid) tick for the whole throttle window. Valid ticks
      // are cached so the hot path still skips validation most of the time.
      if (q.status !== "INVALID") this.lastValidated.set(sym, { at: now, status: quality });
      if (q.status === "INVALID") {
        void logQualityEvent("chart-engine", `tick:${tick.symbol}`, q);
        return;
      }
    } else {
      quality = prev.status;
      if (quality === "INVALID") return;
    }

    for (const tf of tfMap.keys()) this.feedTf(tick, tf, quality);
  }

  private feedSsiQuote(quote: { symbol: string; price: number; volume?: number | null; eventTime: number }) {
    if (!Number.isFinite(quote.price) || quote.price <= 0) return;
    this.feed({ symbol: quote.symbol, price: quote.price, cumVolume: quote.volume ?? 0, cumQuoteVolume: 0, ts: quote.eventTime }, "vn");
  }

  private feedSsiIndex(index: { code: string; value: number; volume?: number; eventTime: number }) {
    if (!Number.isFinite(index.value) || index.value <= 0) return;
    this.feed({ symbol: index.code, price: index.value, cumVolume: index.volume ?? 0, cumQuoteVolume: 0, ts: index.eventTime }, "vn");
  }

  private feedTf(tick: Tick, tf: string, quality: string) {
    const tfMs = TF_MS[tf];
    if (!tfMs) return;
    const sym = tick.symbol.toUpperCase();
    const key = `${sym}|${tf}`;
    if (this.klineActive.has(key)) return;
    const bucket = Math.floor(tick.ts / tfMs) * tfMs;
    let bar = this.bars.get(key);

    if (!bar || bar.bucket !== bucket) {
      if (bar) {
        const closed = toCandle(bar);
        closed.volume = Math.max(0, bar.lastCum - bar.firstCum);
        eventBus.emit(`candle.closed:${sym}:${tf}`, {
          symbol: sym,
          timeframe: tf,
          candle: closed,
          quality: bar.firstCum >= 0 ? quality : "SUSPECT",
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
      };
    } else {
      bar.high = Math.max(bar.high, tick.price);
      bar.low = Math.min(bar.low, tick.price);
      bar.close = tick.price;
      bar.lastCum = tick.cumVolume;
      bar.updates++;
    }
    bar.volume = Math.max(0, bar.lastCum - bar.firstCum);
    this.bars.set(key, bar);

    const now = Date.now();
    if (now - bar.lastEmit >= EMIT_THROTTLE_MS) {
      bar.lastEmit = now;
      eventBus.emit(`candle.updated:${sym}:${tf}`, {
        symbol: sym,
        timeframe: tf,
        candle: toCandle(bar),
        quality,
      });
    }
  }

  stats() {
    return { symbols: this.subs.size, bars: this.bars.size, klineActive: this.klineActive.size };
  }
}

const toCandle = (b: LiveBar): ChartCandle => ({
  time: b.time,
  open: b.open,
  high: b.high,
  low: b.low,
  close: b.close,
  volume: b.volume,
});

const g = globalThis as typeof globalThis & { __orcaCandleAgg?: CandleAggregator };
export const candleAggregator = g.__orcaCandleAgg ?? new CandleAggregator();
g.__orcaCandleAgg = candleAggregator;
