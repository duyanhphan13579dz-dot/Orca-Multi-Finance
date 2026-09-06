import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooSymbolForPair, yahooIntervalFor } from "../providers/yahoo";
import { getVnOhlcv, vndirectConfigured } from "./stocks";
import { marketStore } from "../realtime/market-store";
import { validateBars, detectGaps, logQualityEvent } from "../quality";
import { aggregateCandles, binanceInterval, TF_MS, tfsFor, type ChartAssetType, type ChartCandle } from "../chart-const";
import { ema, rsi, macd, sma, supportResistance } from "../technical";
import { analyzeScalp } from "../engines/scalp";
import type { Meta, OhlcvBar, TechnicalSnapshot } from "../types";

/**
 * CHART DATA ENGINE — one normalized pipeline for every asset class:
 * provider → validation → quality → normalization (ChartCandle) →
 * indicator bundle → meta. Frontend only consumes this service.
 */

export interface IndicatorPoint {
  time: number;
  value?: number;
}

export interface ChartIndicators {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  bollinger: { upper: IndicatorPoint[]; mid: IndicatorPoint[]; lower: IndicatorPoint[] } | null;
  vwap: IndicatorPoint[] | null;
  rsi: IndicatorPoint[];
  macd: { macd: IndicatorPoint[]; signal: IndicatorPoint[]; histogram: IndicatorPoint[] } | null;
  srLevels: { support: number[]; resistance: number[] };
}

export interface ChartSignalMarker {
  time: number;
  type: "buy-signal" | "sell-signal" | "volume-spike" | "rsi-extreme" | "breakout" | "breakdown";
  position: "aboveBar" | "belowBar" | "inBar";
  title: string;
}

export interface ChartMarketData {
  candles: ChartCandle[];
  indicators: ChartIndicators | null;
  markers: ChartSignalMarker[];
  intervalMs: number;
  gaps: number;
  suspect: number;
}

/** deterministic markers — volume spikes, RSI extreme closes, scalp signal */
export function computeMarkers(candles: ChartCandle[]): ChartSignalMarker[] {
  if (candles.length < 40) return [];
  const out: ChartSignalMarker[] = [];
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume ?? 0);
  const med = [...vols].filter((v) => v > 0).sort((a, b) => a - b);
  const median = med.length ? med[Math.floor(med.length / 2)] : 0;
  const rsiArr = rsi(closes, 14);
  const scan = candles.slice(-160);
  for (let i = candles.length - scan.length; i < candles.length; i++) {
    if (median > 0 && vols[i] >= median * 2.2) {
      out.push({ time: candles[i].time, type: "volume-spike", position: "inBar", title: `Vol x${(vols[i] / median).toFixed(1)}` });
    }
    const r = rsiArr[i];
    const rPrev = rsiArr[i - 1];
    if (r != null && rPrev != null) {
      if (r >= 70 && rPrev < 70) out.push({ time: candles[i].time, type: "rsi-extreme", position: "aboveBar", title: `RSI ${r.toFixed(0)}` });
      if (r <= 30 && rPrev > 30) out.push({ time: candles[i].time, type: "rsi-extreme", position: "belowBar", title: `RSI ${r.toFixed(0)}` });
    }
  }
  // scalp engine signal marker at latest candle (structured, validated)
  const scalp = analyzeScalp(candles as OhlcvBar[], { timeframe: "chart" });
  if (scalp && scalp.direction !== "neutral" && scalp.strength >= 50) {
    const lastCandle = candles[candles.length - 1];
    out.push({
      time: lastCandle.time,
      type: scalp.direction === "watch-long" ? "buy-signal" : "sell-signal",
      position: scalp.direction === "watch-long" ? "belowBar" : "aboveBar",
      title: `${scalp.direction === "watch-long" ? "Watch Long" : "Watch Short"} ${scalp.strength}`,
    });
  }
  return out.sort((a, b) => a.time - b.time).slice(-50);
}

export interface ChartArgs {
  symbol: string;
  assetType: ChartAssetType;
  timeframe: string;
  limit?: number;
}

function toCandle(b: OhlcvBar): ChartCandle {
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}

function points(times: number[], values: (number | null)[]): IndicatorPoint[] {
  const step = values.length > 600 ? Math.ceil(values.length / 600) : 1;
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ time: times[i], value: v });
  }
  return step > 1 ? out.filter((_, i) => i % step === 0) : out;
}

function bollingerSeries(closes: number[], times: number[], period = 20, mult = 2) {
  const smaArr = sma(closes, period);
  const upper: IndicatorPoint[] = [];
  const mid: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const m = smaArr[i];
    if (m == null) continue;
    let sd = 0;
    for (let j = i - period + 1; j <= i; j++) sd += (closes[j] - m) ** 2;
    sd = Math.sqrt(sd / period);
    upper.push({ time: times[i], value: m + mult * sd });
    mid.push({ time: times[i], value: m });
    lower.push({ time: times[i], value: m - mult * sd });
  }
  return { upper, mid, lower };
}

function vwapSeries(bars: ChartCandle[]): IndicatorPoint[] | null {
  if (!bars.some((b) => (b.volume ?? 0) > 0)) return null;
  let pv = 0;
  let vv = 0;
  let dayStart = new Date(bars[0].time).getUTCDate();
  const out: IndicatorPoint[] = [];
  for (const b of bars) {
    const d = new Date(b.time).getUTCDate();
    if (d !== dayStart) {
      pv = 0;
      vv = 0;
      dayStart = d;
    }
    const v = b.volume ?? 0;
    if (v > 0) {
      pv += ((b.high + b.low + b.close) / 3) * v;
      vv += v;
    }
    if (vv > 0) out.push({ time: b.time, value: pv / vv });
  }
  return out;
}

export function computeIndicators(candles: ChartCandle[]): ChartIndicators | null {
  if (candles.length < 30) return null;
  const closes = candles.map((c) => c.close);
  const times = candles.map((c) => c.time);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const rsiArr = rsi(closes, 14);
  const m = macd(closes);
  const ohlcv: OhlcvBar[] = candles.map((c) => ({ ...c, volume: c.volume ?? 0 }));
  const sr = supportResistance(ohlcv, Math.min(120, candles.length));
  return {
    ema20: points(times, e20),
    ema50: points(times, e50),
    bollinger: candles.length >= 25 ? bollingerSeries(closes, times) : null,
    vwap: vwapSeries(candles),
    rsi: points(times, rsiArr),
    macd: m
      ? {
          macd: points(times, m.line),
          signal: points(times, m.signal),
          histogram: points(
            times,
            m.line.map((v, i) => (v != null && m.signal[i] != null ? (v as number) - (m.signal[i] as number) : null)),
          ),
        }
      : null,
    srLevels: sr,
  };
}

/* ------------------------------ history core ------------------------------- */

async function cryptoCandles(symbol: string, tf: string, limit: number): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  const bars = await binance.getKlines(symbol, binanceInterval(tf), Math.min(limit, 1000));
  return { candles: bars.map(toCandle), source: "binance" };
}

async function forexCandles(pair: string, tf: string, limit: number): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  // PRIMARY: Biquote lacks historical OHLC in this environment → approved public provider
  const cfg = yahooIntervalFor(tf);
  if (!cfg) throw new Error("unsupported forex timeframe");
  const y = await getYahooChart(yahooSymbolForPair(pair), cfg.interval, cfg.range);
  let candles = y.candles;
  if (cfg.aggregate4h) candles = aggregateCandles(candles, TF_MS["4h"]);
  return {
    candles: candles.slice(-limit),
    source: "yahoo-fx (public candles)",
    note: "Biquote chưa cấu hình — historical candles từ public data provider được phê duyệt; giá realtime vẫn qua forex engine",
  };
}

async function stockCandles(symbol: string, tf: string, limit: number): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  if (!vndirectConfigured()) throw new Error("vndirect_not_configured");
  const r = await getVnOhlcv(symbol, tf === "1d" ? Math.min(limit, 250) : Math.min(limit * 7, 500));
  if (!r) throw new Error("vndirect_unavailable");
  let candles = r.bars.map(toCandle);
  if (tf === "1w") candles = aggregateCandles(candles, TF_MS["1w"]).slice(-limit);
  if (tf === "1M") candles = aggregateCandles(candles, TF_MS["1M"]).slice(-limit);
  return { candles: candles.slice(-limit), source: r.meta.source, note: r.meta.note };
}

async function commodityCandles(_symbol: string, _tf: string, _limit: number): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  // Nguồn DUY NHẤT = data.vietnambiz.vn/goods (WiFeed) — không công bố OHLC lịch sử;
  // tuyệt đối không vẽ chart từ Yahoo/Binance/nguồn ngoài.
  throw new Error("commodity_history_unavailable");
}

/** Metals (XAU/XAG/XPT/XPD): OHLC thật từ Yahoo public (spot ưu tiên → futures failover). */
async function metalCandles(symbol: string, tf: string, limit: number): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  const { metalDef } = await import("./metals");
  const def = metalDef(symbol);
  if (!def) throw new Error("unknown metal symbol");
  const cfg = yahooIntervalFor(tf);
  if (!cfg) throw new Error("unsupported metal timeframe");
  let lastErr = "unreachable";
  for (const y of def.yahooSymbols) {
    try {
      const res = await getYahooChart(y, cfg.interval, cfg.range);
      let candles = res.candles;
      if (cfg.aggregate4h) candles = aggregateCandles(candles, TF_MS["4h"]);
      if (candles.length) {
        return {
          candles: candles.slice(-limit),
          source: `yahoo-fx (${y})`,
          note: `OHLC thật từ Yahoo Finance public (${y}); 4h = aggregate từ 1h — không nội suy.`,
        };
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "unreachable";
    }
  }
  throw new Error(`metal history unavailable (${lastErr})`);
}

/** How long a stored candle series is considered fresh (providers not re-called). */
function chartFreshMs(assetType: ChartAssetType, tf: string): number {
  return assetType === "crypto" ? 18_000 : assetType === "forex" || assetType === "metal" ? 45_000 : 60_000;
}

export async function getChartHistory(args: ChartArgs): Promise<{ data: ChartMarketData; meta: Meta } | null> {
  const symbol = args.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tf = args.timeframe;
  const limit = Math.min(Math.max(args.limit ?? 300, 50), 1000);
  if (!tfsFor(args.assetType).includes(tf)) return null;

  try {
    const ttlMs = chartFreshMs(args.assetType, tf);
    // Phase 6 §7 — REALTIME MARKET STORE first: shared across users, no direct
    // provider call when the stored series is fresh (write-through producer below).
    const stored = marketStore.getCandles(args.assetType, symbol, tf);
    if (stored && stored.candles.length >= Math.min(limit, stored.limit) && Date.now() - stored.ingestedAt <= ttlMs) {
      return buildChartResult(stored.candles, stored.source, stored.sourceTimestampMs, stored.gaps, stored.suspect, {
        assetType: args.assetType,
        tf,
        cached: true,
        note: "Dữ liệu từ Realtime Market Store (chung cho mọi user — provider không được gọi lại)",
      });
    }

    const res = await cached(`chart:${args.assetType}:${symbol}:${tf}:${limit}`, {
      ttlMs,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const raw =
          args.assetType === "crypto"
            ? await cryptoCandles(symbol, tf, limit)
            : args.assetType === "forex"
              ? await forexCandles(symbol, tf, limit)
              : args.assetType === "metal"
                ? await metalCandles(symbol, tf, limit)
                : args.assetType === "commodity"
                  ? await commodityCandles(symbol, tf, limit)
                  : await stockCandles(symbol, tf, limit);

        // DATA QUALITY: per-candle validation (§24), sanitize, log anomalies
        const q = validateBars(raw.candles as OhlcvBar[]);
        if (q.status !== "VALID") void logQualityEvent("chart-engine", `${args.assetType}:${symbol}:${tf}`, q);
        if (q.status === "INVALID") throw new Error("invalid candle series");
        const gap = detectGaps(q.cleaned, TF_MS[tf]);
        const suspect = (q.status === "SUSPECT" ? 1 : 0) + (gap ? 1 : 0);
        return {
          candles: q.cleaned,
          source: raw.source,
          note: raw.note,
          gaps: gap ? Number(gap.value ?? 0) : 0,
          suspect,
        };
      },
    });

    const { candles, source, note, gaps, suspect } = res.value;
    // Phase 6 §7 — write-through: next users read from the store, no provider call.
    marketStore.setCandles({
      assetType: args.assetType,
      symbol,
      timeframe: tf,
      intervalMs: TF_MS[tf],
      limit,
      candles,
      source,
      sourceTimestampMs: candles[candles.length - 1]?.time ?? Date.now(),
      gaps,
      suspect,
    });
    return buildChartResult(candles, source, candles[candles.length - 1]?.time ?? Date.now(), gaps, suspect, {
      assetType: args.assetType,
      tf,
      cached: res.cached,
      stale: res.stale,
      note,
    });
  } catch {
    return null;
  }
}

/** Build the normalized ChartMarketData + freshness meta from a candle series. */
function buildChartResult(
  candles: ChartCandle[],
  source: string,
  sourceTimestampMs: number | null,
  gaps: number,
  suspect: number,
  opts: { assetType: ChartAssetType; tf: string; cached?: boolean; stale?: boolean; note?: string },
): { data: ChartMarketData; meta: Meta } {
  const last = candles[candles.length - 1];
  const meta = buildMeta({
    source,
    sourceTimestampMs: sourceTimestampMs ?? last?.time ?? Date.now(),
    cached: opts.cached,
    stale: opts.stale,
    note: [opts.note, gaps ? `${gaps} khoảng trống dữ liệu trong chuỗi` : null, suspect ? `quality: SUSPECT flags đã log` : null]
      .filter(Boolean)
      .join(" · ") || undefined,
    slas:
      opts.assetType === "crypto"
        ? { liveSlaMs: TF_MS[opts.tf] * 1.5, freshSlaMs: TF_MS[opts.tf] * 4, delayedSlaMs: TF_MS[opts.tf] * 20 }
        : { liveSlaMs: TF_MS[opts.tf] * 2, freshSlaMs: TF_MS[opts.tf] * 6, delayedSlaMs: TF_MS[opts.tf] * 48 },
  });
  meta.qualityStatus = suspect ? "SUSPECT" : "VALID";
  return {
    data: {
      candles,
      indicators: computeIndicators(candles),
      markers: computeMarkers(candles),
      intervalMs: TF_MS[opts.tf],
      gaps,
      suspect,
    },
    meta,
  };
}

/* technical snapshot reuse for overlays elsewhere */
export type { TechnicalSnapshot };
