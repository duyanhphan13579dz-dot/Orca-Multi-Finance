import "server-only";
import { eventBus } from "../events";
import { TF_MS, type ChartCandle } from "../chart-const";
import { validateQuote, logQualityEvent } from "../quality";
import { CHANNEL } from "./channels";
import { emitEvent, payloadOf } from "./event-envelope";
import { binanceWs, KLINE_INTERVALS, type KlineCandle } from "./binance-ws";

/**
 * CANDLE AGGREGATION ENGINE — builds live current-candles for any
 * (symbol, timeframe) from the centralized tick feed (Binance WS when live,
 * REST overlay as degraded-but-honest fallback).
 *
 * Bucket roll → emit candle.closed → rotate. Every tick validated; volume is
 * derived from provider cumulative counters (guarded). Subscription
 * deduplication: one feed regardless of viewer count (§12).
 */

export interface Tick {
  symbol: string;
  price: number;
  cumVolume: number; // provider cumulative counter (e.g. 24h rolling) — used as delta source
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

interface Key {
  symbol: string;
  tf: string;
}

const EMIT_THROTTLE_MS = 900;

class CandleAggregator {
  private subs = new Map<string, Map<string, number>>(); // symbol → tf → refs
  private bars = new Map<string, LiveBar>(); // `${symbol}|${tf}`
  private tickOffs = new Map<string, () => void>(); // symbol → bus unwire
  private klineActive = new Set<string>(); // `${symbol}|${tf}` with live kline stream

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
    if ((tfMap.size ?? 0) === 0 && !this.tickOffs.has(sym)) {
      // wire the central tick feed for this symbol (centralized, deduped)
      this.tickOffs.set(sym, eventBus.on(CHANNEL.tick(sym), (p) => this.feed(payloadOf<Tick>(p))));
    }
    const firstForTf = (tfMap.get(tf) ?? 0) === 0;
    tfMap.set(tf, (tfMap.get(tf) ?? 0) + 1);

    // DIRECT BINANCE KLINE WS — one centralized stream per (symbol, tf),
    // refcounted across viewers; REST/tick aggregation remains the fallback.
    let unwantKline: (() => void) | null = null;
    let offKline: (() => void) | null = null;
    const key = `${sym}|${tf}`;
    if (opts?.crypto && firstForTf && KLINE_INTERVALS.has(tf)) {
      unwantKline = binanceWs.requestKline(sym, tf);
      offKline = eventBus.on(CHANNEL.kline(sym, tf), (p) => {
        const payload = payloadOf<{ candle: KlineCandle }>(p);
        const c = payload.candle;
        this.klineActive.add(key);
        const bar: LiveBar = {
          bucket: c.time,
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          firstCum: 0,
          lastCum: c.volume,
          updates: 1,
          lastEmit: Date.now(),
        };
        this.bars.set(key, bar);
        const out = toCandle(bar);
        const klinePayload = { symbol: sym, timeframe: tf, candle: out, quality: "VALID", transport: "binance-ws:kline" };
        emitEvent(CHANNEL.candleUpdated(sym, tf), "candle.updated", klinePayload, { assetType: "crypto", symbol: sym });
        if (c.closed) emitEvent(CHANNEL.candleClosed(sym, tf), "candle.closed", klinePayload, { assetType: "crypto", symbol: sym });
      });
    }

    return () => {
      unwantKline?.();
      offKline?.();
      this.klineActive.delete(key);
      const m = this.subs.get(sym);
      if (!m) return;
      const n = (m.get(tf) ?? 0) - 1;
      if (n <= 0) {
        m.delete(tf);
        this.bars.delete(key);
      } else m.set(tf, n);
      if (m.size === 0) {
        this.subs.delete(sym);
        this.tickOffs.get(sym)?.();
        this.tickOffs.delete(sym);
      }
    };
  }

  activeKeys(): Key[] {
    const out: Key[] = [];
    for (const [symbol, m] of this.subs) for (const tf of m.keys()) out.push({ symbol, tf });
    return out;
  }

  snapshot(symbol: string, tf: string): ChartCandle | null {
    const b = this.bars.get(`${symbol.toUpperCase()}|${tf}`);
    return b ? toCandle(b) : null;
  }

  feed(tick: Tick) {
    const tfMap = this.subs.get(tick.symbol.toUpperCase());
    if (!tfMap || tfMap.size === 0) return; // lazy subscription — no CPU waste

    // validate tick through Data Quality Engine
    const q = validateQuote(
      { price: tick.price, open: null, high: null, low: null, volume: 0, changePercent: null, updatedAt: new Date(tick.ts).toISOString() },
      { assetClass: "crypto", staleMs: 5 * 60_000, sourceTimestampMs: tick.ts },
    );
    if (q.status === "INVALID") {
      void logQualityEvent("chart-engine", `tick:${tick.symbol}`, q);
      return;
    }

    for (const tf of tfMap.keys()) this.feedTf(tick, tf, q.status);
  }

  private feedTf(tick: Tick, tf: string, quality: string) {
    const tfMs = TF_MS[tf];
    if (!tfMs) return;
    const sym = tick.symbol.toUpperCase();
    const key = `${sym}|${tf}`;
    // kline WS is authoritative when active — avoid duplicate/divergent bars
    if (this.klineActive.has(key)) return;
    const bucket = Math.floor(tick.ts / tfMs) * tfMs;
    let bar = this.bars.get(key);

    if (!bar || bar.bucket !== bucket) {
      // close previous bar
      if (bar) {
        const closed = toCandle(bar);
        closed.volume = Math.max(0, bar.lastCum - bar.firstCum);
        emitEvent(CHANNEL.candleClosed(sym, tf), "candle.closed", { symbol: sym, timeframe: tf, candle: closed, quality: bar.firstCum >= 0 ? quality : "SUSPECT" }, { assetType: "crypto", symbol: sym });
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
      emitEvent(CHANNEL.candleUpdated(sym, tf), "candle.updated", { symbol: sym, timeframe: tf, candle: toCandle(bar), quality }, { assetType: "crypto", symbol: sym });
    }
  }

  stats() {
    return { symbols: this.subs.size, bars: this.bars.size };
  }
}

const toCandle = (b: LiveBar): ChartCandle => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

const g = globalThis as typeof globalThis & { __orcaCandleAgg?: CandleAggregator };
export const candleAggregator = g.__orcaCandleAgg ?? new CandleAggregator();
g.__orcaCandleAgg = candleAggregator;
