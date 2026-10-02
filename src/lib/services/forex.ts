import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getRealtimeFxQuotes,
  getBiquotePublicOhlc,
  getErApiLatest,
  getFrankfurterSeries,
  type FxLatest,
} from "../providers/forex";
import { getYahooQuotes, getYahooChart, yahooSymbolForPair, yahooIntervalFor } from "../providers/yahoo";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, ForexMarket, ForexRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";
export type { ForexMarket } from "../types";

interface PairDef {
  pair: string;
  base: string;
  quote: string;
  group: ForexRow["group"];
  kind: "usd-quote" | "usd-base" | "cross" | "yahoo-only";
  label?: string;
}

const PAIRS: PairDef[] = [
  { pair: "EURUSD", base: "EUR", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "GBPUSD", base: "GBP", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "USDJPY", base: "USD", quote: "JPY", group: "major", kind: "usd-base" },
  { pair: "USDCHF", base: "USD", quote: "CHF", group: "major", kind: "usd-base" },
  { pair: "AUDUSD", base: "AUD", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "USDCAD", base: "USD", quote: "CAD", group: "major", kind: "usd-base" },
  { pair: "NZDUSD", base: "NZD", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "EURJPY", base: "EUR", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "EURGBP", base: "EUR", quote: "GBP", group: "minor", kind: "cross" },
  { pair: "EURCHF", base: "EUR", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "EURAUD", base: "EUR", quote: "AUD", group: "minor", kind: "cross" },
  { pair: "EURCAD", base: "EUR", quote: "CAD", group: "minor", kind: "cross" },
  { pair: "EURNZD", base: "EUR", quote: "NZD", group: "minor", kind: "cross" },
  { pair: "GBPJPY", base: "GBP", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "GBPCHF", base: "GBP", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "GBPAUD", base: "GBP", quote: "AUD", group: "minor", kind: "cross" },
  { pair: "GBPCAD", base: "GBP", quote: "CAD", group: "minor", kind: "cross" },
  { pair: "GBPNZD", base: "GBP", quote: "NZD", group: "minor", kind: "cross" },
  { pair: "AUDJPY", base: "AUD", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "AUDNZD", base: "AUD", quote: "NZD", group: "minor", kind: "cross" },
  { pair: "AUDCAD", base: "AUD", quote: "CAD", group: "minor", kind: "cross" },
  { pair: "AUDCHF", base: "AUD", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "NZDJPY", base: "NZD", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "NZDCAD", base: "NZD", quote: "CAD", group: "minor", kind: "cross" },
  { pair: "NZDCHF", base: "NZD", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "CADJPY", base: "CAD", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "CADCHF", base: "CAD", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "CHFJPY", base: "CHF", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "USDVND", base: "USD", quote: "VND", group: "exotic", kind: "usd-base" },
  { pair: "XAUUSD", base: "XAU", quote: "USD", group: "exotic", kind: "usd-quote", label: "XAU/USD — Vàng" },
  { pair: "XAGUSD", base: "XAG", quote: "USD", group: "exotic", kind: "usd-quote", label: "XAG/USD — Bạc" },
  { pair: "USOIL", base: "WTI", quote: "USD", group: "exotic", kind: "yahoo-only", label: "Crude Oil" },
  { pair: "USTEC", base: "NDX", quote: "USD", group: "exotic", kind: "yahoo-only", label: "US Tech 100 Index" },
];

function displaySymbol(def: PairDef): string {
  if (def.pair === "USOIL" || def.pair === "USTEC") return def.pair;
  return `${def.base}/${def.quote}`;
}

function deriveRate(def: PairDef, usdRates: Record<string, number>): number | null {
  if (def.kind === "yahoo-only") return null;
  if (def.kind === "usd-quote") {
    const perUsd = usdRates[def.base];
    return perUsd ? 1 / perUsd : null;
  }
  if (def.kind === "usd-base") {
    return usdRates[def.quote] ?? null;
  }
  const b = usdRates[def.base];
  const q = usdRates[def.quote];
  if (!b || !q) return null;
  return q / b;
}

export function fmtRate(v: number): string {
  return v >= 1000
    ? v.toLocaleString("vi-VN", { maximumFractionDigits: 0 })
    : v >= 100
      ? v.toFixed(2)
      : v.toFixed(4);
}

async function prevEcbRates(): Promise<FxLatest | null> {
  return null;
}

async function fetchDxySnapshot(): Promise<{ price: number; changePercent: number | null } | null> {
  try {
    const q = await getYahooQuotes(["DX-Y.NYB"]);
    const d = q.get("DX-Y.NYB");
    if (!d || !Number.isFinite(d.price)) return null;
    return { price: d.price, changePercent: d.changePercent };
  } catch {
    return null;
  }
}

async function appendYahooOnly(rows: ForexRow[]): Promise<ForexRow[]> {
  const have = new Set(rows.map((r) => r.pair));
  const missing = PAIRS.filter((p) => p.kind === "yahoo-only" && !have.has(p.pair));
  if (!missing.length) return rows;
  try {
    const symbols = missing.map((p) => yahooSymbolForPair(p.pair));
    const m = await getYahooQuotes(symbols);
    for (const def of missing) {
      const q = m.get(yahooSymbolForPair(def.pair));
      if (!q || !Number.isFinite(q.price) || q.price <= 0) continue;
      rows.push({
        pair: def.pair,
        base: def.base,
        quote: def.quote,
        group: def.group,
        symbol: displaySymbol(def),
        assetClass: "forex",
        price: q.price,
        change: q.change ?? null,
        changePercent: q.changePercent ?? null,
        updatedAt: q.marketTime ? new Date(q.marketTime).toISOString() : null,
      });
    }
  } catch {
    /* optional */
  }
  return rows;
}

function usdNote(rows: ForexRow[], dxy?: { price: number; changePercent: number | null } | null): string {
  const majors = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"];
  const inv = rows.filter((r) => majors.includes(r.pair) && r.changePercent != null);
  const dir = rows.filter((r) => ["USDJPY", "USDCHF", "USDCAD"].includes(r.pair) && r.changePercent != null);
  const score =
    (dir.reduce((a, r) => a + (r.changePercent ?? 0), 0) - inv.reduce((a, r) => a + (r.changePercent ?? 0), 0)) /
    Math.max(inv.length + dir.length, 1);
  const vnd = rows.find((r) => r.pair === "USDVND");
  const vndNote = vnd ? `USD/VND quanh ${fmtRate(vnd.price)}.` : "";
  const dxyNote =
    dxy && Number.isFinite(dxy.price)
      ? ` DXY ${dxy.price.toFixed(2)}${dxy.changePercent != null ? ` (${dxy.changePercent > 0 ? "+" : ""}${dxy.changePercent.toFixed(2)}%)` : ""}.`
      : "";
  if (score > 0.15 || (dxy?.changePercent != null && dxy.changePercent > 0.2))
    return `Đồng USD đang lấy lại sức mạnh trên rổ tiền tệ chính.${dxyNote} ${vndNote}`.trim();
  if (score < -0.15 || (dxy?.changePercent != null && dxy.changePercent < -0.2))
    return `Đồng USD nới lỏng so với các đồng tiền chính.${dxyNote} ${vndNote}`.trim();
  return `Tỷ giá các cặp chính đi ngang, USD chưa có xu hướng rõ.${dxyNote} ${vndNote}`.trim();
}

export async function getForexMarkets(): Promise<{ data: ForexMarket; meta: Meta } | null> {
  const prev = await prevEcbRates();
  try {
    const live = await getRealtimeFxQuotes(PAIRS.map((p) => p.pair));
    const { rates, ts, source: liveSource } = live;
    let rows = PAIRS.map((def): ForexRow | null => {
      const rate = rates[def.pair];
      if (rate == null) return null;
      const tick = live.ticks?.[def.pair];
      const changePercent =
        tick?.dayDiffPercent != null
          ? tick.dayDiffPercent
          : prev && deriveRate(def, prev.rates)
            ? (rate / (deriveRate(def, prev.rates) as number) - 1) * 100
            : null;
      const prevRate = prev ? deriveRate(def, prev.rates) : null;
      return {
        pair: def.pair,
        base: def.base,
        quote: def.quote,
        group: def.group,
        symbol: displaySymbol(def),
        assetClass: "forex" as const,
        price: rate,
        change: changePercent != null ? (rate * changePercent) / 100 : prevRate != null ? rate - prevRate : null,
        changePercent,
        updatedAt: ts ? new Date(ts).toISOString() : null,
      } satisfies ForexRow;
    }).filter((x): x is ForexRow => x !== null);
    if (rows.length) {
      rows = await appendYahooOnly(rows);
      const meta = buildMeta({
        source: liveSource,
        sourceTimestampMs: ts,
        note:
          liveSource === "biquote-public"
            ? "Realtime MT5 qua Biquote public (không cần key). Kim loại XAU/XAG live."
            : undefined,
        slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 300_000 },
      });
      return { data: { rows, usdStrengthNote: usdNote(rows, await fetchDxySnapshot()) }, meta };
    }
  } catch {
    /* degrade */
  }
  try {
    const latest = await cached<FxLatest>("forex:er-latest", {
      ttlMs: 10 * 60_000,
      staleMs: 26 * 3_600_000,
      producer: () => getErApiLatest(),
    });
    const rates = latest.value.rates;
    let rows = PAIRS.map((def): ForexRow | null => {
      const rate = deriveRate(def, rates);
      if (rate == null) return null;
      return {
        pair: def.pair,
        base: def.base,
        quote: def.quote,
        group: def.group,
        symbol: displaySymbol(def),
        assetClass: "forex" as const,
        price: rate,
        change: null,
        changePercent: null,
        updatedAt: new Date(latest.value.ts).toISOString(),
      } satisfies ForexRow;
    }).filter((x): x is ForexRow => x !== null);
    rows = await appendYahooOnly(rows);
    if (!rows.length) return null;
    const meta = buildMeta({
      source: latest.value.source,
      sourceTimestampMs: latest.value.ts,
      cached: latest.cached,
      stale: latest.stale,
      note: "Nguồn chính Biquote không khả dụng — FX từ exchangerate-api; kim loại từ Yahoo",
      slas: { liveSlaMs: 3_600_000, freshSlaMs: 6 * 3_600_000, delayedSlaMs: 30 * 3_600_000 },
    });
    return { data: { rows, usdStrengthNote: usdNote(rows, await fetchDxySnapshot()) }, meta };
  } catch {
    return null;
  }
}

export interface ForexDetail {
  pair: string;
  base: string;
  quote: string;
  current: ForexRow | null;
  series: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  referenceNote: string;
}

export async function getForexDetail(pairRaw: string): Promise<{ detail: ForexDetail; meta: Meta } | null> {
  const pair = pairRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const def = PAIRS.find((p) => p.pair === pair);
  if (!def && pair.length !== 6) return null;
  const base = def?.base ?? pair.slice(0, 3);
  const quote = def?.quote ?? pair.slice(3);
  const markets = await getForexMarkets();
  const current = markets?.data.rows.find((r) => r.pair === pair) ?? null;

  let bars: OhlcvBar[] = [];
  let seriesTs: number | null = null;
  let source = "biquote-public";
  let referenceNote = "Chuỗi OHLC realtime từ Biquote (MT5). Fallback: Yahoo / ECB.";

  try {
    const bq = await getBiquotePublicOhlc(pair, "1d", 400);
    if (bq.length >= 10) {
      bars = bq;
      seriesTs = bars[bars.length - 1]?.time ?? null;
      source = "biquote-public";
      referenceNote = `OHLC hàng ngày từ Biquote public (MT5) — ${pair}.`;
    }
  } catch {
    /* fall through */
  }

  if (!bars.length) {
    try {
      const y = await getYahooChart(yahooSymbolForPair(pair), "1d", "2y");
      if (y.candles?.length) {
        bars = y.candles as OhlcvBar[];
        seriesTs = bars[bars.length - 1]?.time ?? null;
        source = "yahoo-finance";
        referenceNote = `Lịch sử từ Yahoo Finance (${yahooSymbolForPair(pair)}).`;
      }
    } catch {
      /* optional */
    }
  }

  if (!bars.length && def?.kind !== "yahoo-only") {
    try {
      const direct = await getFrankfurterSeries(base, quote, 370);
      bars = direct.map((x) => ({
        time: Date.parse(x.date),
        open: x.rate,
        high: x.rate,
        low: x.rate,
        close: x.rate,
        volume: 0,
      }));
      seriesTs = direct.length ? Date.parse(direct[direct.length - 1].date) : null;
      source = "frankfurter-ecb";
      referenceNote = "Tỷ giá tham chiếu ECB daily.";
    } catch {
      try {
        const inverted = await getFrankfurterSeries(quote, base, 370);
        bars = inverted.map((x) => ({
          time: Date.parse(x.date),
          open: 1 / x.rate,
          high: 1 / x.rate,
          low: 1 / x.rate,
          close: 1 / x.rate,
          volume: 0,
        }));
        seriesTs = inverted.length ? Date.parse(inverted[inverted.length - 1].date) : null;
        source = "frankfurter-ecb";
      } catch {
        /* fall through */
      }
    }
  }

  if (!bars.length && !current) return null;

  const technical = bars.length >= 30 ? analyzeSeries(bars) : null;

  let patterns: CandlePattern[] = [];
  try {
    const bqH = await getBiquotePublicOhlc(pair, "1h", 200);
    if (bqH.length >= 20) patterns = detectPatterns(bqH);
  } catch {
    try {
      const cfg = yahooIntervalFor("1h");
      if (cfg) {
        const y = await getYahooChart(yahooSymbolForPair(pair), cfg.interval, cfg.range);
        if (y.candles?.length) patterns = detectPatterns(y.candles as OhlcvBar[]);
      }
    } catch {
      /* optional */
    }
  }

  const detail: ForexDetail = {
    pair,
    base,
    quote,
    current,
    series: bars,
    technical,
    patterns,
    referenceNote,
  };
  const meta = buildMeta({
    source,
    sourceTimestampMs: seriesTs,
    note: current ? undefined : "Giá hiện tại không khả dụng — chỉ còn chuỗi lịch sử",
    slas: { liveSlaMs: 86_400_000, freshSlaMs: 2 * 86_400_000, delayedSlaMs: 5 * 86_400_000 },
  });
  return { detail, meta };
}
