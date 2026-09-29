/* Shared domain types + data-freshness model used across the whole platform. */

export type FreshnessStatus = "LIVE" | "FRESH" | "DELAYED" | "STALE" | "DEGRADED" | "UNAVAILABLE";

export type AssetClass = "stock" | "crypto" | "forex" | "commodity" | "index";

export interface Meta {
  source: string;
  sourceTimestampMs: number;
  receivedAtMs?: number;
  freshness?: FreshnessStatus;
  cached?: boolean;
  stale?: boolean;
  partial?: boolean;
  hasData?: boolean;
  note?: string;
  latencyMs?: number;
}

export interface Quote {
  symbol: string;
  name?: string | null;
  price: number | null;
  change?: number | null;
  changePercent?: number | null;
  volume?: number | null;
  quoteVolume?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  previousClose?: number | null;
  time?: number | null;
}

export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type DivergenceKind =
  | "regular_bullish"
  | "regular_bearish"
  | "hidden_bullish"
  | "hidden_bearish";

export type DivergenceOscillator = "rsi" | "macd_hist" | "macd_line" | "stoch";

export type DivergenceStrength = "A" | "B" | "C";

export interface DivergencePivot {
  /** Bar index in the input OHLCV series. */
  index: number;
  /** Epoch ms of the bar. */
  time: number;
  /** Price at the pivot (high for peaks, low for troughs). */
  price: number;
  /** Oscillator value at the pivot (or price when this is a price pivot). */
  value: number;
}

/**
 * Deterministic divergence signal produced by the quant engine.
 * Phase 0 contract — used by technical snapshot, screener, alerts, LLM data contract.
 */
export interface DivergenceSignal {
  kind: DivergenceKind;
  oscillator: DivergenceOscillator;
  /** Caller-supplied timeframe label (e.g. "1h", "1d"); null if unknown. */
  timeframe: string | null;
  strength: DivergenceStrength;
  /** 0..1 from strength + spacing quality (+ volume boost). */
  confidence: number;
  barsBetween: number;
  /** Older pivot first, newer second. */
  pricePivots: [DivergencePivot, DivergencePivot];
  oscPivots: [DivergencePivot, DivergencePivot];
  /**
   * single = classic 2-pivot; double/triple = successive same-kind pivots
   * (Phase 5 — multi-pivot structure).
   */
  structure?: "single" | "double" | "triple";
  /** Phase 1+: always true when right fractal window closed. */
  confirmed: boolean;
  confirmedAt: string;
  forming: boolean;
  /**
   * Volume confirmation at the newer price pivot vs SMA(volume).
   * true when second pivot shows elevated or exhaustion volume consistent with kind.
   */
  volumeConfirmed?: boolean;
  /** volume(second pivot) / SMA20(volume); null if volume unavailable. */
  volumeRatio?: number | null;
}

/* --------------------------------- Crypto --------------------------------- */

export interface CryptoMarketRow extends Quote {
  assetClass: "crypto";
  baseAsset: string;
}

export interface ProviderHealthSnapshot {
  provider: string;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  circuit: "closed" | "open" | "half-open";
  lastError: string | null;
  recentEvents: { at: string; event: string; message: string | null; latencyMs: number | null }[];
}
