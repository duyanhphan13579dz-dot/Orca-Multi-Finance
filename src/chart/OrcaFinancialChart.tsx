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

type StockRange = "1D" | "1W" | "1M" | "1Y";

const STOCK_RANGES: { id: StockRange; label: string; timeframe: string; limit: number }[] = [
  { id: "1D", label: "1D", timeframe: "5m", limit: 110 },
  { id: "1W", label: "1W", timeframe: "1h", limit: 80 },
  { id: "1M", label: "1M", timeframe: "1d", limit: 35 },
  { id: "1Y", label: "1Y", timeframe: "1w", limit: 60 },
];

function stockRangeForTimeframe(timeframe: string): StockRange {
  if (timeframe === "5m" || timeframe === "15m" || timeframe === "1h") return "1D";
  if (timeframe === "1w") return "1Y";
  if (timeframe === "1d") return "1M";
  return "1M";
}

type IndKey =
  | "ema"
  | "ma10"
  | "ma20"
  | "ma50"
  | "ma100"
  | "ma200"
  | "bollinger"
  | "vwap"
  | "rsi"
  | "macd"
  | "srLevels";

const OVERLAY_INDS: { key: IndKey | "volume"; label: string; short: string; color: string }[] = [
  { key: "ema", label: "EMA 20/50", short: "EMA", color: T.accent },
  { key: "ma10", label: "MA 10", short: "MA10", color: "#f59e0b" },
  { key: "ma20", label: "MA 20", short: "MA20", color: "#38bdf8" },
  { key: "ma50", label: "MA 50", short: "MA50", color: "#a78bfa" },
  { key: "ma100", label: "MA 100", short: "MA100", color: "#f472b6" },
  { key: "ma200", label: "MA 200", short: "MA200", color: "#f87171" },
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
  const [stockRange, setStockRange] = useState<StockRange>(() =>
    stockRangeForTimeframe(defaultTimeframe ?? settings.dashboard.defaultTimeframe),
  );
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

  const limit = assetType === "stock"
    ? STOCK_RANGES.find((range) => range.id === stockRange)?.limit ?? 35
    : historyLimit(assetType, tf);
  const { data, isLoading, mutate } = useApi<ChartMarketData>(
    `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${tf}&limit=${limit}`,
  );
  useEffect(() => {
    dataRef.current = data ?? null;
  }, [data]);

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
        hostRef.current.innerHTML = "";

        chart = createChart(hostRef.current, {
          height,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: T.text,
            fontSize: 11,
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          },
          grid: prefs.grid
            ? { vertLines: { color: T.grid }, horzLines: { color: T.grid } }
            : { vertLines: { visible: false }, horzLines: { visible: false } },
          crosshair: { mode: prefs.crosshairMagnet ? CrosshairMode.Magnet : CrosshairMode.Normal },
          rightPriceScale: {
            borderVisible: false,
            mode: prefs.logScale ? 1 : 0,
            scaleMargins: { top: 0.08, bottom: 0.18 },
          },
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
        /* */
      }
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      try {
        chart?.remove();
        if (hostRef.current) hostRef.current.innerHTML = "";
      } catch {
        /* */
      }
      chartRef.current = null;
      mgrRef.current = null;
      setEngineReady(false);
    };
  }, [height, prefs.grid, prefs.crosshairMagnet, prefs.logScale]);

  useEffect(() => {
    const k = normalizeKind(prefs.chartType);
    if (k !== kindRef.current) {
      kindRef.current = k;
      setActiveKind(k);
      mgrRef.current?.setKind(k);
    }
  }, [prefs.chartType]);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const mgr = mgrRef.current;
    const chart = chartRef.current;
    if (!engineReady || !mgr || !chart || !data?.candles?.length) return;
    if (seq !== loadSeqRef.current) return;

    try {
      const safe = data.candles
        .filter(
          (c) =>
            c &&
            Number.isFinite(c.time) &&
            c.time > 0 &&
            Number.isFinite(c.close) &&
            c.close > 0 &&
            Number.isFinite(c.open) &&
            c.open > 0 &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low),
        )
        .map((c) => {
          const hi = Math.max(c.open, c.high, c.low, c.close);
          const lo = Math.min(c.open, c.high, c.low, c.close);
          return lo > 0 && hi >= lo ? { ...c, high: hi, low: lo } : null;
        })
        .filter((c): c is NonNullable<typeof c> => c != null);
      if (!safe.length) return;
      mgr.setHistory(safe, kindRef.current);
      mgr.setVolumeVisible(prefs.volume !== false);

      const vis = {
        ema: prefs.indicators?.ema !== false,
        ma10: !!prefs.indicators?.ma10,
        ma20: !!prefs.indicators?.ma20,
        ma50: !!prefs.indicators?.ma50,
        ma100: !!prefs.indicators?.ma100,
        ma200: !!prefs.indicators?.ma200,
        bollinger: !!prefs.indicators?.bollinger,
        vwap: prefs.indicators?.vwap !== false,
        rsi: prefs.indicators?.rsi !== false,
        macd: prefs.indicators?.macd !== false,
        srLevels: prefs.indicators?.srLevels !== false,
      };
      mgr.rebuildIndicators(data.indicators ?? null, vis);
      mgr.rebuildSrLines(data.indicators ?? null, vis.srLevels);
      if (data.markers?.length) mgr.applyMarkers(data.markers);
      if (extraLevels?.length) mgr.rebuildExtraLevels(extraLevels);
      chart.timeScale().fitContent();
    } catch {
      /* */
    }
  }, [data, prefs.volume, prefs.indicators, extraLevels, engineReady]);

  useEffect(() => {
    const mgr = mgrRef.current;
    if (!engineReady || !mgr || !data?.candles?.length) return;
    try {
      const series = mgr.getCandleSeries?.() ?? null;
      if (!smcOn) {
        applySmcPriceLines(series, smcLineBag.current, []);
        return;
      }
      const bars: OhlcvBar[] = data.candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
      const analysis = analyzeMoneyFlow(bars);
      const overlay = buildSmcOverlay(analysis);
      applySmcPriceLines(series, smcLineBag.current, overlay.levels);
      if (overlay.markers.length) mgr.applyMarkers(overlay.markers as any);
    } catch {
      /* */
    }
  }, [data, smcOn, engineReady]);

  useEffect(() => {
    let cancelled = false;
    const companions = companionTimeframes(tf, tfs);
    if (!symbol || companions.length < 2) {
      setMtfBias(null);
      return;
    }
    (async () => {
      try {
        const seriesByTf: Record<string, OhlcvBar[]> = {};
        await Promise.all(
          companions.map(async (t) => {
            const lim = historyLimit(assetType, t);
            const url = `/api/v1/chart/history?symbol=${encodeURIComponent(symbol)}&assetType=${assetType}&timeframe=${t}&limit=${Math.min(lim, 400)}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const json = await res.json();
            const candles =
              (json?.data?.candles as ChartCandle[] | undefined) ??
              (json?.candles as ChartCandle[] | undefined);
            if (!candles?.length) return;
            seriesByTf[t] = candles.map((c) => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume ?? 0,
            }));
          }),
        );
        if (cancelled) return;
        if (Object.keys(seriesByTf).length) setMtfBias(analyzeMtfBias(seriesByTf));
        else setMtfBias(null);
      } catch {
        if (!cancelled) setMtfBias(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, tf, assetType, tfs]);

  useEffect(() => {
    const supportsLive = assetType === "crypto" || assetType === "stock";
    if (!engineReady || !supportsLive || !symbol) {
      liveRef.current?.stop();
      setLiveState(null);
      return;
    }

    if (!liveRef.current) liveRef.current = new ChartLiveManager();
    const live = liveRef.current;

    live.start(
      symbol,
      tf,
      {
        onCandle: (c: ChartCandle, closed: boolean) => {
          const mgr = mgrRef.current;
          if (!mgr) return;
          try {
            let candle = c;
            const hist = dataRef.current?.candles;
            const lastHist = hist?.length ? hist[hist.length - 1] : null;
            if (assetType === "stock" && lastHist && lastHist.close > 0 && c.close > 0) {
              const ratio = c.close / lastHist.close;
              if (ratio > 50) {
                const factor = ratio > 500 ? 1_000 : ratio;
                candle = {
                  ...c,
                  open: c.open / factor,
                  high: c.high / factor,
                  low: c.low / factor,
                  close: c.close / factor,
                };
              } else if (ratio < 1 / 50) {
                const factor = ratio < 1 / 500 ? 1_000 : Math.round(1 / ratio);
                candle = {
                  ...c,
                  open: c.open * factor,
                  high: c.high * factor,
                  low: c.low * factor,
                  close: c.close * factor,
                };
              }
            }
            mgr.updateLive(candle);
            if (candle.close != null && Number.isFinite(candle.close)) {
              mgr.updateIncremental(candle.close, candle.time);
            }
            if (closed) void mutate();
          } catch {
            /* */
          }
        },
        onResyncNeeded: () => {
          void mutate();
        },
        onLiveState: (s) => setLiveState(s),
      },
      assetType,
    );

    return () => {
      live.stop();
    };
  }, [symbol, tf, assetType, engineReady, mutate]);

  const setKind = (kind: ChartKind) => {
    if (kind === kindRef.current) return;
    kindRef.current = kind;
    setActiveKind(kind);
    mgrRef.current?.setKind(kind);
    update({ chart: { ...settings.chart, chartType: kind } });
  };

  const selectStockRange = (range: (typeof STOCK_RANGES)[number]) => {
    setStockRange(range.id);
    setTf(range.timeframe);
  };

  const toggleInd = (key: IndKey | "volume") => {
    const mgr = mgrRef.current;
    if (key === "volume") {
      const next = !settings.chart.volume;
      mgr?.setVolumeVisible(next);
      update({ chart: { ...settings.chart, volume: next } });
      return;
    }
    const ind = settings.chart.indicators;
    const offByDefault = key === "bollinger" || key.startsWith("ma");
    const cur = offByDefault ? !!ind[key as keyof typeof ind] : ind[key as keyof typeof ind] !== false;
    const next = !cur;
    const nextInd = { ...ind, [key]: next };

    // Rebuild immediately so MA/BB series are created on first enable (not only visibility flip).
    if (mgr && key !== "srLevels") {
      const vis = {
        ema: nextInd.ema !== false,
        ma10: !!nextInd.ma10,
        ma20: !!nextInd.ma20,
        ma50: !!nextInd.ma50,
        ma100: !!nextInd.ma100,
        ma200: !!nextInd.ma200,
        bollinger: !!nextInd.bollinger,
        vwap: nextInd.vwap !== false,
        rsi: nextInd.rsi !== false,
        macd: nextInd.macd !== false,
        srLevels: nextInd.srLevels !== false,
      };
      try {
        mgr.rebuildIndicators(dataRef.current?.indicators ?? null, vis);
      } catch {
        mgr.setIndicatorVisible(key as Parameters<SeriesManager["setIndicatorVisible"]>[0], next);
      }
    }
    if (key === "srLevels") {
      mgr?.rebuildSrLines(dataRef.current?.indicators ?? null, !!nextInd.srLevels);
    }
    update({ chart: { ...settings.chart, indicators: nextInd } });
  };

  const isIndOn = (key: IndKey | "volume") => {
    if (key === "volume") return prefs.volume !== false;
    if (key === "bollinger" || key.startsWith("ma"))
      return !!prefs.indicators?.[key as keyof typeof prefs.indicators];
    return prefs.indicators?.[key as keyof typeof prefs.indicators] !== false;
  };

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
        style={on ? { backgroundColor: `${t.color}22`, borderColor: `${t.color}55`, color: t.color } : undefined}
      >
        <span className="size-1.5 rounded-full" style={{ background: on ? t.color : "#64748b" }} />
        {t.short}
      </button>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-background-secondary">
      <div className="chart-toolbar-row border-b border-border-subtle">
        <div className="chart-control-group min-w-0">
          {title ? <span className="truncate text-[12px] font-semibold text-text-primary">{title}</span> : null}
          {liveState ? (
            <span className={`chart-live-pill chart-live-pill--${liveState.state}`}>
              <span className="chart-live-dot" aria-hidden="true" />
              {liveState.state === "live" ? "● live" : `○ ${liveState.state}`}
            </span>
          ) : null}
        </div>
        <div className="chart-control-group ml-auto">
          <span className="chart-control-label">Khoảng xem</span>
          <div className="seg" role="group" aria-label="Khoảng thời gian biểu đồ">
            {assetType === "stock"
              ? STOCK_RANGES.map((range) => (
                  <button key={range.id} data-active={stockRange === range.id} onClick={() => selectStockRange(range)} type="button" aria-pressed={stockRange === range.id}>
                    {range.label}
                  </button>
                ))
              : tfs.map((x) => (
                  <button key={x} data-active={tf === x} onClick={() => setTf(x)} type="button" aria-pressed={tf === x}>
                    {TF_LABEL[x] ?? x}
                  </button>
                ))}
          </div>
        </div>
      </div>

      <div className="chart-toolbar-row">
        <div className="chart-control-group min-w-0 flex-1">
          <span className="chart-control-label">Chỉ báo</span>
          <div className="chart-ind-row" aria-label="Bộ chỉ báo biểu đồ">
            <span className="text-[9px] font-semibold tracking-wide text-text-muted opacity-80">Overlay</span>
            {OVERLAY_INDS.map(renderChip)}
            <button
              type="button"
              title="SMC / ICT / VSA overlay"
              onClick={() => setSmcOn((v) => !v)}
              aria-pressed={smcOn}
              data-active={smcOn}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 text-[10.5px] font-medium text-text-secondary transition-colors data-[active=true]:border-accent/40 data-[active=true]:bg-accent/10 data-[active=true]:text-accent"
            >
              SMC/ICT
            </button>
            <span className="mx-0.5 hidden h-3 w-px shrink-0 bg-border-subtle sm:inline-block" aria-hidden />
            <span className="text-[9px] font-semibold tracking-wide text-text-muted opacity-80">Osc</span>
            {OSC_INDS.map(renderChip)}
          </div>
        </div>

        <div className="chart-control-group">
          <span className="chart-control-label">Dạng</span>
          <div className="seg" role="group" aria-label="Dạng biểu đồ">
            {CHART_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                data-active={activeKind === k.id}
                onClick={() => setKind(k.id)}
                aria-pressed={activeKind === k.id}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mtfBias && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-[11px]">
          <span className="font-semibold text-text-muted">MTF</span>
          <span
            className={
              mtfBias.bias === "bullish"
                ? "text-positive"
                : mtfBias.bias === "bearish"
                  ? "text-negative"
                  : "text-text-secondary"
            }
          >
            {mtfBias.summary ?? mtfBias.bias}
          </span>
        </div>
      )}

      <div className="relative" style={{ height }}>
        <div ref={hostRef} className="h-full w-full" />
        {isLoading && !data?.candles?.length && (
          <div className="absolute inset-0 flex items-center justify-center bg-background-secondary/60">
            <Loading rows={3} />
          </div>
        )}
        {!isLoading && data && !data.candles?.length && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-text-muted">
            Không có dữ liệu nến
          </div>
        )}
      </div>

      {readout && (
        <div className="flex flex-wrap gap-3 border-t border-border-subtle px-3 py-1.5 text-[10px] text-text-muted">
          {readout.ema20 != null && <span>EMA20 {readout.ema20.toFixed(2)}</span>}
          {readout.ema50 != null && <span>EMA50 {readout.ema50.toFixed(2)}</span>}
          {readout.rsi != null && <span>RSI {readout.rsi.toFixed(1)}</span>}
          {readout.macd != null && <span>MACD {readout.macd.toFixed(3)}</span>}
        </div>
      )}
    </div>
  );
}

export default OrcaFinancialChart;
