/**
 * UNIFIED CHART DATA MODEL + TIMEFRAME MAPS
 * Shared by API routes, engines, and client chart components.
 */

export interface ChartCandle {
  /** Unix epoch milliseconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ChartAssetType = "crypto" | "forex" | "stock" | "commodity";

export const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1M": 30 * 24 * 60 * 60_000,
  "12M": 365 * 24 * 60 * 60_000,
};

export const CRYPTO_TFS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M", "12M"] as const;

export const FOREX_TFS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "12M"] as const;

/** VN stocks — dchart native: 1/5/15/30/60/D; 4h/1w/1M aggregated */
export const STOCK_TFS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "12M"] as const;

export const COMMODITY_TFS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "12M"] as const;

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

/** Map app timeframe → Binance kline interval (crypto). */
export function binanceInterval(tf: string): string {
  if (tf === "1M") return "1M";
  if (tf === "12M") return "1M";
  return tf;
}

/** Map app timeframe → VNDirect dchart resolution. Null = needs aggregation. */
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
      return null;
  }
}

/** Aggregate lower-TF candles into higher TF buckets (ms-aligned). */
export function aggregateCandles(candles: ChartCandle[], tfMs: number): ChartCandle[] {
  if (!candles.length || tfMs <= 0) return candles;
  const out: ChartCandle[] = [];
  let bucket: ChartCandle | null = null;
  let bucketStart = -1;
  for (const c of candles) {
    const start = Math.floor(c.time / tfMs) * tfMs;
    if (bucket && start === bucketStart) {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += c.volume ?? 0;
    } else {
      if (bucket) out.push(bucket);
      bucketStart = start;
      bucket = {
        time: start,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      };
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface ChartIndicators {
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  sma20: IndicatorPoint[];
  sma50: IndicatorPoint[];
  rsi: IndicatorPoint[];
  macd: { macd: IndicatorPoint[]; signal: IndicatorPoint[]; histogram: IndicatorPoint[] };
  bollinger: { upper: IndicatorPoint[]; mid: IndicatorPoint[]; lower: IndicatorPoint[] };
  vwap: IndicatorPoint[];
  atr: IndicatorPoint[];
  levels?: { support: number[]; resistance: number[] };
}

export interface ChartSignalMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle";
  color: string;
  text?: string;
}

export interface ChartMarketData {
  candles: ChartCandle[];
  indicators: ChartIndicators | null;
  markers: ChartSignalMarker[];
  intervalMs: number;
  gaps: number;
  suspect: number;
  /** Echo request timeframe so client can ignore stale payloads */
  timeframe?: string;
}
