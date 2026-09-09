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

const OVERLAY_INDS: {
  key: IndKey | "volume";
  label: string;
  short: string;
  color: string;
}[] = [
  { key: "ema", label: "EMA 20/50", short: "EMA", color: T.accent },
  { key: "bollinger", label: "Bollinger", short: "BB", color: "#6ea8fe" },
  { key: "vwap", label: "VWAP", short: "VWAP", color: T.info },
  { key: "srLevels", label: "Support / Resistance", short: "S/R", color: T.warn },
  { key: "volume", label: "Volume", short: "Vol", color: "#94a3b8" },
];

const OSC_INDS: {
  key: IndKey;
  label: string;
  short: string;
  color: string;
}[] = [
  { key: "rsi", label: "RSI (14)", short: "RSI", color: T.purple },
  { key: "macd", label: "MACD", short: "MACD", color: T.accent2 },
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

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mgrRef = useRef<SeriesManager | null>(null);
  const kindRef = useRef<ChartKind>(normalizeKind(prefs.chartType));
  const loadSeqRef = useRef(0);

  const limit = historyLimit(assetType, tf);
  const { data, meta, isLoading } = useApi<ChartMarketData>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=${limit}`,
  );

  const readout = useMemo(() => {
    const ind = data?.indicators;
    if (!ind) return null;
    return {
      ema20: lastPointValue(ind.ema20),
      ema50: lastPointValue(ind.ema50),
      rsi: lastPointValue(ind.rsi),
      macd: lastPointValue(ind.macd?.macd),
      signal: lastPointValue(ind.macd?.signal),
      hist: lastPointValue(ind.macd?.histogram),
    };
  }, [data]);

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

    try {
      mgr.setHistory(payload.candles, kindRef.current);
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

  const renderChip = (t: { key: IndKey | "volume"; short: string; label: string; color: string }) => {
    const on = isIndOn(t.key);
    return (
      <button
        key={t.key}
        type="button"
        title={t.label}
        onClick={() => toggleInd(t.key)}
        aria-pressed={on}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
          on
            ? "border-transparent text-text-primary"
            : "border-border-subtle text-text-muted hover:border-border-default hover:text-text-secondary"
        }`}
        style={
          on
            ? {
                background: `color-mix(in srgb, ${t.color} 16%, transparent)`,
                borderColor: `color-mix(in srgb, ${t.color} 45%, transparent)`,
                color: t.color,
              }
            : undefined
        }
      >
        <span className="size-1.5 rounded-full" style={{ background: on ? t.color : "var(--color-text-muted)" }} />
        {t.short}
      </button>
    );
  };

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

      <div className="flex flex-col gap-1.5 border-b border-border-subtle px-3 py-1.5 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="seg shrink-0">
          {CHART_KINDS.map((k) => (
            <button key={k.id} type="button" data-active={activeKind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>

        <div className="hidden h-4 w-px bg-border-subtle sm:block" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">Overlay</span>
          {OVERLAY_INDS.map(renderChip)}
          <span className="mx-1 hidden h-3.5 w-px bg-border-subtle sm:inline-block" />
          <span className="mr-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">Osc</span>
          {OSC_INDS.map(renderChip)}
        </div>
      </div>

      {/* Live indicator readout — only active series */}
      {readout && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border-subtle/80 px-3 py-1 text-[10px] text-text-muted">
          {isIndOn("ema") && readout.ema20 != null && (
            <span>
              <span style={{ color: T.accent }}>EMA20</span>{" "}
              <span className="num text-text-secondary">{readout.ema20.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            </span>
          )}
          {isIndOn("ema") && readout.ema50 != null && (
            <span>
              <span style={{ color: T.warn }}>EMA50</span>{" "}
              <span className="num text-text-secondary">{readout.ema50.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
            </span>
          )}
          {isIndOn("rsi") && readout.rsi != null && (
            <span>
              <span style={{ color: T.purple }}>RSI</span>{" "}
              <span className="num text-text-secondary">{readout.rsi.toFixed(1)}</span>
            </span>
          )}
          {isIndOn("macd") && readout.macd != null && (
            <span>
              <span style={{ color: T.accent2 }}>MACD</span>{" "}
              <span className="num text-text-secondary">{readout.macd.toPrecision(3)}</span>
              {readout.hist != null && (
                <span className={readout.hist >= 0 ? " text-positive" : " text-negative"}>
                  {" "}
                  hist {readout.hist.toPrecision(3)}
                </span>
              )}
            </span>
          )}
        </div>
      )}

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
