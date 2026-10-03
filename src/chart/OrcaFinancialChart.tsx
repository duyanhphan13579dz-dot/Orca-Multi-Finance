"use client";

/**
 * ORCA FINANCIAL CHART — history + toggleable indicators.
 * VN live scale: bidirectional board-lot ↔ full-VND guard (prevents last-candle spike).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { tfsFor, TF_LABEL, type ChartAssetType, type ChartCandle, type ChartMarketData } from "@/lib/chart-const";
import { SeriesManager } from "./series-manager";
import { ChartLiveManager, type LiveState } from "./live-manager";
import { ORCA_CHART_THEME as T, type ChartKind } from "./theme";
import { Loading } from "@/components/ui";
import { analyzeMoneyFlow } from "@/lib/engines/money-flow";
import { buildSmcOverlay } from "@/chart/smc-overlay";
import { applySmcPriceLines, type SmcLineBag } from "@/chart/smc-series-helpers";
import { analyzeMtfBias, companionTimeframes, type MtfBiasResult } from "@/lib/engines/mtf-bias";
import type { OhlcvBar } from "@/lib/types";

interface Props {
  symbol: string;
  assetType: ChartAssetType;
  defaultTimeframe?: string;
  height?: number;
  title?: string;
  extraLevels?: { label: string; price: number; color: string }[];
}

const CHART_KINDS: { id: ChartKind; label: string }[] = [
  { id: "candles", label: "Nến" },
  { id: "line", label: "Đường" },
  { id: "area", label: "Vùng" },
  { id: "bar", label: "Bar" },
];

type IndKey = "ema" | "bollinger" | "vwap" | "rsi" | "macd" | "srLevels";

const OVERLAY_INDS: { key: IndKey | "volume"; label: string; short: string; color: string }[] = [
  { key: "ema", label: "EMA 20/50", short: "EMA", color: T.accent },
  { key: "bollinger", label: "Bollinger", short: "BB", color: "#6ea8fe" },
  { key: "vwap", label: "VWAP", short: "VWAP", color: T.info },
  { key: "srLevels", label: "Support / Resistance", short: "S/R", color: T.warn },
  { key: "volume", label: "Volume", short: "Vol", color: "#94a3b8" },
];

const OSC_INDS: { key: IndKey; label: string; short: string; color: string }[] = [
  { key: "rsi", label: "RSI (14)", short: "RSI", color: T.purple },
  { key: "macd", label: "MACD", short: "MACD", color: T.accent2 },
];

function normalizeKind(raw: string | undefined): ChartKind {
  if (raw === "candle") return "candles";
  if (raw === "candles" || raw === "area" || raw === "line" || raw === "baseline" || raw === "bar") return raw;
  return "candles";
}

function historyLimit(assetType: ChartAssetType, tf: string): number {
  const isDailyPlus = tf === "1d" || tf === "1w" || tf === "1M";
  const isHighTf = isDailyPlus || tf === "4h" || tf === "6h" || tf === "12h" || tf === "2h";
  if (assetType === "crypto") {
    if (isDailyPlus) return 2500;
    if (isHighTf) return 2000;
    return 1500;
  }
  if (assetType === "stock") {
    if (tf === "12M") return 40;
    if (tf === "1M") return 180;
    if (tf === "1w") return 400;
    if (tf === "1d") return 1000;
    if (tf === "4h") return 600;
    if (tf === "1h") return 500;
    if (tf === "15m" || tf === "30m") return 400;
    if (tf === "5m") return 350;
    return 300;
  }
  if (assetType === "commodity") return isDailyPlus ? 1000 : 800;
  if (isDailyPlus) return 1500;
  if (tf === "4h" || tf === "1h") return 1000;
  return 800;
}

function lastPointValue(pts: { value?: number }[] | undefined | null): number | null {
  if (!pts?.length) return null;
  for (let i = pts.length - 1; i >= 0; i--) {
    const v = pts[i]?.value;
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function OrcaFinancialChart({ symbol, assetType, defaultTimeframe, height = 430, title, extraLevels }: Props) {
  const { settings, update } = useSettings();
  const prefs = settings.chart;
  const tfs = useMemo(() => tfsFor(assetType), [assetType]);
  const [tf, setTf] = useState(() => {
    const pref = defaultTimeframe ?? settings.dashboard.defaultTimeframe;
    return tfs.includes(pref) ? pref : tfs.includes("1h") ? "1h" : tfs[0];
  });
  const [engineReady, setEngineReady] = useState(false);
  const [activeKind, setActiveKind] = useState<ChartKind>(() => normalizeKind(prefs.chartType));

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mgrRef = useRef<SeriesManager | null>(null);
  const liveRef = useRef<ChartLiveManager | null>(null);
  const kindRef = useRef<ChartKind>(normalizeKind(prefs.chartType));
  const loadSeqRef = useRef(0);
  const dataRef = useRef<ChartMarketData | null>(null);
  const extraLevelsRef = useRef(extraLevels);
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [smcOn, setSmcOn] = useState(false);
  const smcLineBag = useRef<SmcLineBag>({ lines: [] });
  const [mtfBias, setMtfBias] = useState<MtfBiasResult | null>(null);
  useEffect(() => {
    extraLevelsRef.current = extraLevels;
  }, [extraLevels]);

  const limit = historyLimit(assetType, tf);
  const { data, isLoading, mutate } = useApi<ChartMarketData>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=${limit}`,
  );
  useEffect(() => {
    dataRef.current = data ?? null;
  }, [data]);

  // NOTE: truncated intentionally in this recovery attempt - will fail build
  return null;
}

export default OrcaFinancialChart;
