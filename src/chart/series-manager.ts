/**
 * SERIES MANAGER — official Lightweight Charts v5 API.
 * Owns base series (5 chart kinds), volume, indicator series across native
 * panes (price 0 / rsi 1 / macd 2), S/R price lines and incremental updates.
 * Types from chart-const only — never import server-only services.
 *
 * Performance: all base kinds are created once and kept in memory.
 * Switching Nến/Đường/Vùng/Bar only toggles `visible` — no remove/add/setData.
 *
 * Last-bar stability: sanitize OHLC, reject time-regression, merge same-bucket,
 * coalesce live ticks via rAF (smooth, not laggy).
 */
import {
  AreaSeries, BarSeries, BaselineSeries, CandlestickSeries, HistogramSeries, LineSeries,
  LineStyle, type IChartApi, type ISeriesApi, type IPriceLine, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { ChartIndicators, ChartCandle, ChartSignalMarker } from "@/lib/chart-const";
import type { ChartKind } from "./theme";
import { ORCA_CHART_THEME as T } from "./theme";
import { attachMarkers } from "./markers";

/** Accept ms or sec timestamps without double-dividing. */
export const toSec = (t: number): Time => {
  if (!Number.isFinite(t) || t <= 0) return 0 as UTCTimestamp as Time;
  return Math.floor(t > 1e11 ? t / 1000 : t) as UTCTimestamp as Time;
};

/** Fix OHLC consistency so lightweight-charts never rejects the bar. */
export function sanitizeCandle(c: ChartCandle): ChartCandle | null {
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  const time = Number(c.time);
  if (!Number.isFinite(time) || time <= 0) return null;
  if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) return null;
  const hi = Math.max(open, high, low, close);
  const lo = Math.min(open, high, low, close);
  const vol = Number(c.volume);
  return {
    time,
    open,
    high: hi,
    low: lo,
    close,
    volume: Number.isFinite(vol) && vol >= 0 ? vol : 0,
  };
}

type IndicatorKey = "ema20" | "ema50" | "bbU" | "bbM" | "bbL" | "vwap" | "rsi" | "macdM" | "macdS" | "macdH";

type AnyBase =
  | ISeriesApi<"Candlestick">
  | ISeriesApi<"Area">
  | ISeriesApi<"Line">
  | ISeriesApi<"Baseline">
  | ISeriesApi<"Bar">;

const ALL_KINDS: ChartKind[] = ["candles", "area", "line", "baseline", "bar"];

export class SeriesManager {
  private baseSeries: Partial<Record<ChartKind, AnyBase>> = {};
  private volumeSeries: ISeriesApi<"Histogram"> | null = null;
  private indicators = new Map<IndicatorKey, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>();
  private srLines: { line: IPriceLine; kind: "s" | "r"; indicatorRef: ISeriesApi<"Candlestick"> }[] = [];
  private emaState = new Map<"ema20" | "ema50", { k: number; last: number; time: number }>();
  private activeKind: ChartKind = "candles";
  private lastCandles: ChartCandle[] = [];
  private lastBarSec: number | null = null;
  private lastBarOhlc: { open: number; high: number; low: number; close: number; volume: number } | null = null;
  private liveRaf: number | null = null;
  private pendingLive: ChartCandle | null = null;

  constructor(private chart: IChartApi) {}

  createBase(kindToShow: ChartKind) {
    this.activeKind = kindToShow;
    for (const k of ALL_KINDS) {
      if (this.baseSeries[k]) continue;
      switch (k) {
        case "candles":
          this.baseSeries.candles = this.chart.addSeries(
            CandlestickSeries,
            {
              upColor: T.up,
              downColor: T.down,
              wickUpColor: T.up,
              wickDownColor: T.down,
              borderVisible: false,
              priceLineVisible: true,
              priceLineColor: T.accent,
              priceLineStyle: LineStyle.Dotted,
              visible: k === kindToShow,
            },
            0,
          );
          break;
        case "area":
          this.baseSeries.area = this.chart.addSeries(
            AreaSeries,
            {
              lineColor: T.accent,
              topColor: "rgba(76,141,255,0.20)",
              bottomColor: "rgba(76,141,255,0.01)",
              lineWidth: 2,
              visible: k === kindToShow,
            },
            0,
          );
          break;
        case "line":
          this.baseSeries.line = this.chart.addSeries(
            LineSeries,
            { color: T.accent, lineWidth: 2, visible: k === kindToShow },
            0,
          );
          break;
        case "baseline":
          this.baseSeries.baseline = this.chart.addSeries(
            BaselineSeries,
            {
              topLineColor: T.up,
              bottomLineColor: T.down,
              topFillColor1: "rgba(46,194,126,0.2)",
              topFillColor2: "rgba(46,194,126,0.02)",
              bottomFillColor1: "rgba(238,95,117,0.2)",
              bottomFillColor2: "rgba(238,95,117,0.02)",
              baseValue: { type: "price", price: 0 },
              visible: k === kindToShow,
            },
            0,
          );
          break;
        case "bar":
          this.baseSeries.bar = this.chart.addSeries(
            BarSeries,
            { upColor: T.up, downColor: T.down, visible: k === kindToShow },
            0,
          );
          break;
      }
    }
    this.applyKindVisibility(kindToShow);
  }

  setKind(kind: ChartKind) {
    if (kind === this.activeKind) return;
    if (!this.baseSeries[kind]) this.createBase(kind);
    this.applyKindVisibility(kind);
    this.activeKind = kind;
  }

  private applyKindVisibility(kind: ChartKind) {
    for (const k of ALL_KINDS) {
      this.baseSeries[k]?.applyOptions({ visible: k === kind });
    }
  }

  private base() {
    return (this.baseSeries.candles || this.baseSeries.bar) as ISeriesApi<"Candlestick"> | undefined;
  }

  private ensureVolume() {
    if (!this.volumeSeries) {
      this.volumeSeries = this.chart.addSeries(
        HistogramSeries,
        { priceScaleId: "volume", priceFormat: { type: "volume" } },
        0,
      );
      this.chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    }
    return this.volumeSeries;
  }

  setHistory(candles: ChartCandle[], kind: ChartKind) {
    if (!this.baseSeries.candles && !this.baseSeries.area && !this.baseSeries.line && !this.baseSeries.bar && !this.baseSeries.baseline) {
      this.createBase(((kind as string) === "candle" ? "candles" : kind) as ChartKind);
    } else if (kind !== this.activeKind) {
      this.setKind(kind);
    }

    const byTime = new Map<number, ChartCandle>();
    for (const raw of candles) {
      const c = sanitizeCandle(raw);
      if (!c) continue;
      const sec = toSec(c.time) as number;
      if (!sec) continue;
      byTime.set(sec, { ...c, time: c.time > 1e11 ? c.time : c.time * 1000 });
    }
    const sorted = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
    const clean = sorted.map(([, c]) => c);
    this.lastCandles = clean;

    if (clean.length) {
      const last = clean[clean.length - 1]!;
      this.lastBarSec = toSec(last.time) as number;
      this.lastBarOhlc = {
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume ?? 0,
      };
    } else {
      this.lastBarSec = null;
      this.lastBarOhlc = null;
    }

    const ls = clean.map((c) => ({
      time: toSec(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const vs = clean.map((c) => ({ time: toSec(c.time), value: c.close }));

    try {
      this.baseSeries.candles?.setData(ls);
      this.baseSeries.bar?.setData(ls);
      this.baseSeries.area?.setData(vs);
      this.baseSeries.line?.setData(vs);
      this.baseSeries.baseline?.setData(vs);

      const hasVol = clean.some((c) => (c.volume ?? 0) > 0);
      if (hasVol) {
        this.ensureVolume().setData(
          clean.map((c) => ({
            time: toSec(c.time),
            value: c.volume ?? 0,
            color: c.close >= c.open ? "rgba(46,194,126,0.30)" : "rgba(238,95,117,0.30)",
          })),
        );
      } else if (this.volumeSeries) {
        this.volumeSeries.setData([]);
      }
    } catch {
      /* keep chart alive on setData edge cases */
    }
  }

  setVolumeVisible(on: boolean) {
    this.volumeSeries?.applyOptions({ visible: on });
  }

  /** Coalesce live ticks to one paint per frame — smooth, not laggy. */
  updateLive(c: ChartCandle) {
    const clean = sanitizeCandle(c);
    if (!clean) return;
    this.pendingLive = clean;
    if (this.liveRaf != null) return;
    if (typeof requestAnimationFrame === "function") {
      this.liveRaf = requestAnimationFrame(() => {
        this.liveRaf = null;
        const p = this.pendingLive;
        this.pendingLive = null;
        if (p) this.applyLiveBar(p);
      });
    } else {
      this.pendingLive = null;
      this.applyLiveBar(clean);
    }
  }

  private applyLiveBar(c: ChartCandle) {
    const t = toSec(c.time) as number;
    if (!t) return;
    if (this.lastBarSec != null && t < this.lastBarSec) return;

    let open = c.open;
    let high = c.high;
    let low = c.low;
    let close = c.close;
    let volume = c.volume ?? 0;

    if (this.lastBarSec != null && t === this.lastBarSec && this.lastBarOhlc) {
      open = this.lastBarOhlc.open;
      high = Math.max(this.lastBarOhlc.high, high, close, open);
      low = Math.min(this.lastBarOhlc.low, low, close, open);
      volume = Math.max(this.lastBarOhlc.volume, volume);
    }

    high = Math.max(open, high, low, close);
    low = Math.min(open, high, low, close);

    this.lastBarSec = t;
    this.lastBarOhlc = { open, high, low, close, volume };

    const bar = { time: t as ReturnType<typeof toSec>, open, high, low, close };
    try {
      this.baseSeries.candles?.update(bar);
      this.baseSeries.bar?.update(bar);
      this.baseSeries.area?.update({ time: bar.time, value: close });
      this.baseSeries.line?.update({ time: bar.time, value: close });
      this.baseSeries.baseline?.update({ time: bar.time, value: close });
      if (volume > 0 && this.volumeSeries) {
        this.volumeSeries.update({
          time: bar.time,
          value: volume,
          color: close >= open ? "rgba(46,194,126,0.30)" : "rgba(238,95,117,0.30)",
        });
      }
    } catch {
      /* race with setHistory — next tick recovers */
    }
  }

  updateIncremental(close: number, timeMs: number) {
    for (const [key, s] of this.emaState) {
      const next = close * s.k + s.last * (1 - s.k);
      s.last = next;
      s.time = timeMs;
      const sec = toSec(timeMs) as number;
      if (this.lastBarSec != null && sec < this.lastBarSec) continue;
      try {
        this.indicators.get(key)?.update({ time: sec as ReturnType<typeof toSec>, value: next });
      } catch {
        /* */
      }
    }
  }

  rebuildIndicators(
    ind: ChartIndicators | null,
    visible: { ema: boolean; bollinger: boolean; vwap: boolean; rsi: boolean; macd: boolean; srLevels: boolean },
  ) {
    for (const [, s] of this.indicators) {
      try {
        this.chart.removeSeries(s);
      } catch {
        /* noop */
      }
    }
    this.indicators.clear();
    this.emaState.clear();

    if (!ind) return;
    const add = (key: IndicatorKey, pane: 0 | 1 | 2, color: string, opts: { width?: 1 | 2; dashed?: boolean } = {}) => {
      const s = this.chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: opts.width ?? 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          lineStyle: opts.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceScaleId: pane === 0 ? "right" : "default",
        },
        pane,
      );
      this.indicators.set(key, s);
      return s;
    };
    const push = (key: IndicatorKey, s: ISeriesApi<"Line">, pts: { time: number; value?: number }[]) => {
      s.setData(
        pts
          .filter((p) => p.value != null && Number.isFinite(p.value))
          .map((p) => ({ time: toSec(p.time), value: p.value as number })),
      );
      const last = pts.filter((p) => p.value != null).pop();
      if ((key === "ema20" || key === "ema50") && last?.value != null) {
        this.emaState.set(key, {
          k: 2 / ((key === "ema20" ? 20 : 50) + 1),
          last: last.value,
          time: last.time,
        });
      }
    };

    push("ema20", add("ema20", 0, T.accent), ind.ema20);
    this.indicators.get("ema20")?.applyOptions({ visible: visible.ema });
    push("ema50", add("ema50", 0, T.warn), ind.ema50);
    this.indicators.get("ema50")?.applyOptions({ visible: visible.ema });
    if (ind.bollinger) {
      push("bbU", add("bbU", 0, "rgba(110,168,254,0.55)", { dashed: true }), ind.bollinger.upper);
      push("bbM", add("bbM", 0, "rgba(110,168,254,0.75)"), ind.bollinger.mid);
      push("bbL", add("bbL", 0, "rgba(110,168,254,0.55)", { dashed: true }), ind.bollinger.lower);
      for (const k of ["bbU", "bbM", "bbL"] as const) this.indicators.get(k)?.applyOptions({ visible: visible.bollinger });
    }
    if (ind.vwap) {
      push("vwap", add("vwap", 0, T.info, { width: 2 }), ind.vwap);
      this.indicators.get("vwap")?.applyOptions({ visible: visible.vwap });
    }
    if (ind.rsi.length) {
      const s = add("rsi", 1, T.purple);
      push("rsi", s, ind.rsi);
      s.applyOptions({ visible: visible.rsi });
      s.createPriceLine({
        price: 70,
        color: "rgba(238,95,117,0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "",
        axisLabelVisible: false,
      });
      s.createPriceLine({
        price: 30,
        color: "rgba(46,194,126,0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "",
        axisLabelVisible: false,
      });
    }
    if (ind.macd) {
      push("macdM", add("macdM", 2, T.accent2), ind.macd.macd);
      push("macdS", add("macdS", 2, T.warn), ind.macd.signal);
      const hist = this.chart.addSeries(
        HistogramSeries,
        { lastValueVisible: false, priceLineVisible: false, priceScaleId: "default" },
        2,
      );
      hist.setData(
        ind.macd.histogram
          .filter((p) => p.value != null)
          .map((p) => ({
            time: toSec(p.time),
            value: p.value as number,
            color: (p.value as number) >= 0 ? "rgba(46,194,126,0.5)" : "rgba(238,95,117,0.5)",
          })),
      );
      this.indicators.set("macdH", hist);
      for (const k of ["macdM", "macdS", "macdH"] as const) this.indicators.get(k)?.applyOptions({ visible: visible.macd });
    }
  }

  setIndicatorVisible(k: "ema" | "bollinger" | "vwap" | "rsi" | "macd", on: boolean) {
    const map: Record<string, IndicatorKey[]> = {
      ema: ["ema20", "ema50"],
      bollinger: ["bbU", "bbM", "bbL"],
      vwap: ["vwap"],
      rsi: ["rsi"],
      macd: ["macdM", "macdS", "macdH"],
    };
    for (const key of map[k] ?? []) this.indicators.get(key)?.applyOptions({ visible: on });
  }

  rebuildSrLines(ind: ChartIndicators | null, on: boolean) {
    const c = this.base();
    if (!c) return;
    for (const l of this.srLines) c.removePriceLine(l.line);
    this.srLines = [];
    if (!ind || !on) return;
    for (const s of ind.srLevels.support.slice(0, 3)) {
      this.srLines.push({
        line: c.createPriceLine({
          price: s,
          color: "rgba(46,194,126,0.55)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        }),
        kind: "s",
        indicatorRef: c,
      });
    }
    for (const r of ind.srLevels.resistance.slice(0, 3)) {
      this.srLines.push({
        line: c.createPriceLine({
          price: r,
          color: "rgba(238,95,117,0.55)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        }),
        kind: "r",
        indicatorRef: c,
      });
    }
  }

  addDrawingLine(price: number): IPriceLine | null {
    const c = this.base();
    if (!c) return null;
    return c.createPriceLine({
      price,
      color: T.warn,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "H",
    });
  }

  private extraLevelLines: IPriceLine[] = [];

  rebuildExtraLevels(levels: { label: string; price: number; color: string }[]) {
    const c = this.base();
    if (!c) return;
    for (const l of this.extraLevelLines) c.removePriceLine(l);
    this.extraLevelLines = [];
    for (const lv of levels) {
      this.extraLevelLines.push(
        c.createPriceLine({
          price: lv.price,
          color: lv.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: lv.label,
        }),
      );
    }
  }

  applyMarkers(markers: ChartSignalMarker[]) {
    const c = this.baseSeries.candles;
    if (!c || !markers?.length) return;
    try {
      attachMarkers(c as Parameters<typeof attachMarkers>[0], markers as Parameters<typeof attachMarkers>[1]);
    } catch {
      /* marker plugin optional */
    }
  }

  destroy() {
    for (const k of ALL_KINDS) {
      const s = this.baseSeries[k];
      if (s) {
        try {
          this.chart.removeSeries(s);
        } catch {
          /* noop */
        }
      }
    }
    this.baseSeries = {};
    this.volumeSeries = null;
    this.indicators.clear();
    this.emaState.clear();
    this.srLines = [];
    this.lastCandles = [];
    this.lastBarSec = null;
    this.lastBarOhlc = null;
    this.pendingLive = null;
    if (this.liveRaf != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.liveRaf);
    this.liveRaf = null;
  }
}
