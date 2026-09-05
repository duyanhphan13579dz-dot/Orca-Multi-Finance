import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { getBiquoteQuotes, getErApiLatest, getFrankfurterSeries, type FxLatest } from "../providers/forex";
import { getYahooQuotes, yahooSymbolForPair } from "../providers/yahoo";
import { analyzeSeries } from "../technical";
import type { ForexRow, Meta, OhlcvBar, TechnicalSnapshot } from "../types";

/**
 * Forex domain service.
 * Priority: Biquote (when configured) → exchangerate-api latest → crosses
 * computed mathematically from real USD-based rates. Daily % change is derived
 * from the previous ECB reference fix (Frankfurter) — all real timestamps.
 */

interface PairDef {
  pair: string; // e.g. EURUSD
  base: string;
  quote: string;
  group: ForexRow["group"];
  /** how to derive from USD-based rates */
  kind: "usd-quote" | "usd-base" | "cross";
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

export interface ForexMarket {
  rows: ForexRow[];
  usdStrengthNote: string;
}

export async function getForexMarkets(): Promise<{ data: ForexMarket; meta: Meta } | null> {
  const prev = await prevEcbRates();
  // 1) Biquote primary
  try {
    const { rates, ts } = await getBiquoteQuotes(PAIRS.map((p) => p.pair));
    const rows = PAIRS.map((def): ForexRow | null => {
      const rate = rates[def.pair];
      if (rate == null) return null;
      return {
        pair: def.pair, base: def.base, quote: def.quote, group: def.group,
        symbol: `${def.base}/${def.quote}`, assetClass: "forex" as const,
        price: rate,
        change: prev ? rate - (deriveRate(def, prev.rates) ?? rate) : null,
        changePercent: prev && deriveRate(def, prev.rates) ? (rate / (deriveRate(def, prev.rates) as number) - 1) * 100 : null,
        updatedAt: ts ? new Date(ts).toISOString() : null,
      } satisfies ForexRow;
    }).filter((x): x is ForexRow => x !== null);
    if (rows.length) {
      const meta = buildMeta({ source: "biquote", sourceTimestampMs: ts, note: prev ? undefined : "Không lấy được mức tham chiếu ngày trước (ECB) — thiếu cột change" });
      return { data: { rows, usdStrengthNote: usdNote(rows) }, meta };
    }
  } catch {
    /* degrade to fallback */
  }
  // 2) Yahoo FX snapshot fallback (approved public reference — batch pair quotes)
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
      const prevRate = prev ? deriveRate(def, prev.rates) : null;
      const change = prevRate != null ? q.price - prevRate : null;
      const changePercent = prevRate ? (q.price / prevRate - 1) * 100 : null;
      return {
        pair: def.pair, base: def.base, quote: def.quote, group: def.group,
        symbol: `${def.base}/${def.quote}`, assetClass: "forex" as const,
        price: q.price, change, changePercent,
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
        note: "Biquote chưa cấu hình → nguồn FX snapshot tham chiếu; % thay đổi so với fix ECB gần nhất",
        slas: { liveSlaMs: 120_000, freshSlaMs: 30 * 60_000, delayedSlaMs: 24 * 3_600_000 },
      });
      return { data: { rows, usdStrengthNote: usdNote(rows) }, meta };
    }
  } catch {
    /* degrade to er-api */
  }
  // 3) exchangerate-api fallback (real)
  try {
    const latest = await cached<FxLatest>("forex:er-latest", {
      ttlMs: 10 * 60_000,
      staleMs: 26 * 3_600_000,
      producer: () => getErApiLatest(),
    });
    const rates = latest.value.rates;
    const rows = PAIRS.map((def): ForexRow | null => {
      const rate = deriveRate(def, rates);
      if (rate == null) return null;
      const prevRate = prev ? deriveRate(def, prev.rates) : null;
      const change = prevRate != null ? rate - prevRate : null;
      const changePercent = prevRate ? (rate / prevRate - 1) * 100 : null;
      return {
        pair: def.pair, base: def.base, quote: def.quote, group: def.group,
        symbol: `${def.base}/${def.quote}`, assetClass: "forex" as const,
        price: rate, change, changePercent,
        updatedAt: new Date(latest.value.ts).toISOString(),
      } satisfies ForexRow;
    }).filter((x): x is ForexRow => x !== null);
    if (!rows.length) return null;
    const meta = buildMeta({
      source: latest.value.source,
      sourceTimestampMs: latest.value.ts,
      cached: latest.cached,
      stale: latest.stale,
      note: "Nguồn chính Biquote không khả dụng — dùng tỷ giá tham chiếu realtime từ exchangerate-api; % thay đổi so với fix ECB gần nhất",
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
  series: OhlcvBar[]; // ECB daily reference closes (o=h=l=c=rate)
  technical: TechnicalSnapshot | null;
  referenceNote: string;
}

export async function getForexDetail(pairRaw: string): Promise<{ detail: ForexDetail; meta: Meta } | null> {
  const pair = pairRaw.toUpperCase().replace(/[^A-Z]/g, "");
  if (pair.length !== 6) return null;
  const base = pair.slice(0, 3);
  const quote = pair.slice(3);
  const markets = await getForexMarkets();
  const current = markets?.data.rows.find((r) => r.pair === pair) ?? null;
  let series: { date: string; rate: number }[];
  let seriesTs: number | null = null;
  try {
    // ECB base currencies are limited; invert when needed
    const direct = await getFrankfurterSeries(base, quote, 370);
    series = direct;
    seriesTs = direct.length ? Date.parse(direct[direct.length - 1].date) : null;
  } catch {
    try {
      const inverted = await getFrankfurterSeries(quote, base, 370);
      series = inverted.map((x) => ({ date: x.date, rate: 1 / x.rate }));
      seriesTs = inverted.length ? Date.parse(inverted[inverted.length - 1].date) : null;
    } catch {
      return null;
    }
  }
  const bars: OhlcvBar[] = series.map((x) => ({
    time: Date.parse(x.date),
    open: x.rate, high: x.rate, low: x.rate, close: x.rate, volume: 0,
  }));
  const technical = bars.length >= 30 ? analyzeSeries(bars) : null;
  const detail: ForexDetail = {
    pair, base, quote, current,
    series: bars, technical,
    referenceNote: "Chuỗi lịch sử: tỷ giá tham chiếu hằng ngày của Ngân hàng Trung ương châu Âu (ECB), cập nhật mỗi ngày làm việc ~16:00 CET.",
  };
  const meta = buildMeta({
    source: "frankfurter-ecb",
    sourceTimestampMs: seriesTs,
    note: current ? undefined : "Giá hiện tại không khả dụng — chỉ còn chuỗi tham chiếu ECB",
    slas: { liveSlaMs: 86_400_000, freshSlaMs: 2 * 86_400_000, delayedSlaMs: 5 * 86_400_000 },
  });
  return { detail, meta };
}
