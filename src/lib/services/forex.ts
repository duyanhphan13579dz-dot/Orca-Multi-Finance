import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getBiquoteQuotes, getErApiLatest, getFrankfurterSeries, type FxLatest } from "../providers/forex";
import { getYahooQuotes, getYahooChart, yahooSymbolForPair, yahooIntervalFor } from "../providers/yahoo";
import { analyzeSeries, detectPatterns } from "../technical";
import type { CandlePattern, ForexRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";

/**
 * Forex domain service.
 * Priority: Biquote (when configured) → exchangerate-api latest → crosses
 * computed mathematically from real USD-based rates. Daily % change is derived
 * from the previous ECB reference fix (Frankfurter) — all real timestamps.
 * Metals / energy / equity index CFDs are Yahoo-backed (yahoo-only pairs).
 */

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
  { pair: "GBPJPY", base: "GBP", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "AUDJPY", base: "AUD", quote: "JPY", group: "minor", kind: "cross" },
  { pair: "USDVND", base: "USD", quote: "VND", group: "exotic", kind: "usd-base" },
  { pair: "XAUUSD", base: "XAU", quote: "USD", group: "exotic", kind: "yahoo-only", label: "Gold vs US Dollar" },
  { pair: "XAGUSD", base: "XAG", quote: "USD", group: "exotic", kind: "yahoo-only", label: "Silver vs US Dollar" },
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

async function appendYahooOnly(rows: ForexRow[]): Promise<ForexRow[]> {
  const have = new Set(rows.map((r) => r.pair));
  const missing = PAIRS.filter((p) => p.kind === "yahoo-only" && !have.has(p.pair));
  if (!missing.length) return rows;
  try {
    const m = await getYahooQuotes(missing.map((p) => yahooSymbolForPair(p.pair)));
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

export interface ForexMarket {
  rows: ForexRow[];
  usdStrengthNote: string;
}

export async function getForexMarkets(): Promise<{ data: ForexMarket; meta: Meta } | null> {
  const prev = await prevEcbRates();
  // 1) Biquote primary
  try {
    const { rates, ts } = await getBiquoteQuotes(PAIRS.map((p) => p.pair));
    let rows = PAIRS.map((def): ForexRow | null => {
      const rate = rates[def.pair];
      if (rate == null) return null;
      return {
        pair: def.pair,
        base: def.base,
        quote: def.quote,
        group: def.group,
        symbol: displaySymbol(def),
        assetClass: "forex" as const,
        price: rate,
        change: prev ? rate - (deriveRate(def, prev.rates) ?? rate) : null,
        changePercent:
          prev && deriveRate(def, prev.rates)
            ? (rate / (deriveRate(def, prev.rates) as number) - 1) * 100
            : null,
        updatedAt: ts ? new Date(ts).toISOString() : null,
      } satisfies ForexRow;
    }).filter((x): x is ForexRow => x !== null);
    if (rows.length) {
      rows = await appendYahooOnly(rows);
      const meta = buildMeta({
        source: "biquote",
        sourceTimestampMs: ts,
        note: prev ? undefined : "Không lấy được mức tham chiếu ngày trước (ECB) — thiếu cột change",
      });
      return { data: { rows, usdStrengthNote: usdNote(rows) }, meta };
    }
  } catch {
    /* degrade to fallback */
  }
  // 2) Yahoo FX snapshot fallback
  try {
    const yahoo = await cached(`forex:yahoo:${PAIRS.length}`, {
      ttlMs: 30_000,
      staleMs: 12 * 3_600_000,
      producer: async () => {
        const m = await getYahooQuotes(PAIRS.map((p) => yahooSymbolForPair(p.pair)));
        return { m, ts: Date.now() };
      },
    });
    const rows = PAIRS.map((def): ForexRow | null => {
      const q = yahoo.value.m.get(yahooSymbolForPair(def.pair));
      if (!q || !Number.isFinite(q.price) || q.price <= 0) return null;
      const prevRate = def.kind === "yahoo-only" ? null : prev ? deriveRate(def, prev.rates) : null;
      const change =
        def.kind === "yahoo-only" ? (q.change ?? null) : prevRate != null ? q.price - prevRate : null;
      const changePercent =
        def.kind === "yahoo-only"
          ? (q.changePercent ?? null)
          : prevRate
            ? (q.price / prevRate - 1) * 100
            : null;
      return {
        pair: def.pair,
        base: def.base,
        quote: def.quote,
        group: def.group,
        symbol: displaySymbol(def),
        assetClass: "forex" as const,
        price: q.price,
        change,
        changePercent,
        updatedAt: q.marketTime ? new Date(q.marketTime).toISOString() : null,
      };
    }).filter((x): x is ForexRow => x !== null);
    if (rows.length) {
      const newest = rows.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
      const meta = buildMeta({
        source: "Yahoo Finance (FX reference)",
        sourceTimestampMs: newest || yahoo.value.ts,
        cached: yahoo.cached,
        stale: yahoo.stale,
        note: "Biquote chưa cấu hình → nguồn FX/CFD snapshot; % FX so với ECB, kim loại/dầu/chỉ số theo phiên Yahoo",
        slas: { liveSlaMs: 120_000, freshSlaMs: 30 * 60_000, delayedSlaMs: 24 * 3_600_000 },
      });
      return { data: { rows, usdStrengthNote: usdNote(rows) }, meta };
    }
  } catch {
    /* degrade to er-api */
  }
  // 3) exchangerate-api fallback
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
      const prevRate = prev ? deriveRate(def, prev.rates) : null;
      const change = prevRate != null ? rate - prevRate : null;
      const changePercent = prevRate ? (rate / prevRate - 1) * 100 : null;
      return {
        pair: def.pair,
        base: def.base,
        quote: def.quote,
        group: def.group,
        symbol: displaySymbol(def),
        assetClass: "forex" as const,
        price: rate,
        change,
        changePercent,
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
      note: "Nguồn chính Biquote không khả dụng — FX từ exchangerate-api; kim loại/dầu/chỉ số từ Yahoo",
      slas: { liveSlaMs: 3_600_000, freshSlaMs: 6 * 3_600_000, delayedSlaMs: 30 * 3_600_000 },
    });
    return { data: { rows, usdStrengthNote: usdNote(rows) }, meta };
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
  let source = "frankfurter-ecb";
  let referenceNote =
    "Chuỗi lịch sử: tỷ giá tham chiếu hằng ngày của Ngân hàng Trung ương châu Âu (ECB), cập nhật mỗi ngày làm việc ~16:00 CET. Chart intraday từ Yahoo FX.";

  const useYahooHistory = def?.kind === "yahoo-only";

  if (!useYahooHistory) {
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
      } catch {
        /* fall through */
      }
    }
  }

  if (!bars.length) {
    try {
      const y = await getYahooChart(yahooSymbolForPair(pair), "1d", "1y");
      if (y.candles?.length) {
        bars = y.candles as OhlcvBar[];
        seriesTs = bars[bars.length - 1]?.time ?? null;
        source = "yahoo-finance";
        if (def?.kind === "yahoo-only") {
          referenceNote = `Kim loại / năng lượng / chỉ số: giá và lịch sử từ Yahoo Finance (${yahooSymbolForPair(pair)}). Không phải tỷ giá ECB.`;
        }
      }
    } catch {
      /* optional */
    }
  }

  if (!bars.length && !current) return null;

  const technical = bars.length >= 30 ? analyzeSeries(bars) : null;

  let patterns: CandlePattern[] = [];
  try {
    const cfg = yahooIntervalFor("1h");
    if (cfg) {
      const y = await getYahooChart(yahooSymbolForPair(pair), cfg.interval, cfg.range);
      if (y.candles?.length) patterns = detectPatterns(y.candles as OhlcvBar[]);
    }
  } catch {
    /* optional */
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
