"use client";

/**
 * ORCA FINANCIAL CHART — unified realtime chart for all asset classes.
 * Client-safe: types from chart-const only (never services/chart server-only).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
} from "lightweight-charts";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { tfsFor, TF_LABEL, type ChartAssetType, type ChartMarketData } from "@/lib/chart-const";
import type { Meta } from "@/lib/types";
import { SeriesManager } from "./series-manager";
import { ChartLiveManager } from "./live-manager";
import { ORCA_CHART_THEME as T, type ChartKind, type LiveState } from "./theme";
import { Badge, Loading } from "@/components/ui";

interface Props {
  symbol: string;
  assetType: ChartAssetType;
  defaultTimeframe?: string;
  height?: number;
  title?: string;
  extraLevels?: { label: string; price: number; color: string }[];
}

interface HistResp {
  data: ChartMarketData;
  meta: Meta;
}

export function OrcaFinancialChart({ symbol, assetType, defaultTimeframe, height = 430, title }: Props) {
  const { settings } = useSettings();
  const prefs = settings.chart;
  const tfs = useMemo(() => tfsFor(assetType), [assetType]);
  const [tf, setTf] = useState(() => {
    const pref = defaultTimeframe ?? settings.dashboard.defaultTimeframe;
    return tfs.includes(pref) ? pref : tfs.includes("1h") ? "1h" : tfs[0];
  });
  const [live, setLive] = useState<LiveState>({ state: "connecting", ageMs: null });

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mgrRef = useRef<SeriesManager | null>(null);
  const liveMgrRef = useRef<ChartLiveManager | null>(null);
  const lastTimeRef = useRef(0);
  const kindRef = useRef<ChartKind>((prefs.chartType as ChartKind) || "candle");
  const loadSeqRef = useRef(0);

  const { data, isLoading, mutate } = useApi<HistResp>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=320`,
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
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
    mgrRef.current = new SeriesManager(chart);
    liveMgrRef.current = new ChartLiveManager();

    const ro = new ResizeObserver(() => {
      if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth });
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      liveMgrRef.current?.stop();
      liveMgrRef.current = null;
      chart.remove();
      chartRef.current = null;
      mgrRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const mgr = mgrRef.current;
    const chart = chartRef.current;
    if (!mgr || !chart || !data?.data?.candles?.length) return;
    if (seq !== loadSeqRef.current) return;

    const candles = data.data.candles;
    lastTimeRef.current = candles[candles.length - 1]?.time ?? 0;
    mgr.setHistory(candles, kindRef.current);
    chart.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    const mgr = liveMgrRef.current;
    if (!mgr) return;
    mgr.start(
      symbol,
      tf,
      {
        onCandle: (c, closed) => {
          const sm = mgrRef.current;
          if (!sm || c.time < lastTimeRef.current) return;
          sm.updateLive(c);
          sm.updateIncremental(c.close, c.time);
          if (closed) void mutate();
        },
        onResyncNeeded: () => {
          void mutate();
        },
        onLiveState: setLive,
      },
      assetType,
    );
    return () => mgr.stop();
  }, [symbol, tf, assetType, mutate]);

  return (
    <div className="relative rounded-xl border border-border-subtle bg-background-secondary">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-[13px] font-medium text-text-primary">{title ?? symbol}</span>
        <div className="seg ml-auto">
          {tfs.map((x) => (
            <button key={x} data-active={tf === x} onClick={() => setTf(x)} type="button">
              {TF_LABEL[x] ?? x}
            </button>
          ))}
        </div>
        {live.state === "live" && <Badge tone="up">LIVE</Badge>}
        {live.state === "delayed" && <Badge tone="down">DELAYED</Badge>}
        {live.state === "reconnecting" && <Badge tone="neutral">RECONNECTING</Badge>}
      </div>
      <div ref={hostRef} className="w-full" style={{ height }} />
      {isLoading && !data && (
        <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/60">
          <Loading rows={3} />
        </div>
      )}
    </div>
  );
}

export default OrcaFinancialChart;
