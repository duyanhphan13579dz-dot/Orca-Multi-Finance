"use client";

/**
 * ORCA FINANCIAL CHART — history from Binance (crypto) via /api/v1/chart/history.
 * Types from chart-const only — never import server-only services.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, type IChartApi } from "lightweight-charts";
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

export function OrcaFinancialChart({ symbol, assetType, defaultTimeframe, height = 430, title }: Props) {
  const { settings } = useSettings();
  const prefs = settings.chart;
  const tfs = useMemo(() => tfsFor(assetType), [assetType]);
  const [tf, setTf] = useState(() => {
    const pref = defaultTimeframe ?? settings.dashboard.defaultTimeframe;
    return tfs.includes(pref) ? pref : tfs.includes("1h") ? "1h" : tfs[0];
  });

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mgrRef = useRef<SeriesManager | null>(null);
  const kindRef = useRef<ChartKind>(
    ((prefs.chartType as string) === "candle" ? "candles" : (prefs.chartType as ChartKind)) || "candles",
  );
  const loadSeqRef = useRef(0);

  // useApi unwraps { success, data } → data is ChartMarketData directly
  const { data, meta, isLoading } = useApi<ChartMarketData>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=500`,
  );

  useEffect(() => {
    if (!hostRef.current) return;
    let chart: IChartApi;
    try {
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
    } catch {
      return;
    }
    chartRef.current = chart;
    mgrRef.current = new SeriesManager(chart);
    mgrRef.current.createBase(kindRef.current);
    if (hostRef.current.clientWidth) {
      chart.applyOptions({ width: hostRef.current.clientWidth });
    }

    const ro = new ResizeObserver(() => {
      if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth });
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      try {
        chart.remove();
      } catch {
        /* noop */
      }
      chartRef.current = null;
      mgrRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const mgr = mgrRef.current;
    const chart = chartRef.current;
    const candles = data?.candles;
    if (!mgr || !chart || !candles?.length) return;
    if (seq !== loadSeqRef.current) return;
    try {
      mgr.setHistory(candles, kindRef.current);
      chart.timeScale().fitContent();
    } catch {
      /* keep page alive if series fails */
    }
  }, [data]);

  return (
    <div className="relative rounded-xl border border-border-subtle bg-background-secondary">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-[13px] font-medium text-text-primary">{title ?? symbol}</span>
        {meta?.source && (
          <span className="text-[10px] uppercase tracking-wider text-text-muted">{meta.source}</span>
        )}
        <div className="seg ml-auto">
          {tfs.map((x) => (
            <button key={x} data-active={tf === x} onClick={() => setTf(x)} type="button">
              {TF_LABEL[x] ?? x}
            </button>
          ))}
        </div>
      </div>
      <div ref={hostRef} className="w-full" style={{ height }} />
      {isLoading && !data && (
        <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/60">
          <Loading rows={3} />
        </div>
      )}
      {!isLoading && data && !data.candles?.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-text-muted">
          Không có nến từ Binance
        </div>
      )}
    </div>
  );
}

export default OrcaFinancialChart;
