import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooSymbolForPair, yahooIntervalFor } from "../providers/yahoo";
import { getVnOhlcv, vnstockConfigured } from "./stocks";
import * as vndirect from "../providers/vndirect";
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

/** deterministic markers — scalp only (yellow Vol xN / purple RSI dots removed). */
export function computeMarkers(candles: ChartCandle[]): ChartSignalMarker[] {
  if (candles.length < 40) return [];
  const out: ChartSignalMarker[] = [];
  // Vol spike + RSI extreme markers intentionally not drawn on the price pane.
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
  const step = values.length > 1200 ? Math.ceil(values.length / 1200) : 1;
  const out: IndicatorPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    if (i % step !== 0 && i !== times.length - 1) continue;
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ time: times[i], value: v });
  }
  return out;
}

function bollingerSeries(closes: number[], times: number[], period = 20, mult = 2) {
  const midArr = sma(closes, period);
  const upper: IndicatorPoint[] = [];
  const mid: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const mean = midArr[i];
    if (mean == null) continue;
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    mid.push({ time: times[i], value: mean });
    upper.push({ time: times[i], value: mean + mult * std });
    lower.push({ time: times[i], value: mean - mult * std });
  }
  return { upper, mid, lower };
}

function vwapSeries(bars: ChartCandle[]): IndicatorPoint[] | null {
  const out: IndicatorPoint[] = [];
  let cumPv = 0;
  let cumV = 0;
  for (const c of bars) {
    const typ = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    if (v > 0) {
      cumPv += typ * v;
      cumV += v;
    }
    if (cumV > 0) out.push({ time: c.time, value: cumPv / cumV });
  }
  return out.length ? out : null;
}

export function computeIndicators(candles: ChartCandle[]): ChartIndicators | null {
  if (candles.length < 30) return null;
  const times = candles.map((c) => c.time);
  const closes = candles.map((c) => c.close);
  const ema20 = points(times, ema(closes, 20));
  const ema50 = points(times, ema(closes, 50));
  const bb = bollingerSeries(closes, times, 20, 2);
  const vwap = vwapSeries(candles);
  const rsiArr = points(times, rsi(closes, 14));
  const m = macd(closes);
  const macdPts = {
    macd: points(times, m.macd),
    signal: points(times, m.signal),
    histogram: points(times, m.histogram),
  };
  const sr = supportResistance(candles as OhlcvBar[]);
  return {
    ema20,
    ema50,
    bollinger: bb.upper.length ? bb : null,
    vwap,
    rsi: rsiArr,
    macd: macdPts.macd.length ? macdPts : null,
    srLevels: {
      support: sr.support != null ? [sr.support] : [],
      resistance: sr.resistance != null ? [sr.resistance] : [],
    },
  };
}

async function cryptoCandles(
  symbol: string,
  tf: string,
  limit: number,
): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  const interval = binanceInterval(tf);
  const bars = await binance.getKlines(symbol, interval, limit);
  return { candles: bars.map(toCandle), source: "binance" };
}

async function forexCandles(
  pair: string,
  tf: string,
  limit: number,
): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  const ySym = yahooSymbolForPair(pair);
  if (!ySym) throw new Error(`unsupported forex pair ${pair}`);
  const interval = yahooIntervalFor(tf);
  const bars = await getYahooChart(ySym, interval, limit);
  return { candles: bars.map(toCandle), source: "yahoo" };
}

async function stockCandles(
  symbol: string,
  tf: string,
  limit: number,
): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  const dayLimit = Math.max(limit, 250);
  if (vndirect.isVnIndexSymbol(symbol)) {
    const bars = await vndirect.getVndIndexOhlcv(symbol, dayLimit);
    const candles = bars.map(toCandle);
    return {
      candles: candles.slice(-limit),
      source: "vndirect-index",
      note: "Chuỗi chỉ số VN (OHLCV ngày)",
    };
  }
  const r = await getVnOhlcv(symbol, dayLimit);
  if (!r?.bars?.length) throw new Error(`no stock bars for ${symbol}`);
  let candles = r.bars.map(toCandle);
  const ms = TF_MS[tf] ?? TF_MS["1d"];
  if (ms && ms > TF_MS["1d"]) {
    candles = aggregateCandles(candles, ms);
  }
  return { candles: candles.slice(-limit), source: (r as { meta?: { source?: string } }).meta?.source ?? "ssi-fcdata" };
}

function yahooCommoditySymbol(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9=\-._]/g, "");
  const map: Record<string, string> = {
    GOLD: "GC=F",
    XAU: "GC=F",
    XAUUSD: "GC=F",
    SILVER: "SI=F",
    XAG: "SI=F",
    XAGUSD: "SI=F",
    OIL: "CL=F",
    WTI: "CL=F",
    BRENT: "BZ=F",
    NATGAS: "NG=F",
    COPPER: "HG=F",
    PLATINUM: "PL=F",
  };
  if (map[s]) return map[s];
  if (s.includes("=")) return s;
  return null;
}

export function isChartableCommodity(symbol: string): boolean {
  return yahooCommoditySymbol(symbol) != null;
}

async function commodityCandles(
  symbol: string,
  tf: string,
  limit: number,
): Promise<{ candles: ChartCandle[]; source: string; note?: string }> {
  const ySym = yahooCommoditySymbol(symbol);
  if (!ySym) throw new Error(`unsupported commodity ${symbol}`);
  const interval = yahooIntervalFor(tf);
  const bars = await getYahooChart(ySym, interval, limit);
  return { candles: bars.map(toCandle), source: "yahoo" };
}

export async function getChartHistory(
  args: ChartArgs,
): Promise<{ data: ChartMarketData; meta: Meta } | null> {
  const limit = Math.min(Math.max(args.limit ?? 300, 50), 2000);
  const tf = args.timeframe || "1d";
  let pack: { candles: ChartCandle[]; source: string; note?: string };
  try {
    if (args.assetType === "crypto") pack = await cryptoCandles(args.symbol, tf, limit);
    else if (args.assetType === "stock") pack = await stockCandles(args.symbol, tf, limit);
    else if (args.assetType === "forex") pack = await forexCandles(args.symbol, tf, limit);
    else pack = await commodityCandles(args.symbol, tf, limit);
  } catch {
    return null;
  }
  if (!pack.candles.length) return null;

  const q = validateBars(pack.candles as unknown as OhlcvBar[]);
  const candles = (q.cleaned as OhlcvBar[]).map(toCandle);
  if (q.status !== "VALID") void logQualityEvent(pack.source, `chart:${args.symbol}`, q);

  const intervalMs = TF_MS[tf] ?? 86_400_000;
  const gaps = detectGaps(candles as unknown as OhlcvBar[], intervalMs);

  return {
    data: {
      candles,
      indicators: computeIndicators(candles),
      markers: computeMarkers(candles),
      intervalMs,
      gaps,
      suspect: q.status === "VALID" ? 0 : 1,
    },
    meta: buildMeta({
      source: pack.source,
      sourceTimestampMs: candles[candles.length - 1]?.time ?? null,
      note: pack.note,
      slas: { liveSlaMs: 5_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
    }),
  };
}

export type { TechnicalSnapshot };
