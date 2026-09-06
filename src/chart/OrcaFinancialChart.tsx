"use client";

/**
 * ORCA FINANCIAL CHART — unified realtime chart for all asset classes.
 * Rendering is delegated to official Lightweight Charts v5; data flows ONLY
 * from the internal Chart Data Engine (validated, normalized), live updates
 * via the centralized subscription manager + SSE event bus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode,
  type IChartApi, type MouseEventParams,
} from "lightweight-charts";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { tfsFor, TF_LABEL, type ChartAssetType, type ChartCandle, type ChartMarketData } from "@/lib/chart-const";
import type { Meta } from "@/lib/types";
import { SeriesManager } from "./series-manager";
import { ChartLiveManager } from "./live-manager";
import { attachMarkers } from "./markers";
import { CHART_KIND_LABEL, ORCA_CHART_THEME as T, type ChartKind, type LiveState, type SignalMarker } from "./theme";
import { Badge, fmtNum, Loading } from "@/components/ui";
import { Camera, Crosshair, Expand, LineChart, Maximize2, Minus, RotateCcw, Shrink, Trash2 } from "lucide-react";

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

export function OrcaFinancialChart({ symbol, assetType, defaultTimeframe, height = 430, title, extraLevels }: Props) {
  const { settings, update } = useSettings();
  const prefs = settings.chart;
  const tfs = useMemo(() => tfsFor(assetType), [assetType]);
  const [tf, setTf] = useState(() => {
    const pref = defaultTimeframe ?? settings.dashboard.defaultTimeframe;
    return tfs.includes(pref) ? pref : (tfs.includes("1h") ? "1h" : tfs[0]);
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [live, setLive] = useState<LiveState>({ state: "connecting", ageMs: null });

  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mgrRef = useRef<SeriesManager | null>(null);
  const liveMgrRef = useRef<ChartLiveManager | null>(null);
  const markersRef = useRef<{ setMarkers: (m: unknown[]) => void } | null>(null);
  const drawLinesRef = useRef<{ remove: () => void }[]>([]);
  const lastTimeRef = useRef(0);
  const kindRef = useRef<ChartKind>(prefs.chartType as ChartKind);
  const loadSeqRef = useRef(0);

  const { data, meta, isLoading, mutate } = useApi<HistResp>(
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
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: T.grid },
        horzLines: { color: T.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.18 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
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
    mgr.setKind(kindRef.current);
    mgr.setData(candles);
    if (data.data.indicators) mgr.setIndicators(data.data.indicators);
    if (data.data.markers?.length) {
      markersRef.current = attachMarkers(chart, mgr.mainSeries(), data.data.markers as SignalMarker[]);
    }
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

  const rebuildDrawings = useCallback(() => {
    const mgr = mgrRef.current;
    if (!mgr) return;
    for (const l of drawLinesRef.current) l.remove();
    drawLinesRef.current = [];
    const levels = settings.chart.drawingHorizontals[symbol] ?? [];
    for (const lv of levels) {
      const pl = mgr.mainSeries()?.createPriceLine?.({
        price: lv.price,
        color: lv.color ?? T.line,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: lv.label,
      });
      if (pl) drawLinesRef.current.push(pl);
    }
    if (extraLevels) {
      for (const lv of extraLevels) {
        const pl = mgr.mainSeries()?.createPriceLine?.({
          price: lv.price,
          color: lv.color,
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: lv.label,
        });
        if (pl) drawLinesRef.current.push(pl);
      }
    }
  }, [settings.chart.drawingHorizontals, symbol, extraLevels]);

  useEffect(() => {
    rebuildDrawings();
  }, [rebuildDrawings, data]);

  return (
    <div ref={wrapRef} className={`relative rounded-xl border border-border-subtle bg-background-secondary ${fullscreen ? "fixed inset-0 z-50 rounded-none" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-[13px] font-medium text-text-primary">{title ?? symbol}</span>
        <div className="seg ml-auto">
          {tfs.map((x) => (
            <button key={x} data-active={tf === x} onClick={() => setTf(x)}>
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
