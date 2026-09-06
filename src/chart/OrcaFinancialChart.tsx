"use client";

/**
 * ORCA FINANCIAL CHART — full Binance history + indicators (EMA/BB/VWAP/RSI/MACD/S-R).
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

export function OrcaFinancialChart({ symbol, assetType, defaultTimeframe, height = 430, title, extraLevels }: Props) {
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

  // Deep history for crypto (up to 1500 bars); other assets stay at 500
  const limit = assetType === "crypto" ? 1500 : 500;
  const { data, meta, isLoading } = useApi<ChartMarketData>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=${limit}`,
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
    const mgr = new SeriesManager(chart);
    mgr.createBase(kindRef.current);
    mgrRef.current = mgr;

    const ro = new ResizeObserver(() => {
      if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth });
    });
    ro.observe(hostRef.current);
    chart.applyOptions({ width: hostRef.current.clientWidth });

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

  // Apply candles + indicators + markers + volume whenever data or prefs change
  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const mgr = mgrRef.current;
    const chart = chartRef.current;
    if (!mgr || !chart || !data?.candles?.length) return;
    if (seq !== loadSeqRef.current) return;

    const payload = data; // narrowed: data is ChartMarketData here
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
  }, [data, prefs.volume, prefs.indicators, extraLevels]);

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
