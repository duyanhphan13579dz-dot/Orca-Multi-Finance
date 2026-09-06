import type { OhlcvBar } from "../types";

export type ForexTier = "A" | "B" | "C" | "EXCLUDED";
export type ForexVolatilityRegime = "LOW_VOLATILITY" | "NORMAL" | "HIGH_VOLATILITY" | "EXTREME_VOLATILITY";
export type ForexMarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "CHAOTIC";
export type ForexScalpDirection = "BUY" | "SELL" | "NONE";
export type ForexSetupStatus =
  | "ACTIVE"
  | "AWAITING_M5_BREAKOUT"
  | "AWAITING_M1_RETEST"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED"
  | "FILTERED_OUT"
  | "NO_SETUP";

export interface ForexScalpSetup {
  strategy: "A" | "B" | "C";
  direction: ForexScalpDirection;
  status: ForexSetupStatus;
  strength: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  invalidation: number | null;
  entryZone: [number, number] | null;
  stopPips: number | null;
  rectangle?: { top: number; bottom: number } | null;
  evidence: string[];
  riskNotes: string[];
}

export interface ForexFilterResult {
  eligible: boolean;
  tier: ForexTier;
  spreadOk: boolean;
  sessionOk: boolean;
  newsOk: boolean;
  spreadPips: number | null;
  maxSpreadPips: number;
  sessionLabel: string;
  reasons: string[];
}

export interface ForexRegimeSnapshot {
  volatility: ForexVolatilityRegime;
  market: ForexMarketRegime;
  atrPips: number | null;
  atrRatio: number | null;
  evidence: string[];
}

export interface ForexScalpSignal {
  pair: string;
  timeframe: string;
  direction: "watch-long" | "watch-short" | "neutral";
  strength: number;
  score: number;
  last: number;
  pipSize: number;
  atr: number | null;
  atrPips: number | null;
  entryZone: [number, number] | null;
  invalidation: number | null;
  micro: { support: number[]; resistance: number[] };
  riskNotes: string[];
  evidence: string[];
  filter: ForexFilterResult;
  regime: ForexRegimeSnapshot;
  activeSetups: ForexScalpSetup[];
  primarySetup: ForexScalpSetup | null;
  moduleBStatus: "AVAILABLE" | "ORDER_FLOW_UNAVAILABLE";
  riskHint: {
    recommendedRiskPct: number;
    stopPips: number | null;
    note: string;
  };
}

export interface ForexScalpInput {
  pair: string;
  barsM15: OhlcvBar[];
  barsM5: OhlcvBar[];
  barsM1?: OhlcvBar[] | null;
  bid?: number | null;
  ask?: number | null;
  spreadPips?: number | null;
  nowMs?: number;
}
