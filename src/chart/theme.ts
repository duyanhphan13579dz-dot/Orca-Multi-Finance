/**
 * ORCA CHART FRAMEWORK — theme & shared client types.
 * Deep navy institutional terminal theme. Single source of truth for every
 * chart surface (stocks, crypto, forex, commodities).
 */

export type ChartAsset = "crypto" | "forex" | "stock" | "commodity";

export interface OrcaChartTheme {
  up: string;
  down: string;
  grid: string;
  text: string;
  accent: string;
  accent2: string;
  warn: string;
  info: string;
  purple: string;
}

export const ORCA_CHART_THEME: OrcaChartTheme = {
  up: "#2ec27e",
  down: "#ee5f75",
  grid: "rgba(33,56,99,0.35)",
  text: "#64769a",
  accent: "#4c8dff",
  accent2: "#6ea8fe",
  warn: "#f5a524",
  info: "#38bdf8",
  purple: "#b58cff",
};

export type ChartKind = "candles" | "area" | "line" | "baseline" | "bar";

export const CHART_KIND_LABEL: Record<ChartKind, string> = {
  candles: "Candles",
  area: "Area",
  line: "Line",
  baseline: "Baseline",
  bar: "Bars",
};

export type PaneId = "price" | "volume" | "rsi" | "macd";

export interface LiveState {
  state: "live" | "delayed" | "connecting" | "closed" | "reconnecting";
  ageMs: number | null;
}

/** marker kinds §18 — only ever supplied by deterministic engines or system events */
export type SignalType =
  | "buy-signal"
  | "sell-signal"
  | "breakout"
  | "breakdown"
  | "volume-spike"
  | "rsi-extreme"
  | "news-event"
  | "risk-warning"
  | "ai-analysis";

export interface SignalMarker {
  time: number; // epoch ms
  type: SignalType;
  position: "aboveBar" | "belowBar" | "inBar";
  title: string;
  metadata?: Record<string, unknown>;
}
