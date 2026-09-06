import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getBiquoteQuotes, getErApiLatest, getFrankfurterSeries, type FxLatest } from "../providers/forex";
import { getSwissquoteQuotes, SWISSQUOTE } from "../providers/swissquote";
import { getYahooChart, getYahooQuotes, yahooSymbolForPair, type YahooQuote } from "../providers/yahoo";
import { analyzeSeries } from "../technical";
import { marketStore } from "../realtime/market-store";
import { computeDailyPerformance, type PerformanceResult } from "../performance";
import { getVnFx, type VnFxModel } from "./vnfx";
import type { ChartCandle } from "../chart-const";
import type { ForexRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";

/** Phase 6 — feed validated forex quotes into the shared Realtime Market Store. */
function ingestRows(rows: ForexRow[], source: string): void {
  for (const r of rows) {
    if (!Number.isFinite(r.price) || r.price <= 0) continue;
    marketStore.setQuote({
      assetType: "forex",
      symbol: r.pair,
      price: r.price,
      change: r.change,
      changePercent: r.changePercent,
      open: r.open,
      high: r.high,
      low: r.low,
      volume: r.volume,
      source,
      ts: r.updatedAt ? Date.parse(r.updatedAt) : Date.now(),
    });
  }
}

/** Phase 6 — partial honesty: cặp provider không trả → meta.errors. */
function missingPairErrors(rows: ForexRow[]): NonNullable<Meta["errors"]> {
  const got = new Set(rows.map((r) => r.pair));
  const missing = PAIRS.map((p) => p.pair).filter((pair) => !got.has(pair));
  return missing.length ? [{ component: "quote", status: "PARTIAL", message: `Provider không trả: ${missing.join(", ")}` }] : [];
}

/**
 * Phase 6 §7 — build ForexRow từ stored quote (Realtime Market Store).
 * Chỉ dùng khi entry còn TRONG cửa sổ FRESH của forex (150s) — dữ liệu cũ hơn
 * không được coi là current → rơi về getForexMarkets() (refresh provider).
 */
function forexRowFromStore(pair: string): ForexRow | null {
  const def = PAIRS.find((p) => p.pair === pair);
  if (!def) return null;
  const q = marketStore.getQuote("forex", pair);
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return null;
  if (Date.now() - q.ingestedAt > 150_000) return null;
  return {
    pair: def.pair,
    base: def.base,
    quote: def.quote,
    group: def.group,
    baseCurrency: def.base,
    quoteCurrency: def.quote,
    symbol: `${def.base}/${def.quote}`,
    assetClass: "forex" as const,
    price: q.price,
    change: q.change ?? null,
    changePercent: q.changePercent ?? null,
    open: q.open ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    volume: q.volume ?? null,
    previousClose: q.previousClose ?? null,
    updatedAt: new Date(q.ts).toISOString(),
    provider: q.source,
  } satisfies ForexRow;
}

/**
 * FOREX DOMAIN — multi-source, priority public/free/direct:
 *   1. Biquote (env, chuyên nghiệp) — khi được cấu hình
 *   2. Swissquote public BBO (no key, realtime, majors+crosses DIRECT)
 *   3. Yahoo Finance FX snapshot (public; change/prevClose reference)
 *   4. exchangerate-api open latest (USD-based, derive cross)
 * USD/VND luôn bổ sung từ mô hình Vietnam FX riêng (Vietcombank + VietnamBiz).
 */

interface PairDef {
  pair: string; // e.g. EURUSD
  base: string;
  quote: string;
  group: ForexRow["group"];
  /** how to derive from USD-based rates */
  kind: "usd-quote" | "usd-base" | "cross";
}

/** 7 majors + 8 crosses + USDVND. */
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
  { pair: "GBPJPY", base: "GBP", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "AUDJPY", base: "AUD", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "EURCHF", base: "EUR", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "EURAUD", base: "EUR", quote: "AUD", group: "minor", kind: "cross" },
  { pair: "GBPCHF", base: "GBP", quote: "CHF", group: "minor", kind: "cross" },
  { pair: "AUDCAD", base: "AUD", quote: "CAD", group: "minor", kind: "cross" },
  { pair: "USDVND", base: "USD", quote: "VND", group: "exotic", kind: "usd-base" },
];

function deriveRate(def: PairDef, usdRates: Record<string, number>): number | null {
  if (def.kind === "usd-quote") {
    const perUsd = usdRates[def.base];
    return perUsd ? 1 / perUsd : null;
  }
  if (def.kind === "usd-base") return usdRates[def.quote] ?? null;
  const basePerUsd = usdRates[def.base];
  const quotePerUsd = usdRates[def.quote];
  if (!basePerUsd || !quotePerUsd) return null;
  return quotePerUsd / basePerUsd;
}

interface PrevRates {
  date: string;
  rates: Record<string, number>;
}

async function prevEcbRates(): Promise<PrevRates | null> {
  try {
    const res = await cached("forex:prev-rates", {
      ttlMs: 6 * 3_600_000,
      staleMs: 72 * 3_600_000,
      producer: async () => {
        const end = new Date();
        const start = new Date(Date.now() - 12 * 86_400_000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const { httpJson } = await import("../http");
        const r = await httpJson<{ rates: Record<string, Record<string, number>> }>(
          `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(end)}?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD,NZD,VND`,
          { provider: "frankfurter-ecb", timeoutMs: 9_000, retries: 1 },
        );
        if (!r.ok || !r.data) throw new Error("frankfurter prev unavailable");
        const dates = Object.keys(r.data.rates).sort();
        const lastDate = dates[dates.length - 1];
        if (!lastDate) throw new Error("frankfurter: no dates");
        return { date: lastDate, rates: r.data.rates[lastDate] };
      },
    });
    return res.value;
  } catch {
    return null;
  }
}

/** Một mức giá từ bất kỳ provider nào (đã chuẩn hóa). */
interface FxQuote {
  rate: number;
  ts: number | null;
  bid?: number | null;
  ask?: number | null;
}

function buildRows(quotes: Map<string, FxQuote>, prev: PrevRates | null, providerLabel?: string): ForexRow[] {
  return PAIRS.map((def): ForexRow | null => {
    const q = quotes.get(def.pair);
    if (!q || !Number.isFinite(q.rate) || q.rate <= 0) return null;
    const prevRate = prev ? deriveRate(def, prev.rates) : null;
    return {
      pair: def.pair,
      base: def.base,
      quote: def.quote,
      group: def.group,
      baseCurrency: def.base,
      quoteCurrency: def.quote,
      symbol: `${def.base}/${def.quote}`,
      assetClass: "forex" as const,
      price: q.rate,
      bid: q.bid ?? null,
      ask: q.ask ?? null,
      change: prevRate != null ? q.rate - prevRate : null,
      changePercent: prevRate ? (q.rate / prevRate - 1) * 100 : null,
      previousClose: prevRate,
      updatedAt: q.ts ? new Date(q.ts).toISOString() : null,
      provider: providerLabel,
    } satisfies ForexRow;
  }).filter((x): x is ForexRow => x !== null);
}

/** Thêm USDVND từ mô hình Vietnam FX (Vietcombank/VietnamBiz) nếu còn thiếu. */
function appendVnFx(rows: ForexRow[], vnFx: VnFxModel | null, prev: PrevRates | null): ForexRow[] {
  if (!vnFx?.rate || rows.some((r) => r.pair === "USDVND")) return rows;
  const def = PAIRS.find((p) => p.pair === "USDVND")!;
  const prevRate = prev ? deriveRate(def, prev.rates) : null;
  const row: ForexRow = {
    pair: def.pair,
    base: def.base,
    quote: def.quote,
    group: def.group,
    baseCurrency: def.base,
    quoteCurrency: def.quote,
    symbol: `${def.base}/${def.quote}`,
    assetClass: "forex" as const,
    price: vnFx.rate,
    change: prevRate != null ? vnFx.rate - prevRate : null,
    changePercent: prevRate ? (vnFx.rate / prevRate - 1) * 100 : null,
    previousClose: prevRate,
    updatedAt: vnFx.updatedAt ? new Date(vnFx.updatedAt).toISOString() : null,
    provider: `vietnam-fx (${vnFx.source})`,
  };
  return [...rows, row];
}

export interface ForexMarket {
  rows: ForexRow[];
  usdStrengthNote: string;
  /** Mô hình USD/VND riêng (buy cash / transfer / sell / reference) — additive */
  vnFx: VnFxModel | null;
}

const FX_SLAS = { liveSlaMs: 60_000, freshSlaMs: 10 * 60_000, delayedSlaMs: 24 * 3_600_000 };

export async function getForexMarkets(): Promise<{ data: ForexMarket; meta: Meta } | null> {
  const [prev, vnFx] = await Promise.all([prevEcbRates(), getVnFx()]);
  const fxPairs = PAIRS.filter((p) => p.pair !== "USDVND");

  // 1) Biquote primary (env-configured professional feed)
  try {
    const { rates, ts } = await getBiquoteQuotes(fxPairs.map((p) => p.pair));
    const quotes = new Map<string, FxQuote>(Object.entries(rates).map(([pair, rate]) => [pair, { rate, ts }]));
    let rows = buildRows(quotes, prev, "biquote");
    rows = appendVnFx(rows, vnFx, prev);
    if (rows.length) {
      ingestRows(rows, "biquote+vietnam-fx");
      const meta = buildMeta({
        source: "biquote",
        sourceTimestampMs: ts,
        note: prev ? undefined : "Không lấy được mức tham chiếu ngày trước (ECB) — thiếu cột change",
        slas: FX_SLAS,
        errors: missingPairErrors(rows),
      });
      return {
        data: { rows, usdStrengthNote: usdNote(rows), vnFx: vnFx?.rate ? vnFx : null },
        meta,
      };
    }
  } catch {
    /* degrade to Swissquote */
  }

  // 2) Swissquote public BBO — no key, realtime, direct majors+crosses
  try {
    const r = await cached(`forex:swissquote:${fxPairs.length}`, {
      ttlMs: 30_000,
      staleMs: 12 * 3_600_000,
      producer: async () => {
        const m = await getSwissquoteQuotes(fxPairs.map((p) => ({ base: p.base, quote: p.quote })));
        return { entries: Array.from(m.entries()).map(([pair, q]) => ({ pair, mid: q.mid, bid: q.bid, ask: q.ask, ts: q.ts })) };
      },
    });
    const quotes = new Map<string, FxQuote>(
      r.value.entries.filter((e) => Number.isFinite(e.mid) && e.mid > 0).map((e) => [e.pair, { rate: e.mid, ts: e.ts, bid: e.bid, ask: e.ask }]),
    );
    let rows = buildRows(quotes, prev, SWISSQUOTE);
    rows = appendVnFx(rows, vnFx, prev);
    if (rows.length) {
      ingestRows(rows, `${SWISSQUOTE}+vietnam-fx`);
      const newest = rows.map((x) => (x.updatedAt ? Date.parse(x.updatedAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
      const meta = buildMeta({
        source: SWISSQUOTE,
        sourceTimestampMs: r.value.entries.reduce((a, e) => Math.max(a, e.ts ?? 0), 0) || newest || Date.now(),
        cached: r.cached,
        stale: r.stale,
        note: "Nguồn chính Biquote không khả dụng — giá BBO trực tiếp từ Swissquote public feed; % thay đổi so với fix ECB gần nhất. Cuối tuần thị trường đóng cửa — giá là phiên gần nhất.",
        slas: FX_SLAS,
        errors: missingPairErrors(rows),
      });
      return {
        data: { rows, usdStrengthNote: usdNote(rows), vnFx: vnFx?.rate ? vnFx : null },
        meta,
      };
    }
  } catch {
    /* degrade to Yahoo */
  }

  // 3) Yahoo Finance FX snapshot fallback (approved public reference)
  try {
    const yahoo = await cached(`forex:yahoo:${fxPairs.length}`, {
      ttlMs: 30_000,
      staleMs: 12 * 3_600_000,
      producer: async () => {
        const m = await getYahooQuotes(fxPairs.map((p) => yahooSymbolForPair(p.pair)));
        return { m: Array.from(m.entries()), ts: Date.now() };
      },
    });
    const y = new Map<string, YahooQuote>(yahoo.value.m);
    const quotes = new Map<string, FxQuote>();
    for (const def of fxPairs) {
      const q = y.get(yahooSymbolForPair(def.pair));
      if (q && Number.isFinite(q.price) && q.price > 0) {
        quotes.set(def.pair, { rate: q.price, ts: q.marketTime ?? yahoo.value.ts, bid: null, ask: null });
      }
    }
    let rows = buildRows(quotes, prev, "yahoo-fx");
    rows = appendVnFx(rows, vnFx, prev);
    if (rows.length) {
      // ưu tiên change/prevClose từ chính provider (real daily) khi có
      rows = rows.map((r) => {
        const q = y.get(yahooSymbolForPair(r.pair));
        if (!q) return r;
        return {
          ...r,
          change: q.change ?? r.change,
          changePercent: q.changePercent ?? r.changePercent,
          open: q.previousClose ?? r.open,
          high: q.dayHigh ?? r.high,
          low: q.dayLow ?? r.low,
          previousClose: q.previousClose ?? r.previousClose,
        };
      });
      const newest = rows.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
      const meta = buildMeta({
        source: "Yahoo Finance (FX reference)",
        sourceTimestampMs: newest || yahoo.value.ts,
        cached: yahoo.cached,
        stale: yahoo.stale,
        note: "Biquote/Swissquote không khả dụng → nguồn FX snapshot tham chiếu; % thay đổi theo chính provider (prevClose) khi có, ngược lại so với fix ECB gần nhất",
        slas: { liveSlaMs: 120_000, freshSlaMs: 30 * 60_000, delayedSlaMs: 24 * 3_600_000 },
        errors: missingPairErrors(rows),
      });
      ingestRows(rows, "yahoo-fx+vietnam-fx");
      return {
        data: { rows, usdStrengthNote: usdNote(rows), vnFx: vnFx?.rate ? vnFx : null },
        meta,
      };
    }
  } catch {
    /* degrade to er-api */
  }

  // 4) exchangerate-api fallback (real, USD-based → derive)
  try {
    const latest = await cached<FxLatest>("forex:er-latest", {
      ttlMs: 10 * 60_000,
      staleMs: 26 * 3_600_000,
      producer: () => getErApiLatest(),
    });
    const rates = latest.value.rates;
    const quotes = new Map<string, FxQuote>();
    for (const def of fxPairs) {
      const rate = deriveRate(def, rates);
      if (rate != null) quotes.set(def.pair, { rate, ts: latest.value.ts });
    }
    let rows = buildRows(quotes, prev, latest.value.source);
    rows = appendVnFx(rows, vnFx, prev);
    if (!rows.length) return null;
    ingestRows(rows, `${latest.value.source}+vietnam-fx`);
    const meta = buildMeta({
      source: latest.value.source,
      sourceTimestampMs: latest.value.ts,
      cached: latest.cached,
      stale: latest.stale,
      note: "Nguồn chính không khả dụng — dùng tỷ giá tham chiếu realtime từ exchangerate-api; % thay đổi so với fix ECB gần nhất",
      slas: { liveSlaMs: 3_600_000, freshSlaMs: 6 * 3_600_000, delayedSlaMs: 30 * 3_600_000 },
      errors: missingPairErrors(rows),
    });
    return {
      data: { rows, usdStrengthNote: usdNote(rows), vnFx: vnFx?.rate ? vnFx : null },
      meta,
    };
  } catch {
    return null;
  }
}

function usdNote(rows: ForexRow[]): string {
  const majors = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"];
  const inv = rows.filter((r) => majors.includes(r.pair) && r.changePercent != null);
  const dir = rows.filter((r) => ["USDJPY", "USDCHF", "USDCAD"].includes(r.pair) && r.changePercent != null);
  const score =
    (dir.reduce((a, r) => a + (r.changePercent ?? 0), 0) - inv.reduce((a, r) => a + (r.changePercent ?? 0), 0)) /
    Math.max(inv.length + dir.length, 1);
  const vnd = rows.find((r) => r.pair === "USDVND");
  const vndNote = vnd ? `USD/VND quanh ${fmtRate(vnd.price)}.` : "";
  if (score > 0.15) return `Đồng USD đang lấy lại sức mạnh trên rổ tiền tệ chính. ${vndNote}`;
  if (score < -0.15) return `Đồng USD nới lỏng so với các đồng tiền chính. ${vndNote}`;
  return `Tỷ giá các cặp chính đi ngang, USD chưa có xu hướng rõ. ${vndNote}`;
}

export function fmtRate(v: number): string {
  return v >= 1000 ? v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : v >= 100 ? v.toFixed(2) : v.toFixed(4);
}

export interface ForexDetail {
  pair: string;
  base: string;
  quote: string;
  current: ForexRow | null;
  /** Chuỗi daily THẬT (Yahoo OHLC 1d → fallback fix tham chiếu ECB flat) */
  series: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  /** Hiệu suất 1D/1W/1M/1Q/1Y (chỉ tính trên dữ liệu daily thật) */
  performance: PerformanceResult | null;
  performanceNote: string;
  referenceNote: string;
}

export async function getForexDetail(pairRaw: string): Promise<{ detail: ForexDetail; meta: Meta } | null> {
  const pair = pairRaw.toUpperCase().replace(/[^A-Z]/g, "");
  if (pair.length !== 6) return null;
  const base = pair.slice(0, 3);
  const quote = pair.slice(3);
  // Phase 6 §7 — REALTIME MARKET STORE first cho quote: provider chỉ được gọi
  // khi store chưa có/stale (getForexMarkets write-through qua ingestRows).
  let current = forexRowFromStore(pair);
  if (!current) {
    const markets = await getForexMarkets();
    current = markets?.data.rows.find((r) => r.pair === pair) ?? null;
  }

  const errors: NonNullable<Meta["errors"]> = [];
  let series: { date: string; rate: number }[] = [];
  let seriesTs: number | null = null;
  let seriesSource: string | null = null;

  // PRIMARY: Yahoo Finance 1d OHLC thật (spot FX) — nến thật cho technical/performance
  try {
    const y = await getYahooChart(yahooSymbolForPair(pair), "1d", "730d");
    if (y.candles.length) {
      series = y.candles.map((c) => ({ date: new Date(c.time).toISOString().slice(0, 10), rate: c.close }));
      seriesTs = y.candles[y.candles.length - 1]?.time ?? null;
      seriesSource = "yahoo-fx";
    }
  } catch {
    /* fallback ECB */
  }

  if (!series.length) {
    try {
      // ECB base currencies are limited; invert when needed
      const direct = await getFrankfurterSeries(base, quote, 370);
      series = direct;
      seriesTs = direct.length ? Date.parse(direct[direct.length - 1].date) : null;
      seriesSource = "frankfurter-ecb";
    } catch {
      try {
        const inverted = await getFrankfurterSeries(quote, base, 370);
        series = inverted.map((x) => ({ date: x.date, rate: 1 / x.rate }));
        seriesTs = inverted.length ? Date.parse(inverted[inverted.length - 1].date) : null;
        seriesSource = "frankfurter-ecb";
      } catch {
        errors.push({ component: "chart", status: "UNAVAILABLE", message: "Chuỗi lịch sử không khả dụng (Yahoo 1d + Frankfurter/ECB direct + inverted) — không vẽ candles giả" });
      }
    }
  }

  const bars: OhlcvBar[] = series.map((x) => ({ time: Date.parse(x.date), open: x.rate, high: x.rate, low: x.rate, close: x.rate, volume: 0 }));
  const technical = bars.length >= 30 ? analyzeSeries(bars) : null;
  const performance = computeDailyPerformance(bars as unknown as ChartCandle[]);
  const hasQuote = current != null;
  const hasSeries = bars.length > 0;

  if (!hasQuote && !hasSeries) return null;

  const meta = buildMeta({
    source: seriesSource ?? "forex-quote",
    sourceTimestampMs: seriesTs ?? (current?.updatedAt ? Date.parse(current.updatedAt) : null),
    partial: errors.length > 0 || !hasSeries || !hasQuote || !performance,
    note: !hasQuote && !hasSeries
      ? "Không có dữ liệu nào (quote + series đều unavailable)"
      : !hasSeries
        ? "Chuỗi lịch sử không khả dụng — chỉ có giá hiện tại (không hiển thị candles giả)"
        : !hasQuote
          ? "Giá hiện tại không khả dụng — chỉ còn chuỗi lịch sử tham chiếu"
          : undefined,
    slas: { liveSlaMs: 86_400_000, freshSlaMs: 2 * 86_400_000, delayedSlaMs: 5 * 86_400_000 },
    sections: {
      quote: hasQuote ? "FRESH" : "UNAVAILABLE",
      chart: hasSeries ? "FRESH" : "UNAVAILABLE",
      technical: technical ? "FRESH" : "UNAVAILABLE",
      performance: performance ? "FRESH" : "UNAVAILABLE",
    },
    errors: errors.length ? errors : undefined,
  });

  return {
    detail: {
      pair,
      base,
      quote,
      current,
      series: bars,
      technical,
      performance,
      performanceNote:
        seriesSource === "yahoo-fx"
          ? "Hiệu suất tính trên nến đóng cửa hằng ngày thật (Yahoo Finance) — 1D/1W/1M/1Q/1Y theo mốc lịch, không nội suy."
          : "Hiệu suất tính trên tỷ giá tham chiếu ECB (chỉ khi Yahoo OHLC chưa khả dụng) — dùng cho quan sát xu hướng, không phải giá giao dịch.",
      referenceNote:
        seriesSource === "yahoo-fx"
          ? "Chuỗi lịch sử: OHLC hằng ngày từ Yahoo Finance public (FX spot). Intraday candles từ cùng provider cho chart engine."
          : "Chuỗi lịch sử: tỷ giá tham chiếu hằng ngày của Ngân hàng Trung ương châu Âu (ECB), cập nhật mỗi ngày làm việc ~16:00 CET.",
    },
    meta,
  };
}
