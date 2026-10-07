import type { OhlcvBar } from "../types";

export type AssetTier = "A" | "B" | "C" | "EXCLUDED";
export type VolatilityRegime = "LOW_VOLATILITY" | "NORMAL" | "HIGH_VOLATILITY" | "EXTREME_VOLATILITY";
export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "CHAOTIC";
export type ScalpDirection = "BUY" | "SELL" | "NONE";
export type SetupStatus =
  | "ACTIVE"
  | "AWAITING_M5_BREAKOUT"
  | "AWAITING_M1_RETEST"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED"
  | "FILTERED_OUT"
  | "NO_SETUP";

export interface ScalpSetup {
  strategy: "A" | "B" | "C";
  direction: ScalpDirection;
  status: SetupStatus;
  strength: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  invalidation: number | null;
  entryZone: [number, number] | null;
  rectangle?: { top: number; bottom: number } | null;
  evidence: string[];
  riskNotes: string[];
}

export interface AssetFilterResult {
  eligible: boolean;
  tier: AssetTier;
  reasons: string[];
  spreadOk: boolean;
  volumeRatio: number | null;
  dataQualityOk: boolean;
}

export interface RegimeSnapshot {
  volatility: VolatilityRegime;
  market: MarketRegime;
  atrPct: number | null;
  atrRatio: number | null;
  evidence: string[];
}

/** Original fields required; v2 fields optional for backward compatibility */
export interface ScalpSignal {
  timeframe: string;
  direction: "watch-long" | "watch-short" | "neutral";
  strength: number;
  score: number;
  last: number;
  vwap: number | null;
  vwapDistPct: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi7: number | null;
  atr: number | null;
  atrPct: number | null;
  momentum: { bars3: number | null; bars6: number | null };
  volume: { ratioVsMedian: number | null; spike: boolean };
  entryZone: [number, number] | null;
  invalidation: number | null;
  micro: { support: number[]; resistance: number[] };
  riskNotes: string[];
  evidence: string[];
  symbol?: string;
  filter?: AssetFilterResult;
  regime?: RegimeSnapshot;
  activeSetups?: ScalpSetup[];
  primarySetup?: ScalpSetup | null;
  moduleBStatus?: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE";
  context?: {
    fundingRate: number | null;
    openInterest: number | null;
    quoteVolume24h: number | null;
  };
}

export interface ScalpAnalyzeInput {
  symbol: string;
  barsM15: OhlcvBar[];
  barsM5: OhlcvBar[];
  barsM1?: OhlcvBar[] | null;
  quoteVolume24h?: number | null;
  fundingRate?: number | null;
  openInterest?: number | null;
  spreadPct?: number | null;
}
