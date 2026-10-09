import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getRealtimeFxQuotes,
  getErApiLatest,
  getFrankfurterSeries,
  getBiquotePublicOhlc,
  type FxLatest,
} from "../providers/forex";
import { getYahooQuotes, getYahooChart, yahooSymbolForPair, yahooIntervalFor } from "../providers/yahoo";
import { ensureBiquoteCoreWatch, ensureBiquotePollStarted } from "../realtime/biquote-poll";
import { analyzeSeries, detectPatterns } from "../technical";
import type { Meta, OhlcvBar, CandlePattern, TechnicalSnapshot } from "../types";

export type ForexGroup = "major" | "cross" | "vnd" | "metal" | "energy";

export interface ForexPairDef {
  pair: string;
  base: string;
  quote: string;
  group: ForexGroup;
  kind: "usd-quote" | "usd-base" | "cross" | "yahoo-only";
}

export interface ForexRow {
  pair: string;
  base: string;
  quote: string;
  group: ForexGroup;
  symbol: string;
  assetClass: "forex";
  price: number;
  change: number | null;
  changePercent: number | null;
  updatedAt: string | null;
}

export interface ForexMarket {
  rows: ForexRow[];
  usdStrengthNote: string;
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

const PAIRS: ForexPairDef[] = [
  { pair: "EURUSD", base: "EUR", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "GBPUSD", base: "GBP", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "USDJPY", base: "USD", quote: "JPY", group: "major", kind: "usd-base" },
  { pair: "USDCHF", base: "USD", quote: "CHF", group: "major", kind: "usd-base" },
  { pair: "AUDUSD", base: "AUD", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "USDCAD", base: "USD", quote: "CAD", group: "major", kind: "usd-base" },
  { pair: "NZDUSD", base: "NZD", quote: "USD", group: "major", kind: "usd-quote" },
  { pair: "EURJPY", base: "EUR", quote: "JPY", group: "cross", kind: "cross" },
  { pair: "GBPJPY", base: "GBP", quote: "JPY", group: "cross", kind: "cross" },
  { pair: "EURGBP", base: "EUR", quote: "GBP", group: "cross", kind: "cross" },
  { pair: "AUDJPY", base: "AUD", quote: "JPY", group: "cross", kind: "cross" },
  { pair: "EURAUD", base: "EUR", quote: "AUD", group: "cross", kind: "cross" },
  { pair: "EURCHF", base: "EUR", quote: "CHF", group: "cross", kind: "cross" },
  { pair: "USDVND", base: "USD", quote: "VND", group: "vnd", kind: "usd-base" },
  { pair: "EURVND", base: "EUR", quote: "VND", group: "vnd", kind: "cross" },
  { pair: "XAUUSD", base: "XAU", quote: "USD", group: "metal", kind: "yahoo-only" },
  { pair: "XAGUSD", base: "XAG", quote: "USD", group: "metal", kind: "yahoo-only" },
  { pair: "XPTUSD", base: "XPT", quote: "USD", group: "metal", kind: "yahoo-only" },
  { pair: "XPDUSD", base: "XPD", quote: "USD", group: "metal", kind: "yahoo-only" },
  { pair: "OILUSD", base: "OIL", quote: "USD", group: "energy", kind: "yahoo-only" },
  { pair: "USOIL", base: "USO", quote: "USD", group: "energy", kind: "yahoo-only" },
  { pair: "UKOIL", base: "UKO", quote: "USD", group: "energy", kind: "yahoo-only" },
  { pair: "NGUSD", base: "NG", quote: "USD", group: "energy", kind: "yahoo-only" },
  { pair: "COPPER", base: "HG", quote: "USD", group: "energy", kind: "yahoo-only" },
];

function displaySymbol(def: ForexPairDef): string {
  return `${def.base}/${def.quote}`;
}

function deriveRate(def: ForexPairDef, usdRates: Record<string, number>): number | null {
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
  const dxyNote = dxy?.changePercent != null ? ` DXY ${dxy.changePercent >= 0 ? "+" : ""}${dxy.changePercent.toFixed(2)}%.` : "";
  const vnd = rows.find((r) => r.pair === "USDVND");
  const vndNote = vnd?.changePercent != null ? ` USD/VND ${vnd.changePercent >= 0 ? "+" : ""}${vnd.changePercent.toFixed(2)}%.` : "";
  const gold = rows.find((r) => r.pair === "XAUUSD");
  const goldNote = gold?.changePercent != null ? ` XAU ${gold.changePercent >= 0 ? "+" : ""}${gold.changePercent.toFixed(2)}%.` : "";
  return `Tỷ giá các cặp chính · kim loại · dầu.${dxyNote}${vndNote}${goldNote}`.trim();
}

export async function getForexMarkets(): Promise<{ data: ForexMarket; meta: Meta } | null> {
  try {
    ensureBiquotePollStarted();
    ensureBiquoteCoreWatch();
  } catch {
    /* */
  }
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
          liveSource.includes("biquote")
            ? "Realtime đa nguồn public (Biquote ∥ Yahoo ∥ ER-API) — FX/metals/oil."
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
    return {
      data: { rows, usdStrengthNote: usdNote(rows, await fetchDxySnapshot()) },
      meta: buildMeta({
        source: latest.value.source,
        sourceTimestampMs: latest.value.ts,
        cached: latest.cached,
        stale: latest.stale,
        note: "Daily reference rates (ER-API) + Yahoo metals/oil — realtime temporarily unavailable",
        partial: true,
      }),
    };
  } catch {
    return null;
  }
}

export async function getForexDetail(pairRaw: string): Promise<{ detail: ForexDetail; meta: Meta } | null> {
  const pair = pairRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const def = PAIRS.find((p) => p.pair === pair);
  if (!def && pair.length !== 6 && !pair.match(/^(XAU|XAG|OIL|USO|UKO)/)) return null;
  const base = def?.base ?? pair.slice(0, 3);
  const quote = def?.quote ?? pair.slice(3);
  const markets = await getForexMarkets();
  const current = markets?.data.rows.find((r) => r.pair === pair) ?? null;

  let bars: OhlcvBar[] = [];
  let seriesTs: number | null = null;
  let source = "public-fx";
  let referenceNote = "OHLC đa nguồn public: Biquote ∥ Yahoo ∥ ECB.";

  type Cand = { bars: OhlcvBar[]; source: string; note: string };
  const ohlcJobs: Promise<Cand | null>[] = [
    (async () => {
      try {
        const bq = await Promise.race([
          getBiquotePublicOhlc(pair, "1d", 400),
          new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
        ]);
        if (bq && bq.length >= 10)
          return { bars: bq, source: "biquote-public", note: `OHLC daily Biquote public — ${pair}.` };
      } catch {
        /* */
      }
      return null;
    })(),
    (async () => {
      try {
        const y = await Promise.race([
          getYahooChart(yahooSymbolForPair(pair), "1d", "2y"),
          new Promise<null>((r) => setTimeout(() => r(null), 9_000)),
        ]);
        if (y?.candles?.length)
          return {
            bars: y.candles as OhlcvBar[],
            source: "yahoo-finance",
            note: `Lịch sử Yahoo (${yahooSymbolForPair(pair)}).`,
          };
      } catch {
        /* */
      }
      return null;
    })(),
  ];
  if (def?.kind !== "yahoo-only") {
    ohlcJobs.push(
      (async () => {
        try {
          const direct = await Promise.race([
            getFrankfurterSeries(base, quote, 370),
            new Promise<null>((r) => setTimeout(() => r(null), 9_000)),
          ]);
          if (direct?.length) {
            return {
              bars: direct.map((x) => ({
                time: Date.parse(x.date),
                open: x.rate,
                high: x.rate,
                low: x.rate,
                close: x.rate,
                volume: 0,
              })),
              source: "frankfurter-ecb",
              note: "Tỷ giá tham chiếu ECB daily.",
            };
          }
        } catch {
          /* */
        }
        return null;
      })(),
    );
  }
  const settled = await Promise.all(ohlcJobs);
  const ok = settled.filter((x): x is Cand => Boolean(x?.bars?.length));
  if (ok.length) {
    ok.sort((a, b) => {
      const aOk = a.bars.length >= 30 ? 1 : 0;
      const bOk = b.bars.length >= 30 ? 1 : 0;
      if (aOk !== bOk) return bOk - aOk;
      return b.bars.length - a.bars.length;
    });
    bars = ok[0]!.bars;
    source = ok.map((x) => x.source).filter((s, i, a) => a.indexOf(s) === i).join("+");
    referenceNote = ok[0]!.note;
    seriesTs = bars[bars.length - 1]?.time ?? null;
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
      /* */
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
