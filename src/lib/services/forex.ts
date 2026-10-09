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

function usdNote(rows: ForexRow[], dxy?: { price: number; changePercent: number | null } | null): string {
  const dxyNote = dxy?.changePercent != null ? ` DXY ${dxy.changePercent >= 0 ? "+" : ""}${dxy.changePercent.toFixed(2)}%.` : "";
  const vnd = rows.find((r) => r.pair === "USDVND");
  const vndNote = vnd?.changePercent != null ? ` USD/VND ${vnd.changePercent >= 0 ? "+" : ""}${vnd.changePercent.toFixed(2)}%.` : "";
  const gold = rows.find((r) => r.pair === "XAUUSD");
  const goldNote = gold?.changePercent != null ? ` XAU ${gold.changePercent >= 0 ? "+" : ""}${gold.changePercent.toFixed(2)}%.` : "";
  return `Tỷ giá các cặp chính · kim loại · dầu.${dxyNote}${vndNote}${goldNote}`.trim();
}

/** Priority commodities on board (Yahoo futures — few subrequests). */
const BOARD_COMMODITIES = ["XAUUSD", "XAGUSD", "OILUSD", "UKOIL", "USOIL"] as const;

/** FX majors/cross/vnd only — avoid fan-out to 24 Biquote ticks. */
const FX_LIVE_PAIRS = PAIRS.filter((p) => p.kind !== "yahoo-only").map((p) => p.pair);

async function loadCommodityRows(budgetMs = 6_000): Promise<ForexRow[]> {
  const boardSet = new Set<string>(BOARD_COMMODITIES);
  const defs = PAIRS.filter((p) => boardSet.has(p.pair));
  if (!defs.length) return [];
  try {
    const symbols = [...new Set(defs.map((d) => yahooSymbolForPair(d.pair)))];
    const map = await Promise.race([
      getYahooQuotes(symbols),
      new Promise<null>((r) => setTimeout(() => r(null), budgetMs)),
    ]);
    if (!map) return [];
    const rows: ForexRow[] = [];
    for (const def of defs) {
      const q = map.get(yahooSymbolForPair(def.pair));
      if (!q || !(q.price > 0)) continue;
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
    return rows;
  } catch {
    return [];
  }
}

function rowsFromRates(
  rates: Record<string, number>,
  ticks: Record<string, { dayDiffPercent?: number | null }> | undefined,
  ts: number | null,
): ForexRow[] {
  const out: ForexRow[] = [];
  for (const def of PAIRS) {
    const rate = rates[def.pair];
    if (rate == null || !(rate > 0)) continue;
    const tick = ticks?.[def.pair];
    const changePercent = tick?.dayDiffPercent != null ? tick.dayDiffPercent : null;
    out.push({
      pair: def.pair,
      base: def.base,
      quote: def.quote,
      group: def.group,
      symbol: displaySymbol(def),
      assetClass: "forex",
      price: rate,
      change: changePercent != null ? (rate * changePercent) / 100 : null,
      changePercent,
      updatedAt: ts ? new Date(ts).toISOString() : null,
    });
  }
  return out;
}

/**
 * Markets board — hard budget ~12s, always try partial.
 *  Parallel: Biquote+ER for FX · Yahoo for metals/oil (4–5 symbols)
 *  Cache 18s / stale 2min — never block past deadline
 */
export async function getForexMarkets(): Promise<{ data: ForexMarket; meta: Meta } | null> {
  try {
    ensureBiquotePollStarted();
    ensureBiquoteCoreWatch();
  } catch {
    /* */
  }

  try {
    const c = await cached<{ data: ForexMarket; meta: Meta }>("forex:markets:v3", {
      ttlMs: 18_000,
      staleMs: 120_000,
      producer: async () => {
        const t0 = Date.now();
        const HARD_MS = 12_000;
        const remaining = () => Math.max(500, HARD_MS - (Date.now() - t0));

        let rates: Record<string, number> = {};
        let ticks: Record<string, { dayDiffPercent?: number | null }> | undefined;
        let ts: number | null = null;
        const sources: string[] = [];

        const fxJob = (async () => {
          try {
            const live = await Promise.race([
              getRealtimeFxQuotes(FX_LIVE_PAIRS),
              new Promise<null>((r) => setTimeout(() => r(null), Math.min(8_000, remaining()))),
            ]);
            if (!live) return;
            Object.assign(rates, live.rates);
            if (live.ticks) ticks = live.ticks as typeof ticks;
            if (live.ts) ts = live.ts;
            if (live.source) sources.push(live.source);
          } catch {
            /* */
          }
        })();

        const commodityJob = (async () => {
          try {
            return await loadCommodityRows(Math.min(6_500, remaining()));
          } catch {
            return [] as ForexRow[];
          }
        })();

        const [, commodityRows] = await Promise.all([fxJob, commodityJob]);

        let rows = rowsFromRates(rates, ticks, ts);

        if (commodityRows?.length) {
          const have = new Set(rows.map((r) => r.pair));
          for (const r of commodityRows) {
            if (!have.has(r.pair)) {
              rows.push(r);
              have.add(r.pair);
            } else {
              const i = rows.findIndex((x) => x.pair === r.pair);
              if (i >= 0 && rows[i]!.changePercent == null && r.changePercent != null) {
                rows[i] = { ...rows[i]!, changePercent: r.changePercent, change: r.change };
              }
            }
          }
          if (commodityRows.length) sources.push("yahoo-commodities");
        }

        if (remaining() > 2_000) {
          const have = new Set(rows.map((r) => r.pair));
          const still = BOARD_COMMODITIES.filter((p) => !have.has(p));
          if (still.length) {
            const extra = await loadCommodityRows(Math.min(4_000, remaining()));
            for (const r of extra) {
              if (!have.has(r.pair)) {
                rows.push(r);
                have.add(r.pair);
              }
            }
          }
        }

        if (!rows.length) {
          try {
            const latest = await Promise.race([
              getErApiLatest(),
              new Promise<null>((r) => setTimeout(() => r(null), Math.min(4_000, remaining()))),
            ]);
            if (latest?.rates) {
              for (const def of PAIRS.filter((p) => p.kind !== "yahoo-only")) {
                const rate = deriveRate(def, latest.rates);
                if (rate == null) continue;
                rows.push({
                  pair: def.pair,
                  base: def.base,
                  quote: def.quote,
                  group: def.group,
                  symbol: displaySymbol(def),
                  assetClass: "forex",
                  price: rate,
                  change: null,
                  changePercent: null,
                  updatedAt: new Date(latest.ts).toISOString(),
                });
              }
              sources.push("exchangerate-api");
              ts = latest.ts;
            }
          } catch {
            /* */
          }
        }

        if (!rows.length) throw new Error("forex markets empty");

        const order = new Map(PAIRS.map((p, i) => [p.pair, i]));
        rows.sort((a, b) => (order.get(a.pair) ?? 99) - (order.get(b.pair) ?? 99));

        const source = sources.filter(Boolean).join("+") || "forex";
        const meta = buildMeta({
          source,
          sourceTimestampMs: ts ?? Date.now(),
          note: `Board FX+kim loại+dầu · ${rows.length} cặp · ${Date.now() - t0}ms`,
          partial: rows.length < PAIRS.length,
          slas: { liveSlaMs: 15_000, freshSlaMs: 60_000, delayedSlaMs: 180_000 },
        });

        return {
          data: { rows, usdStrengthNote: usdNote(rows, null) },
          meta,
        };
      },
    });

    if (!c?.value) return null;
    return {
      data: c.value.data,
      meta: {
        ...c.value.meta,
        cached: c.cached,
        stale: c.stale || c.value.meta.stale,
      },
    };
  } catch {
    return null;
  }
}

export async function getForexDetail(pairRaw: string): Promise<{ detail: ForexDetail; meta: Meta } | null> {
  const ALIAS: Record<string, string> = {
    OILUSD: "OILUSD",
    WTIUSD: "USOIL",
    WTI: "USOIL",
    BRENT: "UKOIL",
    GOLD: "XAUUSD",
    XAU: "XAUUSD",
    SILVER: "XAGUSD",
    XAG: "XAGUSD",
  };
  const pair =
    ALIAS[pairRaw.toUpperCase().replace(/[^A-Z0-9]/g, "")] ??
    pairRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const def = PAIRS.find((p) => p.pair === pair);
  if (!def && !(pair.length >= 4 && pair.length <= 10)) return null;
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
          new Promise<null>((r) => setTimeout(() => r(null), 6_000)),
        ]);
        if (bq && bq.length >= 10)
          return { bars: bq, source: "biquote-public", note: `OHLC daily Biquote — ${pair}.` };
      } catch {
        /* */
      }
      return null;
    })(),
    (async () => {
      try {
        const y = await Promise.race([
          getYahooChart(yahooSymbolForPair(pair), "1d", "2y"),
          new Promise<null>((r) => setTimeout(() => r(null), 7_000)),
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
            new Promise<null>((r) => setTimeout(() => r(null), 6_000)),
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
    ok.sort((a, b) => b.bars.length - a.bars.length);
    bars = ok[0]!.bars;
    source = ok.map((x) => x.source).filter((s, i, a) => a.indexOf(s) === i).join("+");
    referenceNote = ok[0]!.note;
    seriesTs = bars[bars.length - 1]?.time ?? null;
  }

  if (!bars.length && !current) return null;

  const technical = bars.length >= 30 ? analyzeSeries(bars) : null;
  let patterns: CandlePattern[] = [];
  try {
    const cfg = yahooIntervalFor("1h");
    if (cfg) {
      const y = await Promise.race([
        getYahooChart(yahooSymbolForPair(pair), cfg.interval, cfg.range),
        new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
      ]);
      if (y?.candles?.length) patterns = detectPatterns(y.candles as OhlcvBar[]);
    }
  } catch {
    /* */
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
    note: current ? undefined : "Giá hiện tại tạm thiếu — còn chuỗi lịch sử",
    slas: { liveSlaMs: 86_400_000, freshSlaMs: 2 * 86_400_000, delayedSlaMs: 5 * 86_400_000 },
  });
  return { detail, meta };
}
