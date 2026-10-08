import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooIntervalFor, yahooSymbolForPair } from "../providers/yahoo";
import { getBiquotePublicOhlc, biquoteIntervalFor } from "../providers/forex";
import { getVnOhlcv } from "./stocks";
import { validateBars, detectGaps } from "../quality";
import {
  aggregateCandles,
  binanceInterval,
  TF_MS,
  tfsFor,
  vndDchartResolution,
  type ChartAssetType,
  type ChartCandle,
} from "../chart-const";
import type { Meta, OhlcvBar } from "../types";
import {
  type ChartIndicators,
  type ChartSignalMarker,
  type ChartMarketData,
  type ChartArgs,
  type IndicatorPoint,
  computeMarkers,
  computeIndicators,
  isChartableCommodity,
  canonicalIndexSymbol,
  validateIndexCandles,
  toCandle,
  scaleVnStockToFullVnd,
} from "./chart-core";

export type {
  IndicatorPoint,
  ChartIndicators,
  ChartSignalMarker,
  ChartMarketData,
  ChartArgs,
} from "./chart-core";

export {
  computeMarkers,
  computeIndicators,
  isChartableCommodity,
  canonicalIndexSymbol,
  validateIndexCandles,
} from "./chart-core";

type CandleSeriesResult = {
  candles: ChartCandle[];
  source: string;
  note?: string;
};

function maxHistoryLimit(assetType: ChartAssetType): number {
  if (assetType === "crypto") return 1500;
  if (assetType === "forex" || assetType === "commodity") return 800;
  return 600;
}

async function cryptoCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const interval = binanceInterval(tf);
  type Cand = { candles: ChartCandle[]; source: string };
  const jobs: Promise<Cand | null>[] = [
    (async () => {
      try {
        const raw = await Promise.race([
          binance.getKlinesDeep(symbol, interval, Math.min(limit, 5000)),
          new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
        ]);
        if (!raw?.length) return null;
        return {
          candles: raw.map((k) => ({
            time: k.time,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
          })),
          source: "binance",
        };
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { yahooCryptoSymbol } = await import("../providers/yahoo");
        const ySym = yahooCryptoSymbol(symbol);
        const cfg = yahooIntervalFor(tf);
        if (!cfg) return null;
        const y = await Promise.race([
          getYahooChart(ySym, cfg.interval, cfg.range),
          new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
        ]);
        const raw = y?.candles ?? [];
        if (raw.length < 10) return null;
        return {
          candles: raw.slice(-limit).map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
          })),
          source: "yahoo-crypto",
        };
      } catch {
        return null;
      }
    })(),
  ];
  const settled = await Promise.all(jobs);
  const ok = settled.filter((x): x is Cand => Boolean(x?.candles?.length));
  if (!ok.length) return { candles: [], source: "none", note: "crypto chart: binance+yahoo empty" };
  ok.sort((a, b) => {
    if (a.source === "binance" && b.source !== "binance") return -1;
    if (b.source === "binance" && a.source !== "binance") return 1;
    return b.candles.length - a.candles.length;
  });
  return {
    candles: ok[0]!.candles,
    source: ok.map((x) => x.source).filter((s, i, a) => a.indexOf(s) === i).join("+"),
  };
}

async function stockCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const want = Math.min(Math.max(limit, 40), 2000);
  const native = vndDchartResolution(tf);

  let resolution: "D" | "1" | "5" | "15" | "30" | "60" = "D";
  let fetchBars = want;
  if (native) {
    resolution = native;
    fetchBars = want;
  } else if (tf === "4h") {
    resolution = "60";
    fetchBars = Math.min(want * 4, 1_500);
  } else {
    resolution = "D";
    const mult = tf === "1w" ? 6 : tf === "1M" ? 24 : 280;
    fetchBars = Math.min(want * mult, 2_000);
  }

  /**
   * Parallel public OHLCV race (no API key):
   *  1) VNDirect dchart (intraday + daily)
   *  2) Entrade + VPS hist via getPublicOhlcv (daily)
   *  3) getVnOhlcv multi-source daily board
   * Prefer longest valid series (≥20 bars); never invent prices.
   */
  let bars: OhlcvBar[] = [];
  let source = "public-ohlcv";
  let usedDailyFallback = false;

  type Cand = { bars: OhlcvBar[]; source: string; dailyOnly: boolean };
  const tasks: Promise<Cand | null>[] = [];

  tasks.push(
    (async () => {
      try {
        const { fetchVndDchartHistory } = await import("../providers/vndirect-dchart");
        const raw = await Promise.race([
          fetchVndDchartHistory(symbol, resolution, fetchBars),
          new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
        ]);
        if (raw?.length) return { bars: raw, source: "vndirect-dchart", dailyOnly: resolution === "D" };
      } catch {
        /* */
      }
      return null;
    })(),
  );

  if (resolution === "D" || !native) {
    tasks.push(
      (async () => {
        try {
          const { getPublicOhlcv } = await import("../providers/public-vn-feed");
          const isIdx = /^(VNINDEX|VN30|HNX|HNX30|UPCOM|VN100)$/i.test(symbol);
          const raw = await Promise.race([
            getPublicOhlcv(symbol, Math.min(fetchBars, 800), isIdx ? "index" : "stock"),
            new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
          ]);
          if (raw?.length) return { bars: raw, source: "entrade+vps-hist", dailyOnly: true };
        } catch {
          /* */
        }
        return null;
      })(),
    );
  }

  tasks.push(
    (async () => {
      try {
        const res = await Promise.race([
          getVnOhlcv(symbol, Math.min(want, 500)),
          new Promise<null>((r) => setTimeout(() => r(null), 9_000)),
        ]);
        const b = res?.bars ?? [];
        if (b.length)
          return {
            bars: b,
            source: (res?.meta as { source?: string } | undefined)?.source ?? "vn-ohlcv-public",
            dailyOnly: true,
          };
      } catch {
        /* */
      }
      return null;
    })(),
  );

  const settled = await Promise.all(tasks);
  const ok = settled.filter((x): x is Cand => Boolean(x?.bars?.length));
  if (ok.length) {
    const needIntraday = Boolean(native && native !== "D") || tf === "4h";
    ok.sort((a, b) => {
      if (needIntraday) {
        const aIn = a.dailyOnly ? 0 : 1;
        const bIn = b.dailyOnly ? 0 : 1;
        if (aIn !== bIn) return bIn - aIn;
      }
      const aOk = a.bars.length >= 20 ? 1 : 0;
      const bOk = b.bars.length >= 20 ? 1 : 0;
      if (aOk !== bOk) return bOk - aOk;
      return b.bars.length - a.bars.length;
    });
    bars = ok[0]!.bars;
    source = ok.map((x) => x.source).filter((s, i, a) => a.indexOf(s) === i).join("+");
    usedDailyFallback = ok[0]!.dailyOnly && needIntraday;
  }

  let candles: ChartCandle[] = (bars ?? []).map((b) => toCandle(b));
  candles = scaleVnStockToFullVnd(candles);

  if (!native && !usedDailyFallback) {
    const tfMs = TF_MS[tf];
    if (tfMs && candles.length) candles = aggregateCandles(candles, tfMs);
  } else if (!native && usedDailyFallback) {
    if (tf === "1w" || tf === "1M" || tf === "12M") {
      const tfMs = TF_MS[tf];
      if (tfMs && candles.length) candles = aggregateCandles(candles, tfMs);
    }
  }

  if (usedDailyFallback && ((native && native !== "D") || tf === "4h")) {
    return {
      candles: [],
      source,
      note: `intraday ${tf} chưa có — dchart đang gián đoạn (không dùng daily giả)`,
    };
  }

  const idx = canonicalIndexSymbol(symbol);
  if (idx) {
    const v = validateIndexCandles(symbol, candles);
    candles = v.valid;
  }

  if (candles.length > want) candles = candles.slice(-want);
  return { candles, source };
}
