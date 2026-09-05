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
import { tfsFor, TF_LABEL, type ChartAssetType, type ChartCandle } from "@/lib/chart-const";
import type { ChartMarketData } from "@/lib/services/chart";
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
  /** Vietnam-specific bands rendered as labelled price lines */
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

  /* ------------------------------ chart init ------------------------------- */

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
        vertLines: { color: prefs.grid ? T.grid : "transparent" },
        horzLines: { color: prefs.grid ? T.grid : "transparent" },
      },
      crosshair: { mode: prefs.crosshairMagnet ? CrosshairMode.Magnet : CrosshairMode.Normal },
      rightPriceScale: { borderColor: T.grid, mode: prefs.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, autoScale: true },
      timeScale: { borderColor: T.grid, timeVisible: true, secondsVisible: false, rightOffset: 5 },
      kineticScroll: { touch: true, mouse: true },
    });
    chartRef.current = chart;
    mgrRef.current = new SeriesManager(chart);
    mgrRef.current.createBase(kindRef.current);
    liveMgrRef.current = new ChartLiveManager();

    const ro = new ResizeObserver(() => {
      if (hostRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: hostRef.current.clientWidth,
          height: wrapRef.current?.classList.contains("orca-fs") ? Math.max(window.innerHeight - 92, 300) : height,
        });
      }
    });
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      liveMgrRef.current?.stop();
      liveMgrRef.current = null;
      mgrRef.current?.destroy();
      mgrRef.current = null;
      markersRef.current = null;
      drawLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, assetType]);

  /* live preference application */
  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: { vertLines: { color: prefs.grid ? T.grid : "transparent" }, horzLines: { color: prefs.grid ? T.grid : "transparent" } },
      crosshair: { mode: prefs.crosshairMagnet ? CrosshairMode.Magnet : CrosshairMode.Normal },
      rightPriceScale: { mode: prefs.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
    });
    mgrRef.current?.setVolumeVisible(prefs.volume);
    mgrRef.current?.setIndicatorVisible("ema", prefs.indicators.ema);
    mgrRef.current?.setIndicatorVisible("bollinger", prefs.indicators.bollinger);
    mgrRef.current?.setIndicatorVisible("vwap", prefs.indicators.vwap);
    mgrRef.current?.setIndicatorVisible("rsi", prefs.indicators.rsi);
    mgrRef.current?.setIndicatorVisible("macd", prefs.indicators.macd);
    mgrRef.current?.rebuildSrLines(null, prefs.indicators.srLevels);
    if (data) mgrRef.current?.rebuildSrLines(data.data.indicators, prefs.indicators.srLevels);
  }, [prefs, data]);

  /* ------------------------------ history data ----------------------------- */

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const chart = chartRef.current;
    const mgr = mgrRef.current;
    if (!chart || !mgr || !data) return;
    const d = data.data;
    if (!d.candles.length) return;

    mgr.setHistory(d.candles, kindRef.current);
    mgr.rebuildIndicators(d.indicators, prefs.indicators);
    mgr.rebuildSrLines(d.indicators, prefs.indicators.srLevels);
    mgr.rebuildExtraLevels(extraLevels ?? []);
    rebuildDrawings();
    lastTimeRef.current = d.candles[d.candles.length - 1].time;

    const c = mgr.base();
    if (c) {
      markersRef.current?.setMarkers([]);
      markersRef.current = attachMarkers(c, d.markers as SignalMarker[]) as unknown as { setMarkers: (m: unknown[]) => void };
    }
    if (seq === loadSeqRef.current) chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* ---------------------------- chart kind switch --------------------------- */

  useEffect(() => {
    const kind = prefs.chartType as ChartKind;
    if (kind === kindRef.current) return;
    kindRef.current = kind;
    const mgr = mgrRef.current;
    if (!mgr || !data) return;
    mgr.switchKind(kind);
    mgr.setHistory(data.data.candles, kind);
    mgr.rebuildSrLines(data.data.indicators, prefs.indicators.srLevels);
    rebuildDrawings();
    const c = mgr.base();
    if (c) markersRef.current = attachMarkers(c, data.data.markers as SignalMarker[]) as unknown as { setMarkers: (m: unknown[]) => void };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.chartType]);

  /* ------------------------------ live stream ------------------------------ */

  useEffect(() => {
    const mgr = liveMgrRef.current;
    if (!mgr) return;
    if (assetType !== "crypto") {
      mgr.stop();
      setLive({ state: "connecting", ageMs: null });
      return;
    }
    mgr.start(symbol, tf, {
      onCandle: (c, closed) => {
        const sm = mgrRef.current;
        if (!sm || c.time < lastTimeRef.current) return;
        sm.updateLive(c);
        sm.updateIncremental(c.close, c.time);
        if (closed) void mutate(); // indicators recalc once per closed candle
      },
      onResyncNeeded: () => {
        // reconnect → gap validation via authoritative history refetch
        void mutate();
      },
      onLiveState: setLive,
    });
    return () => mgr.stop();
  }, [symbol, tf, assetType, mutate]);

  /* ---------------------------- drawing tools ------------------------------ */

  const rebuildDrawings = useCallback(() => {
    const mgr = mgrRef.current;
    if (!mgr) return;
    for (const l of drawLinesRef.current) l.remove();
    drawLinesRef.current = [];
    const levels = settings.chart.drawingHorizontals[symbol] ?? [];
    for (const p of levels) {
      const line = mgr.addDrawingLine(p);
      if (line) drawLinesRef.current.push({ remove: () => mgr.base()?.removePriceLine(line) });
    }
  }, [settings.chart.drawingHorizontals, symbol]);

  useEffect(() => rebuildDrawings(), [rebuildDrawings]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: MouseEventParams) => {
      if (!drawMode || !param.point) return;
      const base = mgrRef.current?.base();
      if (!base) return;
      const price = base.coordinateToPrice(param.point.y);
      if (price == null) return;
      const cur = settings.chart.drawingHorizontals[symbol] ?? [];
      update({ chart: { ...settings.chart, drawingHorizontals: { ...settings.chart.drawingHorizontals, [symbol]: [...cur, Number(price.toFixed(8))].slice(-10) } } });
      setDrawMode(false);
    };
    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [drawMode, symbol, settings.chart, update]);

  /* --------------------------------- toolbar -------------------------------- */

  const toggleInd = (key: keyof typeof prefs.indicators) =>
    update({ chart: { ...prefs, indicators: { ...prefs.indicators, [key]: !prefs.indicators[key] } } });

  const liveBadge =
    live.state === "live" ? <Badge tone="up">● LIVE {live.ageMs != null && live.ageMs < 1000 ? "<1s" : `${Math.round((live.ageMs ?? 0) / 1000)}s`}</Badge>
    : live.state === "delayed" ? <Badge tone="warn">● DELAYED {live.ageMs != null ? `${Math.round(live.ageMs / 1000)}s` : ""}</Badge>
    : live.state === "reconnecting" ? <Badge tone="warn">● RECONNECTING</Badge>
    : assetType === "crypto" ? <Badge tone="neutral">● stream…</Badge>
    : null;

  return (
    <div ref={wrapRef} className={`panel overflow-hidden ${fullscreen ? "orca-fs" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-2.5 py-2">
        <span className="mr-1 text-[12px] font-semibold text-text-primary">{title ?? symbol}</span>
        <span className="text-[10px] text-text-muted">{meta?.source ?? "chart engine"}</span>
        {liveBadge}
        {meta?.freshness && assetType !== "crypto" && <Badge tone={meta.freshness === "LIVE" || meta.freshness === "FRESH" ? "up" : "warn"}>● {meta.freshness}</Badge>}
        <div className="seg ml-auto">
          {tfs.map((x) => (
            <button key={x} data-active={tf === x} onClick={() => setTf(x)} className="!px-1.5">{TF_LABEL[x]}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-2.5 py-1.5">
        {(["candles", "area", "line", "baseline", "bar"] as const).map((k) => (
          <Tb key={k} label={CHART_KIND_LABEL[k]} active={prefs.chartType === k} onClick={() => update({ chart: { ...prefs, chartType: k } })} icon={<LineChart className="size-3" />} />
        ))}
        <span className="mx-1 h-4 w-px bg-border-subtle" />
        <Tb label="EMA" active={prefs.indicators.ema} onClick={() => toggleInd("ema")} />
        <Tb label="BB" active={prefs.indicators.bollinger} onClick={() => toggleInd("bollinger")} />
        <Tb label="VWAP" active={prefs.indicators.vwap} onClick={() => toggleInd("vwap")} />
        <Tb label="RSI" active={prefs.indicators.rsi} onClick={() => toggleInd("rsi")} />
        <Tb label="MACD" active={prefs.indicators.macd} onClick={() => toggleInd("macd")} />
        <Tb label="S/R" active={prefs.indicators.srLevels} onClick={() => toggleInd("srLevels")} />
        <span className="mx-1 h-4 w-px bg-border-subtle" />
        <Tb label="Vol" active={prefs.volume} onClick={() => update({ chart: { ...prefs, volume: !prefs.volume } })} />
        <Tb label="Grid" active={prefs.grid} onClick={() => update({ chart: { ...prefs, grid: !prefs.grid } })} />
        <Tb label="Magnet" active={prefs.crosshairMagnet} onClick={() => update({ chart: { ...prefs, crosshairMagnet: !prefs.crosshairMagnet } })} icon={<Crosshair className="size-3" />} />
        <Tb label="Log" active={prefs.logScale} onClick={() => update({ chart: { ...prefs, logScale: !prefs.logScale } })} />
        <span className="mx-1 h-4 w-px bg-border-subtle" />
        <Tb label={drawMode ? "Hủy vẽ" : "＋H-line"} active={drawMode} onClick={() => setDrawMode(!drawMode)} icon={<Minus className="size-3" />} />
        {(prefs.drawingHorizontals[symbol]?.length ?? 0) > 0 && (
          <Tb
            label={`${prefs.drawingHorizontals[symbol].length} H`}
            onClick={() => update({ chart: { ...prefs, drawingHorizontals: { ...prefs.drawingHorizontals, [symbol]: [] } } })}
            icon={<Trash2 className="size-3" />}
          />
        )}
        <span className="mx-1 h-4 w-px bg-border-subtle" />
        <Tb label="Reset" onClick={() => chartRef.current?.timeScale().fitContent()} icon={<RotateCcw className="size-3" />} />
        <Tb
          label="Shot"
          onClick={() => {
            const canvas = hostRef.current?.querySelector("canvas");
            if (!canvas) return;
            const a = document.createElement("a");
            a.href = canvas.toDataURL("image/png");
            a.download = `orca-${symbol}-${tf}.png`;
            a.click();
          }} icon={<Camera className="size-3" />} />
        <Tb
          label={fullscreen ? "Thu nhỏ" : "Fullscreen"}
          onClick={() => {
            const el = wrapRef.current;
            if (!el) return;
            if (!fullscreen) { el.requestFullscreen?.().catch(() => {}); el.classList.add("orca-fs"); setFullscreen(true); }
            else { document.exitFullscreen?.().catch(() => {}); el.classList.remove("orca-fs"); setFullscreen(false); }
          }}
          icon={fullscreen ? <Shrink className="size-3" /> : <Expand className="size-3" />} />
      </div>

      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background-primary/60"><Loading rows={4} /></div>
        )}
        {!data && !isLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center">
            <div className="rounded-lg border border-dashed border-border-default bg-surface-elevated p-4 text-center">
              <Maximize2 className="mx-auto mb-2 size-5 text-text-muted" />
              <p className="text-[12px] text-text-secondary">Không có dữ liệu chart từ provider — hệ thống không render dữ liệu giả.</p>
              {meta && <p className="mt-1 text-[10.5px] text-text-muted">{meta.freshness}</p>}
            </div>
          </div>
        )}
        <div ref={hostRef} style={{ height: fullscreen ? "calc(100dvh - 92px)" : height }} className="w-full" />
      </div>

      {meta && (
        <div className="flex flex-wrap items-center gap-x-3 border-t border-border-subtle px-2.5 py-1.5 text-[10px] text-text-muted">
          <span>source: {meta.source}</span>
          {meta.sourceTimestamp && <span>candle cuối: {new Date(meta.sourceTimestamp).toLocaleString("vi-VN", { timeZone: settings.profile.timezone })}</span>}
          {meta.cached && <span>cache</span>}
          {meta.note && <span className="text-warning/90">{meta.note}</span>}
          <span className="ml-auto">Charts powered by TradingView Lightweight Charts™ · {fmtNum(lastTimeRef.current ? lastTimeRef.current / 1000 : 0, 0) === "0" ? "" : `${symbol} · ${TF_LABEL[tf]}`}</span>
        </div>
      )}
    </div>
  );
}

function Tb({ label, active, onClick, icon }: { label: string; active?: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors ${
        active ? "border-accent-primary/40 bg-accent-primary/12 text-accent-primary" : "border-transparent text-text-muted hover:bg-surface-elevated hover:text-text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
