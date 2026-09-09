"use client";

/**
 * ORCA FINANCIAL CHART — history + toggleable indicators (EMA/BB/VWAP/RSI/MACD/S-R).
 * Types from chart-const only — never import server-only services.
 * lightweight-charts is dynamic-imported so the main bundle stays light until mount.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { tfsFor, TF_LABEL, type ChartAssetType, type ChartMarketData } from "@/lib/chart-const";
import { SeriesManager } from "./series-manager";
import { ORCA_CHART_THEME as T, type ChartKind } from "./theme";
import { Loading } from "@/components/ui";

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

const IND_TOGGLES: { key: IndKey | "volume"; label: string }[] = [
  { key: "ema", label: "EMA" },
  { key: "bollinger", label: "BB" },
  { key: "vwap", label: "VWAP" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "srLevels", label: "S/R" },
  { key: "volume", label: "Vol" },
];

function normalizeKind(raw: string | undefined): ChartKind {
  if (raw === "candle") return "candles";
  if (raw === "candles" || raw === "area" || raw === "line" || raw === "baseline" || raw === "bar") return raw;
  return "candles";
}

/** Prefer deeper history on higher TFs; keep intraday lighter for performance. */
function historyLimit(assetType: ChartAssetType, tf: string): number {
  const isDailyPlus = tf === "1d" || tf === "1w" || tf === "1M";
  const isHighTf = isDailyPlus || tf === "4h" || tf === "6h" || tf === "12h" || tf === "2h";
  if (assetType === "crypto") {
    if (isDailyPlus) return 2500;
    if (isHighTf) return 2000;
    return 1500;
  }
  if (assetType === "stock") return isDailyPlus ? 1200 : 800;
  if (assetType === "commodity") return isDailyPlus ? 1000 : 800;
  // forex
  if (isDailyPlus) return 1500;
  if (tf === "4h" || tf === "1h") return 1000;
  return 800;
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

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mgrRef = useRef<SeriesManager | null>(null);
  const kindRef = useRef<ChartKind>(normalizeKind(prefs.chartType));
  const loadSeqRef = useRef(0);

  const limit = historyLimit(assetType, tf);
  const { data, meta, isLoading } = useApi<ChartMarketData>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=${limit}`,
  );

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let chart: IChartApi | null = null;

    (async () => {
      try {
        const { createChart, ColorType, CrosshairMode } = await import("lightweight-charts");
        if (cancelled || !hostRef.current) return;

        chart = createChart(hostRef.current, {
          height,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: T.text,
            fontSize: 11,
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          },
          grid: {
            vertLines: { color: T.grid },
            horzLines: { color: T.grid },
          },
          crosshair: { mode: CrosshairMode.Normal },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.18 } },
          timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
        });

        chartRef.current = chart;
        const mgr = new SeriesManager(chart);
        mgr.createBase(kindRef.current);
        mgrRef.current = mgr;

        ro = new ResizeObserver(() => {
          if (hostRef.current && chart) chart.applyOptions({ width: hostRef.current.clientWidth, height });
        });
        ro.observe(hostRef.current);
        chart.applyOptions({ width: hostRef.current.clientWidth });
        if (!cancelled) setEngineReady(true);
      } catch {
        /* keep page alive */
      }
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      try {
        chart?.remove();
      } catch {
        /* noop */
      }
      chartRef.current = null;
      mgrRef.current = null;
      setEngineReady(false);
    };
  }, [height]);

  useEffect(() => {
    kindRef.current = normalizeKind(prefs.chartType);
  }, [prefs.chartType]);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const mgr = mgrRef.current;
    const chart = chartRef.current;
    if (!engineReady || !mgr || !chart || !data?.candles?.length) return;
    if (seq !== loadSeqRef.current) return;

    const payload = data;
    const candles = payload.candles;

    try {
      mgr.setHistory(candles, kindRef.current);
      mgr.setVolumeVisible(prefs.volume !== false);

      const vis = {
        ema: prefs.indicators?.ema !== false,
        bollinger: !!prefs.indicators?.bollinger,
        vwap: prefs.indicators?.vwap !== false,
        rsi: prefs.indicators?.rsi !== false,
        macd: prefs.indicators?.macd !== false,
        srLevels: prefs.indicators?.srLevels !== false,
      };
      mgr.rebuildIndicators(payload.indicators ?? null, vis);
      mgr.rebuildSrLines(payload.indicators ?? null, vis.srLevels);
      if (payload.markers?.length) mgr.applyMarkers(payload.markers);
      if (extraLevels?.length) mgr.rebuildExtraLevels(extraLevels);
      chart.timeScale().fitContent();
    } catch {
      /* keep page alive if series fails */
    }
  }, [data, prefs.volume, prefs.indicators, prefs.chartType, extraLevels, engineReady]);

  const setKind = (kind: ChartKind) => {
    update({
      chart: {
        ...settings.chart,
        chartType: kind,
      },
    });
  };

  const toggleInd = (key: IndKey | "volume") => {
    if (key === "volume") {
      update({ chart: { ...settings.chart, volume: !settings.chart.volume } });
      return;
    }
    const ind = settings.chart.indicators;
    update({
      chart: {
        ...settings.chart,
        indicators: { ...ind, [key]: !ind[key] },
      },
    });
  };

  const isIndOn = (key: IndKey | "volume") => {
    if (key === "volume") return prefs.volume !== false;
    if (key === "bollinger") return !!prefs.indicators?.bollinger;
    return prefs.indicators?.[key] !== false;
  };

  const activeKind = normalizeKind(prefs.chartType);

  return (
    <div className="relative rounded-xl border border-border-subtle bg-background-secondary">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-[13px] font-medium text-text-primary">{title ?? symbol}</span>
        {meta?.source && (
          <span className="text-[10px] uppercase tracking-wider text-text-muted">{meta.source}</span>
        )}
        {data?.candles?.length ? (
          <span className="text-[10px] text-text-muted">{data.candles.length} nến</span>
        ) : null}
        <div className="seg ml-auto">
          {tfs.map((x) => (
            <button key={x} data-active={tf === x} onClick={() => setTf(x)} type="button">
              {TF_LABEL[x] ?? x}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-3 py-1.5">
        <div className="seg">
          {CHART_KINDS.map((k) => (
            <button key={k.id} type="button" data-active={activeKind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="mx-1 hidden h-4 w-px bg-border-subtle sm:block" />
        <div className="flex flex-wrap gap-1">
          {IND_TOGGLES.map((t) => {
            const on = isIndOn(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toggleInd(t.key)}
                className={`rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                  on
                    ? "border-accent-primary/45 bg-accent-primary/12 text-accent-primary"
                    : "border-border-subtle text-text-muted hover:border-border-default hover:text-text-secondary"
                }`}
                aria-pressed={on}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={hostRef} className="w-full" style={{ height }} />
      {(isLoading && !data) || !engineReady ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/60">
          <Loading rows={3} />
        </div>
      ) : null}
      {!isLoading && data && !data.candles?.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-text-muted">
          Không có dữ liệu nến
        </div>
      )}
    </div>
  );
}

export default OrcaFinancialChart;
