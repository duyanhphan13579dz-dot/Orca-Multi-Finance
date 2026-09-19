import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getFrankfurterSeries } from "../providers/forex";
import { getYahooChart, yahooIntervalFor } from "../providers/yahoo";
import { getVnOhlcv } from "./stocks";
import * as vndirect from "../providers/vndirect";
import { validateBars, detectGaps, logQualityEvent } from "../quality";
import { aggregateCandles, binanceInterval, TF_MS, tfsFor, vndDchartResolution, type ChartAssetType, type ChartCandle } from "../chart-const";
import { ema, rsi, macd, sma, supportResistance } from "../technical";
import { analyzeScalp } from "../engines/scalp";
import type { Meta, OhlcvBar, TechnicalSnapshot } from "../types";

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

export function computeMarkers(candles: ChartCandle[]): ChartSignalMarker[] {
  if (candles.length < 40) return [];
  const out: ChartSignalMarker[] = [];
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
  const hist = m.line.map((v, i) =>
    v != null && m.signal[i] != null ? (v as number) - (m.signal[i] as number) : null,
  );
  const macdPts = {
    macd: points(times, m.line),
    signal: points(times, m.signal),
    histogram: points(times, hist),
  };
  const ohlcv: OhlcvBar[] = candles.map((c) => ({ ...c, volume: c.volume ?? 0 }));
  const sr = supportResistance(ohlcv, Math.min(120, candles.length));
  return {
    ema20,
    ema50,
    bollinger: bb.upper.length ? bb : null,
    vwap,
    rsi: rsiArr,
    macd: macdPts.macd.length ? macdPts : null,
    srLevels: sr,
  };
}

type CandleSeriesResult = {
  candles: ChartCandle[];
  source: string;
  note?: string;
};

async function cryptoCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  if (tf === "12M") {
    const bars = await binance.getKlinesDeep(symbol, "1M", Math.min(limit * 12, 500));
    const candles = aggregateCandles(bars.map(toCandle), TF_MS["12M"]).slice(-limit);
    return { candles, source: "binance", note: "12M aggregate từ 1M" };
  }
  const bars = await binance.getKlinesDeep(symbol, binanceInterval(tf), Math.min(limit, 5000));
  return { candles: bars.map(toCandle), source: "binance" };
}

/** Yahoo futures tickers for commodity chart symbols used by the UI. */
function yahooCommoditySymbol(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exact: Record<string, string> = {
    XAUUSD: "GC=F",
    GOLD: "GC=F",
    XAU: "GC=F",
    XAGUSD: "SI=F",
    SILVER: "SI=F",
    XAG: "SI=F",
    OIL: "CL=F",
    WTI: "CL=F",
    CRUDE: "CL=F",
    BRENT: "BZ=F",
    NATGAS: "NG=F",
    NG: "NG=F",
    COPPER: "HG=F",
    PLATINUM: "PL=F",
    PALLADIUM: "PA=F",
    // Softs / ags — frequently first in VN catalog; must resolve or chart stays empty
    COFFEE: "KC=F",
    KC: "KC=F",
    SUGAR: "SB=F",
    CORN: "ZC=F",
    SOYBEAN: "ZS=F",
    SOY: "ZS=F",
    WHEAT: "ZW=F",
    // Iron ore proxy (SGX TSI) — often used when catalog has thép/quặng
    IRON: "TIO=F",
    IRONORE: "TIO=F",
  };
  if (exact[s]) return exact[s];
  if (s.endsWith("=F") || s.includes("=")) return symbol.toUpperCase();
  return null;
}

export function isChartableCommodity(symbol: string): boolean {
  if (symbol === "XAUUSD" || symbol === "GOLD" || symbol === "XAU") return true;
  return yahooCommoditySymbol(symbol) != null;
}

/** Map EURUSD / USDJPY → Yahoo FX symbol */
function yahooForexSymbol(pair: string): string {
  const s = pair.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length >= 6) return `${s.slice(0, 3)}${s.slice(3, 6)}=X`;
  return `${s}=X`;
}

/**
 * Forex chart:
 * - Kim loại/năng lượng (XAUUSD…) → Yahoo futures GC=F
 * - Cặp tiền → Yahoo FX → Frankfurter ECB
 */
async function forexCandles(pair: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const norm = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (
    yahooCommoditySymbol(norm) ||
    norm === "XAUUSD" ||
    norm === "XAGUSD" ||
    norm.startsWith("XAU") ||
    norm.startsWith("XAG")
  ) {
    const sym = norm.startsWith("XAU") && !norm.startsWith("XAG") ? "XAUUSD" : norm;
    return commodityCandles(sym, tf, limit);
  }

  const base = norm.slice(0, 3);
  const quote = norm.slice(3, 6);
  const ySym = yahooForexSymbol(norm);

  try {
    const cfg =
      yahooIntervalFor(
        tf === "12M" ? "1M" : tf === "1w" ? "1w" : tf === "1M" ? "1M" : tf === "4h" ? "4h" : tf,
      ) ?? (tf === "1d" ? { interval: "1d", range: "max" } : null);

    if (cfg) {
      const y = await getYahooChart(ySym, cfg.interval, cfg.range);
      let candles = y.candles;
      if (cfg.aggregate4h || tf === "4h") candles = aggregateCandles(candles, TF_MS["4h"]);
      if (tf === "12M") candles = aggregateCandles(candles, TF_MS["12M"]);
      if (candles.length >= 5) {
        return {
          candles: candles.slice(-limit),
          source: `yahoo-finance (${ySym})`,
          note: `FX OHLC Yahoo · ${tf} · ${Math.min(candles.length, limit)} nến`,
        };
      }
    }
  } catch {
    /* fall through */
  }

  const days =
    tf === "12M" ? 4000 : tf === "1M" ? 3650 : tf === "1w" ? 1825 : tf === "1d" ? 1200 : 730;
  try {
    const direct = await getFrankfurterSeries(base, quote, days);
    let candles: ChartCandle[] = direct.map((x) => ({
      time: Date.parse(`${x.date}T00:00:00Z`),
      open: x.rate,
      high: x.rate,
      low: x.rate,
      close: x.rate,
      volume: 0,
    }));
    if (tf === "1w") candles = aggregateCandles(candles, TF_MS["1w"]);
    else if (tf === "1M") candles = aggregateCandles(candles, TF_MS["1M"]);
    else if (tf === "12M") candles = aggregateCandles(candles, TF_MS["12M"]);
    else if (["5m", "15m", "30m", "1h", "4h"].includes(tf)) {
      return {
        candles: candles.slice(-limit),
        source: "frankfurter-ecb",
        note: `ECB daily fallback (khong co ${tf} intraday)`,
      };
    }
    return {
      candles: candles.slice(-limit),
      source: "frankfurter-ecb",
      note: "Ty gia tham chieu ECB/Frankfurter (fallback)",
    };
  } catch (e) {
    throw new Error(`forex_chart_unavailable: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

export function canonicalIndexSymbol(symbol: string): string | null {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const aliases: Record<string, string> = {
    VNINDEX: "VNINDEX",
    VN: "VNINDEX",
    VNINDEXV: "VNINDEX",
    VN30: "VN30",
    VN100: "VN100",
    HNX: "HNXINDEX",
    HNXINDEX: "HNXINDEX",
    HNX30: "HNX30",
    UPCOM: "UPCOMINDEX",
    UPCOMINDEX: "UPCOMINDEX",
  };
  return aliases[normalized] ?? null;
}

const INDEX_LIMITS: Record<string, { min: number; max: number }> = {
  VNINDEX: { min: 0, max: 2_000 },
  VN30: { min: 0, max: 3_000 },
  HNXINDEX: { min: 0, max: 1_000 },
  HNX30: { min: 0, max: 2_000 },
  UPCOMINDEX: { min: 0, max: 2_000 },
};

export function validateIndexCandles(symbol: string, candles: ChartCandle[]) {
  const code = canonicalIndexSymbol(symbol);
  if (!code) return { valid: candles, rejected: 0 };
  const bounds = INDEX_LIMITS[code];
  const valid = candles.filter((c) =>
    [c.open, c.high, c.low, c.close].every(
      (v) => Number.isFinite(v) && v >= bounds.min && v <= bounds.max && c.high >= c.low,
    ),
  );
  return {
    valid,
    rejected: candles.length - valid.length,
    reason: valid.length !== candles.length ? `${code}: candle ngoai bien` : undefined,
  };
}

async function stockCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const { fetchVndDchartHistory } = await import("../providers/vndirect-dchart");

  const native = vndDchartResolution(tf);
  if (native) {
    try {
      const fetchN =
        native === "D"
          ? Math.min(limit, 2_000)
          : native === "60"
            ? Math.min(limit, 1_500)
            : Math.min(limit, 1_200);
      const bars = await fetchVndDchartHistory(symbol, native, fetchN);
      if (bars.length >= 1) {
        return {
          candles: bars.map(toCandle).slice(-limit),
          source: "vndirect-dchart",
          note: `VNDirect dchart ${tf} · ${Math.min(bars.length, limit)} nen`,
        };
      }
    } catch {
      /* fall through */
    }
    if (tf === "1m" || tf === "5m" || tf === "15m" || tf === "1h") {
      const r = await getVnOhlcv(symbol, Math.min(limit, 250));
      if (!r?.bars.length) {
        return { candles: [] as ChartCandle[], source: "vndirect-live-only", note: "Intraday VN — cho tick" };
      }
      if (r.bars.length >= 5) {
        return {
          candles: r.bars.map(toCandle).slice(-limit),
          source: r.meta.source || "vndirect-ohlcv",
          note: `Intraday fallback OHLCV · ${Math.min(r.bars.length, limit)} nen`,
        };
      }
      const last = r.bars[r.bars.length - 1];
      return {
        candles: [
          {
            time: last.time,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
            volume: last.volume,
          },
        ],
        source: "vndirect-session-anchor",
        note: "Intraday VN: neo phien + live ticks",
      };
    }
  }

  if (tf === "4h") {
    try {
      const bars = await fetchVndDchartHistory(symbol, "60", Math.min(limit * 4, 1_500));
      const candles = aggregateCandles(bars.map(toCandle), TF_MS["4h"]).slice(-limit);
      if (candles.length) {
        return { candles, source: "vndirect-dchart-1h→4h", note: "4H aggregate tu dchart 1H" };
      }
    } catch {
      /* fall through */
    }
  }

  const dayLimit =
    tf === "1d"
      ? Math.min(limit, 2_000)
      : tf === "1w"
        ? Math.min(limit * 5, 2_000)
        : tf === "1M"
          ? Math.min(limit * 22, 2_000)
          : tf === "12M"
            ? Math.min(limit * 250, 2_000)
            : Math.min(limit * 5, 1_500);

  const r = await getVnOhlcv(symbol, dayLimit);
  if (!r) throw new Error("stock_ohlcv_unavailable");
  let candles = r.bars.map(toCandle);
  if (tf === "1w") candles = aggregateCandles(candles, TF_MS["1w"]).slice(-limit);
  else if (tf === "1M") candles = aggregateCandles(candles, TF_MS["1M"]).slice(-limit);
  else if (tf === "12M") candles = aggregateCandles(candles, TF_MS["12M"]).slice(-limit);
  else if (tf === "4h") candles = aggregateCandles(candles, TF_MS["4h"]).slice(-limit);
  else candles = candles.slice(-limit);

  if (vndirect.isVnIndexSymbol(symbol)) {
    const indexQuality = validateIndexCandles(symbol, candles);
    if (indexQuality.valid.length < Math.max(3, candles.length * 0.5)) {
      throw new Error(indexQuality.reason ?? "index_fallback_out_of_range");
    }
    return {
      candles: indexQuality.valid.slice(-limit),
      source: r.meta.source === "vndirect" ? "vndirect-index-ohlcv" : r.meta.source,
      note: r.meta.note ?? `index ${tf}`,
    };
  }

  return {
    candles: candles.slice(-limit),
    source: r.meta.source === "vndirect" ? "vndirect-stock-ohlcv" : r.meta.source,
    note: r.meta.note ?? `stock ${tf}`,
  };
}

async function commodityCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ySym =
    yahooCommoditySymbol(s) ?? (s.startsWith("XAU") ? "GC=F" : s.startsWith("XAG") ? "SI=F" : null);

  // 1) Yahoo futures first (stable; Binance often geo-blocked)
  if (ySym) {
    try {
      const cfg =
        yahooIntervalFor(
          tf === "12M" ? "1M" : tf === "1w" ? "1w" : tf === "1M" ? "1M" : tf === "4h" ? "4h" : tf,
        ) ?? { interval: "1d", range: "max" };
      const y = await getYahooChart(ySym, cfg.interval, cfg.range);
      let candles = y.candles as ChartCandle[];
      if (cfg.aggregate4h || tf === "4h") candles = aggregateCandles(candles, TF_MS["4h"]);
      if (tf === "12M") candles = aggregateCandles(candles, TF_MS["12M"]);
      candles = candles.slice(-limit);
      if (candles.length >= 5) {
        return {
          candles,
          source: `yahoo-finance (${ySym})`,
          note: `Commodity OHLC · ${tf} · ${candles.length} nen`,
        };
      }
    } catch {
      /* try binance */
    }
  }

  // 2) Binance PAXG approx XAU when region allows
  if (s === "XAUUSD" || s === "GOLD" || s === "XAU" || s.includes("VANG") || ySym === "GC=F") {
    try {
      const iv = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"].includes(tf)
        ? binanceInterval(tf === "4h" ? "1h" : tf)
        : "1h";
      const bars = await binance.getKlinesDeep(
        "PAXGUSDT",
        iv,
        Math.min(limit * (tf === "4h" ? 4 : 1), 3000),
      );
      let candles = bars.map(toCandle);
      if (tf === "4h") candles = aggregateCandles(candles, TF_MS["4h"]);
      if (tf === "1M" || tf === "12M") candles = aggregateCandles(candles, TF_MS[tf]);
      candles = candles.slice(-limit);
      if (candles.length >= 5) {
        return { candles, source: "binance (PAXG approx XAU)", note: "Vang PAXG" };
      }
    } catch {
      /* fall through */
    }
  }

  if (!ySym) throw new Error("commodity_history_unavailable");
  throw new Error("commodity_history_empty");
}

function maxHistoryLimit(assetType: ChartAssetType): number {
  if (assetType === "crypto") return 5_000;
  if (assetType === "stock") return 2_500;
  return 2_000;
}

export async function getChartHistory(args: ChartArgs): Promise<{ data: ChartMarketData; meta: Meta } | null> {
  const symbol = args.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tf = args.timeframe;
  const maxL = maxHistoryLimit(args.assetType);
  const limit = Math.min(Math.max(args.limit ?? 500, 40), maxL);
  if (!tfsFor(args.assetType).includes(tf)) return null;

  try {
    const res = await cached(`chart:${args.assetType}:${symbol}:${tf}:${limit}`, {
      ttlMs: args.assetType === "crypto" ? 10_000 : 8_000,
      staleMs: 24 * 3_600_000,
      producer: async () => {
        const raw =
          args.assetType === "crypto"
            ? await cryptoCandles(symbol, tf, limit)
            : args.assetType === "forex"
              ? await forexCandles(symbol, tf, limit)
              : args.assetType === "commodity"
                ? await commodityCandles(symbol, tf, limit)
                : await stockCandles(symbol, tf, limit);

        const q = validateBars(raw.candles as OhlcvBar[]);
        if (q.status !== "VALID") void logQualityEvent("chart-engine", `${args.assetType}:${symbol}:${tf}`, q);
        if (!q.cleaned?.length) throw new Error("invalid candle series");
        const gap = detectGaps(q.cleaned, TF_MS[tf] ?? 86_400_000);
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
    const last = candles[candles.length - 1];
    const meta = buildMeta({
      source,
      sourceTimestampMs: last?.time ?? Date.now(),
      cached: res.cached,
      stale: res.stale,
      note:
        [note, gaps ? `${gaps} khoang trong` : null, suspect ? "quality: SUSPECT" : null]
          .filter(Boolean)
          .join(" · ") || undefined,
      slas:
        args.assetType === "crypto"
          ? { liveSlaMs: TF_MS[tf] * 1.5, freshSlaMs: TF_MS[tf] * 4, delayedSlaMs: TF_MS[tf] * 12 }
          : { liveSlaMs: 5 * 60_000, freshSlaMs: 30 * 60_000, delayedSlaMs: 6 * 3_600_000 },
    });

    return {
      data: {
        candles: candles as ChartCandle[],
        indicators: computeIndicators(candles as ChartCandle[]),
        markers: computeMarkers(candles as ChartCandle[]),
        intervalMs: TF_MS[tf] ?? 86_400_000,
        gaps,
        suspect,
      },
      meta,
    };
  } catch {
    return null;
  }
}
