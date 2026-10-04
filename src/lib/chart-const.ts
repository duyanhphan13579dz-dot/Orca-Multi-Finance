/**
 * UNIFIED CHART DATA MODEL + TIMEFRAME MAPS
 */

export type ChartAssetType = "crypto" | "forex" | "stock" | "commodity";

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface MacdPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface ChartIndicators {
  ema20?: IndicatorPoint[];
  ema50?: IndicatorPoint[];
  ema200?: IndicatorPoint[];
  ma10?: IndicatorPoint[];
  ma20?: IndicatorPoint[];
  ma50?: IndicatorPoint[];
  ma100?: IndicatorPoint[];
  ma200?: IndicatorPoint[];
  bollinger?: { time: number; upper: number; mid: number; lower: number }[];
  vwap?: IndicatorPoint[];
  rsi?: IndicatorPoint[];
  macd?: MacdPoint[];
  srLevels?: { price: number; kind: "support" | "resistance" }[];
}

export interface ChartSignalMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text?: string;
}

export interface ChartMarketData {
  candles: ChartCandle[];
  indicators: ChartIndicators | null;
  markers: ChartSignalMarker[];
  intervalMs: number;
  gaps: number;
  suspect: number;
  /** Echo request timeframe so client can ignore stale/keepPrevious payloads */
  timeframe?: string;
}

export const CRYPTO_TFS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"] as const;
export const FOREX_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;
export const STOCK_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "12M"] as const;
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
  "1M": 2_592_000_000,
  "12M": 31_536_000_000,
};

/** binance kline interval for crypto timeframe (1:1 where available) */
export function binanceInterval(tf: string): string | null {
  const map: Record<string, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "6h": "6h",
    "12h": "12h",
    "1d": "1d",
    "1w": "1w",
  };
  return map[tf] ?? null;
}

/** VNDirect dchart resolution for stock TF */
export function vndDchartResolution(tf: string): "D" | "1" | "5" | "15" | "30" | "60" | null {
  const map: Record<string, "D" | "1" | "5" | "15" | "30" | "60"> = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "1d": "D",
  };
  return map[tf] ?? null;
}

/** aggregate small candles into a larger timeframe */
export function aggregateCandles(
  bars: ChartCandle[],
  bucketMs: number,
): ChartCandle[] {
  if (!bars.length || bucketMs <= 0) return bars;
  const out: ChartCandle[] = [];
  let bucketStart = -1;
  let cur: ChartCandle | null = null;
  for (const b of bars) {
    const t = Math.floor(b.time / bucketMs) * bucketMs;
    if (t !== bucketStart || !cur) {
      if (cur) out.push(cur);
      bucketStart = t;
      cur = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}
