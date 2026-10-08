/* Shared domain types + data-freshness model used across the whole platform. */
import type { MoneyFlowAnalysis } from "./engines/money-flow";

export type FreshnessStatus = "LIVE" | "FRESH" | "DELAYED" | "STALE" | "DEGRADED" | "UNAVAILABLE";
export type AssetClass = "stock" | "crypto" | "forex" | "commodity" | "index" | "derivative";
export type QualityStatus = "VALID" | "SUSPECT" | "INVALID" | "STALE";

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
  hasData?: boolean;
  sections?: Record<string, FreshnessStatus>;
  discrepancies?: { check: string; message: string }[];
  outputValidation?: { validated: boolean; unsupportedClaims: number; recovered?: string };
}

export interface ApiOk<T> { success: true; data: T; meta: Meta; }
export interface ApiErr { success: false; error: { code: string; message: string }; meta?: Meta; }
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
  timestamp?: number | string | null;
}

export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary?: string | null;
  symbols?: string[];
  sentiment?: number | null;
  category?: string | null;
  relatedSector?: string | null;
  relatedSymbols?: string[];
}

export interface IndexQuote {
  code: string;
  name?: string | null;
  value: number;
  change: number | null;
  changePercent: number | null;
  volume?: number | null;
  updatedAt?: string | null;
}

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
  alpha: number | null;
  alphaAnn: number | null;
  rSquared: number | null;
  residualVol: number | null;
  sampleDays: number;
  profile: AlphaBetaProfile;
}

export interface MoneyFlowSnapshot {
  cmf20?: number | null;
  obvTrend?: string | null;
  volumeRatio20?: number | null;
  pressure?: number | null;
  label?: string | null;
}

export type Reliability = "very_high" | "high" | "medium" | "low";

export interface CandlePattern {
  name: string;
  nameVi?: string;
  description?: string;
  direction: "bullish" | "bearish" | "neutral";
  strength?: number | string | null;
  at?: number;
  type?: string;
  category?: string;
  reliability?: Reliability | string;
  score?: number;
  volumeConfirmed?: boolean | null;
  ageBars?: number | null;
  index?: number;
  time?: number;
  label?: string;
  candles?: number;
}

export type DivergenceKind =
  | "regular_bullish"
  | "regular_bearish"
  | "hidden_bullish"
  | "hidden_bearish"
  | string;
export type DivergenceOscillator = "rsi" | "macd_hist" | "macd_line" | "stoch" | string;
export type DivergenceStrength = "A" | "B" | "C" | string;

export interface DivergencePivot {
  index: number;
  time: number;
  value: number;
  price: number;
}

export interface DivergenceSignal {
  kind: DivergenceKind;
  oscillator: DivergenceOscillator;
  strength: DivergenceStrength | number | string;
  confidence: number;
  barsBetween: number;
  timeframe: string | null;
  pricePivots: DivergencePivot[];
  oscPivots: DivergencePivot[];
  structure: string;
  volumeConfirmed: boolean | null;
  volumeRatio?: number | null;
  detectedAt: number;
  type?: string;
  direction?: "bullish" | "bearish" | string;
  indicator?: string;
  at?: number;
  label?: string;
  score?: number;
}

export interface TradeSignal {
  action?: "buy" | "sell" | "hold" | "wait" | string;
  confidence?: number;
  reasons?: string[];
  stopLoss?: number | null;
  takeProfit?: number | null;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  plan?: any;
  [key: string]: unknown;
}

export interface TechnicalSnapshot {
  last: number;
  rsi14: number | null;
  macd: {
    macd: number | null;
    signal: number | null;
    hist: number | null;
    histogram?: number | null;
  } | null;
  sma: { sma20: number | null; sma50: number | null; sma200: number | null };
  ema: { ema12: number | null; ema26: number | null };
  bollinger: { upper: number | null; mid: number | null; lower: number | null } | null;
  atr14: number | null;
  moneyFlow?: MoneyFlowSnapshot | null;
  moneyFlowAnalysis?: MoneyFlowAnalysis | null;
  volatility30d?: number | null;
  maxDrawdown?: number | null;
  returns?: { d7?: number | null; d30?: number | null; ytd?: number | null; y1?: number | null };
  high52w?: number | null;
  low52w?: number | null;
  support?: number | number[] | null;
  resistance?: number | number[] | null;
  supportLevels?: number[];
  resistanceLevels?: number[];
  trend?: { score: number; label: string } | null;
  divergences?: DivergenceSignal[];
  signals?: unknown[] | string[];
  tradeSignal?: TradeSignal | null;
  candlePatterns?: CandlePattern[];
  candleClusters?: unknown[];
  dataQuality?: {
    bars?: number;
    latestBarTime?: number | null;
    ageMs?: number | null;
    stale?: boolean;
    deduplicated?: number | boolean;
  };
}

export interface CryptoMarketRow extends Quote {
  marketCap?: number | null;
  rank?: number | null;
  baseAsset?: string | null;
  trades24h?: number | null;
}
export interface ForexRow extends Quote { pair?: string; }
export interface ForexMarket { rows: ForexRow[]; updatedAt?: string | null; }
export interface CommodityRow extends Quote {
  unit?: string | null;
  currency?: string | null;
  commodity?: string | null;
  group?: string | null;
  sourceRecords?: {
    source: string;
    price?: number | null;
    changePercent?: number | null;
    timestamp?: number | string | null;
    url?: string | null;
  }[];
}

export interface BulletinOverview { narrative?: string; riskGauge?: number; }
export interface BulletinFlow { foreignNet?: number | null; }
export interface BulletinTopMover { symbol: string; changePercent: number; }
export interface BulletinSectors { leaders?: string[]; laggards?: string[]; }
export interface BulletinTechnical { symbol: string; trend?: string; rsi?: number | null; }
export interface MarketBulletin {
  overview?: BulletinOverview;
  flow?: BulletinFlow;
  topMovers?: BulletinTopMover[];
  sectors?: BulletinSectors;
  technical?: BulletinTechnical[];
}

export interface ProviderStatus {
  provider: string;
  domain: string;
  status: "healthy" | "degraded" | "down" | "unknown" | string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  circuit: "closed" | "open" | "half-open";
  lastError: string | null;
  recentEvents: { at: string; event: string; message: string | null; latencyMs: number | null }[];
  id?: string;
  ok?: boolean;
  latencyMs?: number | null;
}

export type DerivativeContractStatus = "ACTIVE" | "EXPIRED" | "SUSPENDED" | "MONITORING";
export type DerivativeContractType = "INDEX_FUTURE" | "BOND_FUTURE" | "COMMODITY_FUTURE" | "OPTION";

export interface DerivativeProduct {
  id: string;
  exchange: string;
  underlying: string;
  contractType: DerivativeContractType;
  name: string;
  nameEn?: string | null;
  multiplier: number | null;
  tickSize: number | null;
  currency: string;
  quoteUnit?: string | null;
  settlementType?: string | null;
  settlementMethod?: string | null;
  positionLimit?: number | null;
  source?: string | null;
}

export interface DerivativeContract {
  code: string;
  productId: string;
  underlying: string;
  status: DerivativeContractStatus;
  expiry: string | null;
  lastTradingDate?: string | null;
  settlementDate?: string | null;
  openInterest?: number | null;
  volume?: number | null;
  lastPrice?: number | null;
  change?: number | null;
  changePercent?: number | null;
  basis?: number | null;
  fairValue?: number | null;
  symbol?: string | null;
  priority?: number | null;
  source?: string | null;
}

export interface DerivativeCurvePoint {
  code: string;
  expiry: string | null;
  daysToExpiry: number | null;
  lastPrice: number | null;
  basis: number | null;
  openInterest: number | null;
  volume: number | null;
}

export interface DerivativeAlert {
  id: string;
  code: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  message: string;
  at: string;
}

export interface DerivativeFlowSnapshot {
  code: string;
  oiChange: number | null;
  volume: number | null;
  basisChange: number | null;
  tone: "positive" | "negative" | "warning" | "muted";
}
