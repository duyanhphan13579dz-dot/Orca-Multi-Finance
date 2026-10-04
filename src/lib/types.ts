/* Shared domain types + data-freshness model used across the whole platform. */
import type { MoneyFlowAnalysis } from "./engines/money-flow";

export type FreshnessStatus = "LIVE" | "FRESH" | "DELAYED" | "STALE" | "DEGRADED" | "UNAVAILABLE";

export type AssetClass = "stock" | "crypto" | "forex" | "commodity" | "index";

export type QualityStatus = "VALID" | "SUSPECT" | "INVALID" | "STALE";

/** Standard API meta describing data provenance + freshness + quality. */
export interface Meta {
  source: string;
  sourceTimestamp: string | null;
  providerReceivedAt?: string | null;
  ingestedAt: string;
  freshness: FreshnessStatus;
  ageMs: number | null;
  cached: boolean;
  stale: boolean;
  latencyMs?: number;
  qualityStatus?: QualityStatus;
  note?: string;
  partial?: boolean;
  sections?: Record<string, FreshnessStatus>;
  discrepancies?: { check: string; message: string }[];
  outputValidation?: { validated: boolean; unsupportedClaims: number; recovered?: string };
}

export interface ApiOk<T> {
  success: true;
  data: T;
  meta: Meta;
}
export interface ApiErr {
  success: false;
  error: { code: string; message: string };
  meta?: Meta;
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface Quote {
  symbol: string;
  name?: string | null;
  assetClass: AssetClass;
  price: number;
  change: number | null;
  changePercent: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  quoteVolume?: number | null;
  referencePrice?: number | null;
  ceilingPrice?: number | null;
  floorPrice?: number | null;
  updatedAt?: string | null;
}

export interface IndexQuote {
  code: string;
  name?: string | null;
  value: number;
  change: number | null;
  changePercent: number | null;
  updatedAt?: string | null;
}

export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/* ------------------------------ Alpha / Beta (CAPM) ----------------------- */

export type AlphaBetaProfile =
  | "alpha_high_beta_low"
  | "alpha_high_beta_high"
  | "alpha_flat_beta_high"
  | "alpha_neg_beta_low"
  | "alpha_neg_beta_high"
  | "insufficient";

export interface AlphaBetaSnapshot {
  beta: number | null;
  betaAdj: number | null;
  betaDimson: number | null;
  betaUp: number | null;
  betaDown: number | null;
  alphaAnnual: number | null;
  alphaT: number | null;
  r2: number | null;
  seBeta: number | null;
  n: number;
  alphaH1: number | null;
  alphaH2: number | null;
  profile: AlphaBetaProfile;
  profileVi: string;
  quality: {
    reliable: boolean;
    lowR2: boolean;
    wideSe: boolean;
    flags: string[];
  };
  benchmark: string;
  window: string;
  summary: string;
}

/* ------------------------------ Technical -------------------------------- */

export interface TechnicalSnapshot {
  last: number;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  sma: { sma20: number | null; sma50: number | null; sma200: number | null };
  ema: { ema12: number | null; ema26: number | null };
  bollinger: { upper: number; mid: number; lower: number } | null;
  atr14: number | null;
  moneyFlow?: {
    cmf20: number | null;
    obvTrend: "inflow" | "outflow" | "neutral" | "unknown";
    volumeRatio20: number | null;
    pressure: number;
    label: "strong-inflow" | "inflow" | "balanced" | "outflow" | "strong-outflow" | "unknown";
  };
  moneyFlowAnalysis?: MoneyFlowAnalysis;
  volatility30d: number | null;
  maxDrawdown: number | null;
  returns: { d7: number | null; d30: number | null; ytd: number | null; y1: number | null };
  high52w: number | null;
  low52w: number | null;
  support: number[];
  resistance: number[];
  trend: { score: number; label: "strong-up" | "up" | "sideways" | "down" | "strong-down" };
  signals: string[];
  divergences?: DivergenceSignal[];
  candleClusters?: {
    name: string;
    category: "bullish_reversal" | "bearish_reversal" | "continuation" | "neutral";
    score: number;
    ageBars: number;
    candles: number;
  }[];
  tradeSignal?: {
    action: "buy" | "sell" | "watch";
    actionVi: "MUA" | "BÁN" | "QUAN SÁT";
    confidence: number;
    bias: number;
    reasons: string[];
    plan?: {
      entry: number;
      stopLoss: number;
      takeProfit: number;
      takeProfit1: number;
      takeProfit2: number;
      takeProfit3: number;
      riskReward: number;
      riskPct: number;
      rewardPct: number;
      invalidation: number;
      basis: string[];
      notes: string[];
    } | null;
  };
  dataQuality?: {
    bars: number;
    latestBarTime: number;
    ageMs: number;
    stale: boolean;
    deduplicated: boolean;
  };
  /** CAPM weekly alpha/beta vs VNINDEX (when market series available). */
  alphaBeta?: AlphaBetaSnapshot | null;
}

export interface CandlePattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  reliability: "high" | "medium" | "low";
  description: string;
}

/* ------------------------------ Divergence -------------------------------- */

export type DivergenceKind =
  | "regular_bullish"
  | "regular_bearish"
  | "hidden_bullish"
  | "hidden_bearish";

export type DivergenceOscillator = "rsi" | "macd_hist" | "macd_line";

export type DivergenceStrength = "A" | "B" | "C";

export interface DivergenceSignal {
  kind: DivergenceKind;
  oscillator: DivergenceOscillator;
  strength: DivergenceStrength;
  pricePivots: number[];
  oscPivots: number[];
  ageBars: number;
  note?: string;
}

/* ------------------------------ Other shared ------------------------------ */

export interface BulletinTechnical {
  symbol: string;
  trend?: string;
  rsi?: number | null;
}

export interface ProviderHealth {
  id: string;
  ok: boolean;
  latencyMs: number | null;
  consecutiveFailures: number;
  circuit: "closed" | "open" | "half-open";
  lastError: string | null;
  recentEvents: { at: string; event: string; message: string | null; latencyMs: number | null }[];
}
