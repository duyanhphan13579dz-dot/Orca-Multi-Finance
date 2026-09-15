/**
 * UNIFIED CHART DATA MODEL + TIMEFRAME CONSTANTS
 * Shared between server (chart services) and client (OrcaChart) — no
 * provider-specific formats are allowed past the normalization layer.
 * NEVER add server-only imports here.
 */

export interface ChartCandle {
  /** epoch ms */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type ChartAssetType = "crypto" | "forex" | "stock" | "commodity";

export const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000, // ~30d
  "12M": 31_536_000_000, // ~365d
};

/** Full set for VN stocks/indices: dchart intraday + daily aggregate for 4H/1W/1M/12M */
export const CRYPTO_TFS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M", "12M"] as const;
export const FOREX_TFS = ["1d", "1w", "1M", "12M"] as const;
/**
 * VN stock/index TFs.
 * 1m/5m/15m/1h → VNDirect dchart (+ live ticks).
 * 4h → aggregate from 1h dchart.
 * 1d → dchart D + live session bucket.
 * 1w/1M/12M → aggregate from daily (dchart has no native W/M).
 */
export const STOCK_TFS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "12M"] as const;
export const COMMODITY_TFS = ["1h", "4h", "1d", "1w", "1M", "12M"] as const;

export function tfsFor(asset: ChartAssetType): readonly string[] {
  if (asset === "crypto") return CRYPTO_TFS;
  if (asset === "forex") return FOREX_TFS;
  if (asset === "commodity") return COMMODITY_TFS;
  return STOCK_TFS;
}

export const TF_LABEL: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6H",
  "12h": "12H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
  "12M": "12M",
};

/** binance kline interval for crypto timeframe (1:1 where available) */
export function binanceInterval(tf: string): string {
  if (tf === "1d") return "1d";
  if (tf === "1w") return "1w";
  if (tf === "1M") return "1M";
  if (tf === "12M") return "1M"; // aggregate 12× monthly
  return tf;
}

/** Map app TF → VNDirect dchart resolution (native only). */
export function vndDchartResolution(tf: string): "1" | "5" | "15" | "30" | "60" | "D" | null {
  switch (tf) {
    case "1m":
      return "1";
    case "5m":
      return "5";
    case "15m":
      return "15";
    case "30m":
      return "30";
    case "1h":
      return "60";
    case "1d":
      return "D";
    default:
      return null; // 4h/1w/1M/12M: aggregate
  }
}

/** aggregate small candles into a larger timeframe */
export function aggregateCandles(candles: ChartCandle[], tfMs: number): ChartCandle[] {
  if (!candles.length) return [];
  const out: ChartCandle[] = [];
  let cur: ChartCandle | null = null;
  for (const c of candles) {
    const bucket = Math.floor(c.time / tfMs) * tfMs;
    if (!cur || bucket !== cur.time) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Client-safe indicator/payload shapes (also used by server chart service). */
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
  type: "buy-signal" | "sell-signal" | "volume-spike" | "rsi-extreme" | "breakout" | "breakdown" | string;
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
