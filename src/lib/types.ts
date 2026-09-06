/* Shared domain types + data-freshness model used across the whole platform. */

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
  /** reconciliation + output validation introspection (intelligence endpoints) */
  discrepancies?: { check: string; message: string }[];
  outputValidation?: { validated: boolean; unsupportedClaims: number; recovered?: string };
  /** Phase 2 — data confidence (multi-provider agreement, quality, freshness, fallback) */
  dataConfidence?: { score: number; level: "high" | "medium" | "low" | "unverified"; factors: string[] } | null;
  /** Phase 2 — provider source set tham gia resolution (vndirect, archive…) */
  providers?: string[];
  /** Phase 4 — agent pipeline trace: question → realtime → quant → confidence → llm → output */
  pipeline?: {
    steps: string[];
    intent: string;
    quant: string[];
    realtimeOverlaid: number;
    confidence: string | null;
    llm: boolean;
  };
  /** Phase 6 — partial-response diagnostics: which component failed and its status */
  errors?: { component: string; status: string; message?: string }[];
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
  currency?: string | null;
  unit?: string | null;
  /** Vietnam-specific price bands (when provider supplies them) */
  referencePrice?: number | null;
  ceilingPrice?: number | null;
  floorPrice?: number | null;
  updatedAt: string | null;
}

export interface OhlcvBar {
  time: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  category: "market" | "corporate" | "macro" | "crypto" | "forex" | "commodities" | "general";
  publishedAt: string;
  relatedSymbols: string[];
  relatedSector: string | null;
}

export interface IndexQuote {
  code: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  volume?: number | null;
  updatedAt: string | null;
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
  volatility30d: number | null; // annualized stdev of daily log returns
  maxDrawdown: number | null; // negative fraction over lookback
  returns: { d7: number | null; d30: number | null; ytd: number | null; y1: number | null };
  high52w: number | null;
  low52w: number | null;
  support: number[];
  resistance: number[];
  trend: { score: number; label: "strong-up" | "up" | "sideways" | "down" | "strong-down" };
  signals: string[];
}

export interface CandlePattern {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  reliability: "high" | "medium" | "low";
  description: string;
}

/* --------------------------------- Crypto --------------------------------- */

export interface CryptoMarketRow extends Quote {
  assetClass: "crypto";
  baseAsset: string;
  trades24h?: number | null;
  fundingRate?: number | null;
  /** Phase 6 — provider previous close (Binance prevClosePrice) khi có */
  previousClose?: number | null;
}

/* --------------------------------- Forex ---------------------------------- */

export interface ForexRow extends Quote {
  assetClass: "forex";
  pair: string;
  base: string;
  quote: string;
  group: "major" | "minor" | "exotic";
  /** Phase 6 — normalized schema aliases (additive, UI hiện tại vẫn dùng base/quote) */
  baseCurrency?: string;
  quoteCurrency?: string;
  previousClose?: number | null;
}

/* ------------------------------- Commodities ------------------------------- */

export interface CommodityRow extends Quote {
  assetClass: "commodity";
  commodity: string;
  group: "consumer" | "metals" | "chemicals" | "construction" | "energy" | "plastics";
  sourceRecords: { source: string; price: number; timestamp: string | null; url?: string | null }[];
  /** Phase Commodities — unified model (additive) */
  id?: string;
  name?: string;
  nameVi?: string;
  category?: string;
  subcategory?: string | null;
  /** sub-group (subcategory) + market VN/INTL — per official universe */
  subgroup?: string | null;
  market?: "VN" | "INTL";
  previousClose?: number | null;
  open?: number | null;
  /** per-row honest freshness */
  freshness?: FreshnessStatus;
  marketState?: "OPEN" | "CLOSED" | "UNKNOWN";
  freshnessNote?: string | null;
  priceType?: "OHLC" | "CLOSE_ONLY";
  /** provider-published performance (source truth, not computed by us) */
  providerPerf?: Record<string, number | null> | null;
  relatedStocks?: string[];
  sourceUrl?: string | null;
  /** provider-quote timestamp */
  sourceTimestamp?: string | null;
  performance?: {
    "1D": { change: number | null; changePercent: number | null; basis: string };
    "1W": { change: number | null; changePercent: number | null; basis: string };
    "1M": { change: number | null; changePercent: number | null; basis: string };
    "1Q": { change: number | null; changePercent: number | null; basis: string };
    "1Y": { change: number | null; changePercent: number | null; basis: string };
  } | null;
}
/* --------------------------------- Provider -------------------------------- */

export interface ProviderStatus {
  provider: string;
  domain: string;
  status: "healthy" | "degraded" | "down" | "unknown";
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
}
