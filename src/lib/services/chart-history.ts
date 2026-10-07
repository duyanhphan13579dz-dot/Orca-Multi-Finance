import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { getYahooChart, yahooIntervalFor, yahooSymbolForPair, yahooCryptoSymbol } from "../providers/yahoo";
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

async function yahooCandles(symbol: string, tf: string, _limit: number): Promise<CandleSeriesResult> {
  const cfg = yahooIntervalFor(tf);
  if (!cfg) return { candles: [], source: "yahoo", note: `tf ${tf} unsupported` };
  const raw = await getYahooChart(symbol, cfg.interval, cfg.range);
  const candles = raw?.candles ?? [];
  return { candles, source: "yahoo", note: candles.length ? undefined : "yahoo empty" };
}

async function forexCandles(symbol: string, tf: string, limit: number): Promise<CandleSeriesResult> {
  const pair = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  type Cand = { candles: ChartCandle[]; source: string };
  const jobs: Promise<Cand | null>[] = [];
  if (biquoteIntervalFor(tf)) {
    jobs.push(
      (async () => {
        try {
          const bars = await Promise.race([
            getBiquotePublicOhlc(pair, tf, Math.min(limit, 1000)),
            new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
          ]);
          if (bars && bars.length >= 10) {
            return {
              candles: bars.map((b) => ({
                time: b.time,
                open: b.open,
                high: b.high,
                low: b.low,
                close: b.close,
                volume: b.volume ?? 0,
              })),
              source: "biquote-public",
            };
          }
        } catch {
          /* */
        }
        return null;
      })(),
    );
  }
  jobs.push(
    (async () => {
      try {
        const ySymbol = yahooSymbolForPair(pair);
        const cfg = yahooIntervalFor(tf);
        if (!cfg) return null;
        const raw = await Promise.race([
          getYahooChart(ySymbol, cfg.interval, cfg.range),
          new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
        ]);
        const candles = (raw?.candles ?? []).slice(-limit);
        if (candles.length >= 10)
          return {
            candles: candles.map((c) => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume ?? 0,
            })),
            source: "yahoo-fx",
          };
      } catch {
        /* */
      }
      return null;
    })(),
  );
  if (!jobs.length) return { candles: [], source: "none", note: `tf ${tf} unsupported` };
  const settled = await Promise.all(jobs);
  const ok = settled.filter((x): x is Cand => Boolean(x?.candles?.length));
  if (!ok.length) return { candles: [], source: "none", note: "forex chart: all public sources empty" };
  ok.sort((a, b) => {
    if (a.source === "biquote-public" && b.source !== "biquote-public") return -1;
    if (b.source === "biquote-public" && a.source !== "biquote-public") return 1;
    return b.candles.length - a.candles.length;
  });
  return {
    candles: ok[0]!.candles,
    source: ok.map((x) => x.source).filter((s, i, a) => a.indexOf(s) === i).join("+"),
  };
}

export async function getChartHistory(
  args: ChartArgs,
): Promise<{ data: ChartMarketData; meta: Meta } | null> {
  const symbol = String(args.symbol ?? "").trim().toUpperCase();
  const tf = String(args.timeframe ?? args.interval ?? "1d");
  if (!symbol) return null;
  const maxL = maxHistoryLimit(args.assetType);
  const limit = Math.min(Math.max(args.limit ?? 500, 40), maxL);
  if (!tfsFor(args.assetType).includes(tf)) return null;

  try {
    const cacheKey = `chart:v7:${args.assetType}:${symbol}:${tf}:${limit}`;
    const res = await cached(cacheKey, {
      ttlMs:
        args.assetType === "crypto"
          ? 30_000
          : args.assetType === "forex" || args.assetType === "commodity"
            ? 45_000
            : 60_000,
      staleMs: args.assetType === "crypto" ? 120_000 : 300_000,
      producer: async () => {
        let series: CandleSeriesResult;
        if (args.assetType === "crypto") {
          series = await cryptoCandles(symbol, tf, limit);
        } else if (args.assetType === "stock") {
          // simplified stock path — use getVnOhlcv daily
          const r = await getVnOhlcv(symbol, Math.min(limit, 500));
          const bars = r?.bars ?? [];
          series = {
            candles: bars.map((b) => toCandle(b)),
            source: (r?.meta as { source?: string } | undefined)?.source ?? "vn-ohlcv",
          };
          series.candles = scaleVnStockToFullVnd(series.candles);
        } else if (args.assetType === "forex" || args.assetType === "commodity") {
          series = await forexCandles(symbol, tf, limit);
        } else {
          series = await yahooCandles(symbol, tf, limit);
        }

        let candles = series.candles;
        if (candles.length > limit) candles = candles.slice(-limit);

        const quality = validateBars(candles as OhlcvBar[]);
        const cleaned = (quality.cleaned ?? candles) as ChartCandle[];
        const gapFlag = detectGaps(cleaned as OhlcvBar[], TF_MS[tf] ?? 86_400_000);
        const gaps =
          gapFlag && typeof (gapFlag as { value?: number }).value === "number"
            ? (gapFlag as { value: number }).value
            : gapFlag
              ? 1
              : 0;
        const suspect = quality.status === "SUSPECT" || quality.status === "INVALID" ? 1 : 0;

        return {
          candles: cleaned,
          source: series.source,
          note: series.note,
          gaps,
          suspect,
        };
      },
    });

    const { candles, source, note, gaps, suspect } = res.value;
    if (!candles.length) return null;

    const last = candles[candles.length - 1];
    let indicators: ChartIndicators | null = null;
    let markers: ChartSignalMarker[] = [];
    try {
      indicators = computeIndicators(candles as ChartCandle[]);
    } catch {
      indicators = null;
    }
    try {
      markers = computeMarkers(candles as ChartCandle[]);
    } catch {
      markers = [];
    }

    const meta = buildMeta({
      source,
      sourceTimestampMs: last?.time ?? Date.now(),
      cached: res.cached,
      stale: res.stale,
      note:
        [note, gaps ? `${gaps} khoảng trống` : null, suspect ? "quality: SUSPECT" : null]
          .filter(Boolean)
          .join(" · ") || undefined,
      slas:
        args.assetType === "crypto"
          ? { liveSlaMs: TF_MS[tf]! * 1.5, freshSlaMs: TF_MS[tf]! * 4, delayedSlaMs: TF_MS[tf]! * 12 }
          : { liveSlaMs: 5 * 60_000, freshSlaMs: 30 * 60_000, delayedSlaMs: 6 * 3_600_000 },
    });

    return {
      data: {
        candles: candles as ChartCandle[],
        indicators,
        markers,
        intervalMs: TF_MS[tf] ?? 86_400_000,
        gaps,
        suspect,
        timeframe: tf,
      },
      meta,
    };
  } catch (e) {
    console.warn("[getChartHistory]", args.assetType, symbol, tf, e instanceof Error ? e.message : e);
    return null;
  }
}
