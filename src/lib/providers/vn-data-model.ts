/**
 * ORCA UNIFIED VN DATA MODEL — provider-agnostic contract (Phase 3).
 *
 * This is the NORMALIZED shape that every Vietnam-stock provider (VNDirect
 * today, Simplize or any future provider) maps INTO. Provider-specific schemas
 * (VndQuoteRow, Simplize page layout…) must NEVER leak past the provider
 * layer; everything below is what the Data Engine / API consumes.
 *
 * Every result carries `source`, `timestamp` and `freshness` metadata:
 * freshness ∈ LIVE | FRESH | DELAYED | STALE | UNAVAILABLE.
 * UNAVAILABLE is a first-class result — never a crash, never fabricated data.
 */
import type { FreshnessStatus } from "../types";

/* ------------------------------- MarketIndex ------------------------------- */

export interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  value: number | null;
  timestamp: number | null;
  source: string;
  freshness: FreshnessStatus;
}

/* -------------------------------- StockQuote ------------------------------- */

export interface StockQuote {
  symbol: string;
  price: number;
  reference: number | null;
  ceiling: number | null;
  floor: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  value: number | null;
  timestamp: number | null;
  source: string;
  freshness: FreshnessStatus;
}

/* ---------------------------------- Candle ---------------------------------- */

export interface Candle {
  symbol: string;
  timeframe: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/* ------------------------------- StockProfile ------------------------------- */

export interface StockProfile {
  symbol: string;
  companyName: string;
  exchange: string; // HOSE | HNX | UPCOM
  industry: string | null;
  marketCap: number | null; // in the provider's native currency unit (VND)
  outstandingShares: number | null;
  metrics: {
    pe?: number | null;
    pb?: number | null;
    eps?: number | null;
    bvps?: number | null;
    roe?: number | null;
    roa?: number | null;
    evEbitda?: number | null;
    beta5y?: number | null;
    dividendYield?: number | null;
    [key: string]: number | null | undefined;
  };
  source: string;
  updatedAt: string | null;
  freshness: FreshnessStatus;
}

/* ------------------------------ Recommendation ------------------------------ */

export type RecommendationKind = "BROKER_RECOMMENDATION" | "ORCA_SYSTEM_SIGNAL";

export interface Recommendation {
  symbol: string;
  type: RecommendationKind;
  value: string; // BUY | HOLD | SELL | OVERWEIGHT … (as published by the source)
  targetPrice: number | null;
  source: string;
  analyst: string | null;
  reportDate: string | null;
  reportTitle: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
}

/* ------------------------- provider result envelope ------------------------- */

export interface VnDataOk<T> {
  available: true;
  data: T;
  source: string;
  timestamp: number | null;
  freshness: FreshnessStatus;
}

export interface VnDataUnavailable {
  available: false;
  reason: string;
  source: string;
  timestamp: number | null;
  freshness: "UNAVAILABLE";
}

export type VnDataResult<T> = VnDataOk<T> | VnDataUnavailable;

/** shared honest UNAVAILABLE — no mock, no crash */
export function unavailable(reason: string, source = "simplize"): VnDataUnavailable {
  return { available: false, reason, source, timestamp: null, freshness: "UNAVAILABLE" };
}
