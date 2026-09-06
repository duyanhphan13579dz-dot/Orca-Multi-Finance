import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  COMMODITY_CATALOG,
  defByKeyOrSymbol,
  getSimplizeCommodityPage,
  getMsnQuotes,
  getVietnambizSjcGold,
  MSN_KEY_BY_KEY,
  type CommodityDef,
  type RawCommodityQuote,
} from "../providers/commodities";
import { getSpotTicker } from "../providers/binance";
import { getYahooQuotes, getYahooChart } from "../providers/yahoo";
import { env } from "../env";
import { marketStore } from "../realtime/market-store";
import { aggregateCandles, TF_MS, type ChartCandle } from "../chart-const";
import {
  computePerformance,
  commodityFreshness,
  normalizeHistory,
  buildImpactRows,
  type CommodityImpactRow,
  type HistoricalPoint,
  type PerformanceResult,
} from "../engines/commodity";
import { validateBars, validateQuote, logQualityEvent } from "../quality";
import type { CommodityRow, Meta, OhlcvBar } from "../types";

/**
 * Commodity domain service — Simplize → Vietnambiz priority, real data only.
 *
 * Every row carries: unified fields, per-row freshness (LIVE/FRESH/DELAYED/
 * STALE/UNAVAILABLE), market state (OPEN/CLOSED), provider-published
 * performance, source provenance and (via /impact) the evidence-based impact
 * matrix. No mock values anywhere in this flow.
 *
 * Realtime path: one shared provider fetch (cached + in-flight dedup) →
 * validation → normalization → Realtime Market Store (write-through) →
 * API → UI. Reads prefer the store when fresh.
 */

export interface CommodityUnavailable {
  key: string;
  name: string;
  nameVi: string;
  group: string;
  reason: string;
  freshness: "UNAVAILABLE";
}

export interface CommodityMarket {
  rows: CommodityRow[];
  unavailable: CommodityUnavailable[];
  sourcesUsed: string[];
  errors: string[];
}

/* ------------------------------ provider prep ------------------------------ */

async function paxgQuote(symbol: string): Promise<RawCommodityQuote> {
  const t = await getSpotTicker(symbol);
  return {
    source: "Binance (PAXG ≈ XAU)",
    price: Number(t.lastPrice),
    change: Number(t.priceChange),
    changePercent: Number(t.priceChangePercent),
    high: Number(t.highPrice),
    low: Number(t.lowPrice),
    unit: "USD/oz",
    currency: "USD",
    timestamp: t.closeTime ?? Date.now(),
    url: null,
  };
}

type SourceKind = "simplize" | "vietnambiz" | "yahoo" | "msn" | "binance";

/** User-mandated priority: Simplize → Vietnambiz, then real fallbacks. */
function priorityFor(def: CommodityDef): SourceKind[] {
  const order: SourceKind[] = [];
  if (def.simplizePath) order.push("simplize");
  if (def.vietnambiz) order.push("vietnambiz");
  if (def.yahooSymbol) order.push("yahoo");
  if (MSN_KEY_BY_KEY[def.key]) order.push("msn");
  if (def.binanceSymbol) order.push("binance");
  return order;
}

function simplizeRecord(def: CommodityDef): Promise<RawCommodityQuote> {
  return getSimplizeCommodityPage(def.simplizePath as string);
}

function yahooRecord(def: CommodityDef, yahooByTicker: Map<string, Awaited<ReturnType<typeof getYahooQuotes>> extends Map<string, infer V> ? V : never>): RawCommodityQuote | null {
  const y = def.yahooSymbol ? yahooByTicker.get(def.yahooSymbol) : null;
  if (!y || !Number.isFinite(y.price) || y.price <= 0) return null;
  return {
    source: "Yahoo Finance (futures)",
    price: y.price,
    change: y.change,
    changePercent: y.changePercent,
    previousClose: y.previousClose,
    high: y.dayHigh,
    low: y.dayLow,
    unit: def.unit,
    currency: def.currency,
    timestamp: y.marketTime,
    url: null,
  };
}

/* -------------------------------- fetch all -------------------------------- */

async function fetchAll(): Promise<CommodityMarket> {
  const msnIds: Record<string, string> = {};
  for (const def of COMMODITY_CATALOG) {
    const msnKey = MSN_KEY_BY_KEY[def.key];
    if (msnKey && env.msnCommodityMap[msnKey]) msnIds[def.key] = env.msnCommodityMap[msnKey];
  }
  let msnById: Record<string, RawCommodityQuote> = {};
  const errors: string[] = [];
  const sourcesUsed = new Set<string>();
  if (Object.keys(msnIds).length) {
    try {
      msnById = await getMsnQuotes(Object.values(msnIds));
      sourcesUsed.add("MSN Finance");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "msn error");
    }
  }

  const yahooTickers = COMMODITY_CATALOG.filter((d) => d.yahooSymbol).map((d) => d.yahooSymbol as string);
  let yahooByTicker = new Map<string, Awaited<ReturnType<typeof getYahooQuotes>> extends Map<string, infer V> ? V : never>();
  try {
    yahooByTicker = await getYahooQuotes(yahooTickers);
    if (yahooByTicker.size) sourcesUsed.add("Yahoo Finance (futures)");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "yahoo error");
  }

  const rows: CommodityRow[] = [];
  const unavailable: CommodityUnavailable[] = [];

  // bounded concurrency — the catalog fetches ~25 public Simplize pages;
  // never hammer a third-party site with unbounded parallel requests.
  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < COMMODITY_CATALOG.length) {
      const def = COMMODITY_CATALOG[cursor++];
      await fetchOne(def);
    }
  }
  async function fetchOne(def: CommodityDef) {
    const priority = priorityFor(def);
      if (!priority.length) {
        unavailable.push({ key: def.key, name: def.name, nameVi: def.nameVi, group: def.group, reason: "Không có nguồn công khai đáng tin cậy — không dùng dữ liệu giả", freshness: "UNAVAILABLE" });
        return;
      }
      const records: { kind: SourceKind; q: RawCommodityQuote }[] = [];
      // try in priority order; first success is primary; keep up to 3 for provenance
      for (const kind of priority) {
        try {
          let q: RawCommodityQuote | null = null;
          if (kind === "simplize") q = await simplizeRecord(def);
          else if (kind === "vietnambiz") q = await getVietnambizSjcGold();
          else if (kind === "yahoo") q = yahooRecord(def, yahooByTicker);
          else if (kind === "msn" && msnIds[def.key] && msnById[msnIds[def.key]]) q = msnById[msnIds[def.key]];
          else if (kind === "binance" && def.binanceSymbol) q = await paxgQuote(def.binanceSymbol);
          if (q && Number.isFinite(q.price) && q.price > 0) {
            records.push({ kind, q });
            if (records.length >= 3) break;
          }
        } catch {
          /* degrade to next priority — never crash the module */
        }
      }
      const best = records[0]?.q ?? null;
      if (!best) {
        unavailable.push({ key: def.key, name: def.name, nameVi: def.nameVi, group: def.group, reason: "Các nguồn hàng hóa chưa phản hồi hoặc cấu trúc trang thay đổi", freshness: "UNAVAILABLE" });
        return;
      }
      for (const r of records) sourcesUsed.add(r.q.source);

      const freshness = commodityFreshness(best.timestamp, { hasData: true });
      const providerPerf: Record<string, number | null> = {
        "1W": best.perf?.["1W"] ?? null,
        "1M": best.perf?.["1M"] ?? null,
        "3M": best.perf?.["3M"] ?? null,
        YTD: best.perf?.YTD ?? null,
        "1Y": best.perf?.["1Y"] ?? null,
        "5Y": best.perf?.["5Y"] ?? null,
      };
      const performance = (() => {
        const r = computePerformance([], {
          provider: {
            "1D": { change: best.change ?? 0, changePercent: best.changePercent ?? 0 },
            "1W": { change: 0, changePercent: best.perf?.["1W"] ?? 0 },
            "1M": { change: 0, changePercent: best.perf?.["1M"] ?? 0 },
            "1Q": { change: 0, changePercent: best.perf?.["3M"] ?? 0 },
            "1Y": { change: 0, changePercent: best.perf?.["1Y"] ?? 0 },
          },
        });
        const pick = (w: "1D" | "1W" | "1M" | "1Q" | "1Y") => {
          const p = r.find((x) => x.window === w);
          return { change: p?.change ?? null, changePercent: p?.changePercent ?? null, basis: p?.basis ?? "insufficient" };
        };
        return { "1D": pick("1D"), "1W": pick("1W"), "1M": pick("1M"), "1Q": pick("1Q"), "1Y": pick("1Y") };
      })();

      const row: CommodityRow = {
        commodity: def.name,
        symbol: def.symbol,
        group: def.group,
        assetClass: "commodity",
        price: best.price,
        change: best.change ?? null,
        changePercent: best.changePercent ?? null,
        open: best.open ?? null,
        high: best.high ?? null,
        low: best.low ?? null,
        unit: best.unit ?? def.unit,
        currency: best.currency ?? def.currency,
        updatedAt: best.timestamp ? new Date(best.timestamp).toISOString() : null,
        sourceRecords: records
          .filter((r) => Number.isFinite(r.q.price) && r.q.price > 0)
          .map((r) => ({ source: r.q.source, price: r.q.price, timestamp: r.q.timestamp ? new Date(r.q.timestamp).toISOString() : null, url: r.q.url ?? null })),
        // unified model (additive)
        id: def.key,
        name: def.name,
        nameVi: def.nameVi,
        category: def.category,
        subcategory: def.subcategory ?? null,
        previousClose: best.previousClose ?? (best.change != null ? best.price - best.change : null),
        freshness: freshness.status,
        marketState: freshness.marketState,
        freshnessNote: freshness.note ?? null,
        priceType: "CLOSE_ONLY",
        providerPerf,
        relatedStocks: best.relatedStocks ?? [],
        sourceUrl: best.url ?? null,
        sourceTimestamp: best.timestamp ? new Date(best.timestamp).toISOString() : null,
        performance,
      };

      // validation before storage: quote must be sane (never store garbage)
      // staleMs: commodity 300s per market-store contract; provider timestamps
      // often the page update time, so DELAYED/STALE is reported honestly.
      const quoteCheck = validateQuote(
        {
          price: best.price,
          open: best.open ?? null,
          high: best.high ?? null,
          low: best.low ?? null,
          volume: null,
          changePercent: best.changePercent ?? null,
          updatedAt: best.timestamp ? new Date(best.timestamp).toISOString() : null,
        },
        { assetClass: "commodity", staleMs: 300_000, sourceTimestampMs: best.timestamp ?? null },
      );
      if (quoteCheck.status === "INVALID") {
        void logQualityEvent("commodity-service", `quote:${def.key}`, quoteCheck);
        unavailable.push({ key: def.key, name: def.name, nameVi: def.nameVi, group: def.group, reason: "Giá nguồn không hợp lệ (quality check INVALID) — không lưu dữ liệu lỗi", freshness: "UNAVAILABLE" });
        return;
      }
      if (quoteCheck.status !== "VALID") void logQualityEvent("commodity-service", `quote:${def.key}`, quoteCheck);
      rows.push(row);
      // best-effort realtime store write-through (shared with all readers)
      try {
        marketStore.setQuote({
          assetType: "commodity",
          symbol: def.symbol,
          price: best.price,
          change: best.change ?? null,
          changePercent: best.changePercent ?? null,
          open: best.open ?? null,
          high: best.high ?? null,
          low: best.low ?? null,
          previousClose: best.previousClose ?? null,
          source: best.source,
          ts: best.timestamp ?? Date.now(),
        });
      } catch {
        /* store is best-effort */
      }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  rows.sort(
    (a, b) =>
      COMMODITY_CATALOG.findIndex((c) => c.symbol === a.symbol) -
      COMMODITY_CATALOG.findIndex((c) => c.symbol === b.symbol),
  );
  return { rows, unavailable, sourcesUsed: [...sourcesUsed], errors };
}

export async function getCommodityMarket(): Promise<{ data: CommodityMarket; meta: Meta } | null> {
  try {
    const res = await cached("commodities:all", { ttlMs: 5 * 60_000, staleMs: 12 * 3_600_000, producer: fetchAll });
    const allTs = res.value.rows
      .flatMap((r) => r.sourceRecords.map((s) => (s.timestamp ? Date.parse(s.timestamp) : 0)))
      .filter((x) => x > 0);
    const latestTs = allTs.length ? Math.max(...allTs) : null;
    const meta = buildMeta({
      source: res.value.sourcesUsed.join(" + ") || "commodity providers",
      sourceTimestampMs: latestTs,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.errors.length > 0 || res.value.unavailable.length > 0,
      partial: res.value.unavailable.length > 0,
      note: res.value.unavailable.length
        ? `${res.value.unavailable.length} mặt hàng chưa có nguồn khả dụng — xem trạng thái từng nhóm`
        : undefined,
      slas: { liveSlaMs: 10 * 60_000, freshSlaMs: 60 * 60_000, delayedSlaMs: 6 * 3_600_000 },
    });
    void persistQuotes(res.value.rows);
    return { data: res.value, meta };
  } catch {
    return null;
  }
}

async function persistQuotes(rows: CommodityRow[]) {
  try {
    const { db } = await import("@/db");
    const { commodityQuotes } = await import("@/db/schema");
    for (const r of rows.slice(0, 30)) {
      await db.insert(commodityQuotes).values({
        commodity: r.commodity,
        symbol: r.symbol,
        group: r.group,
        price: String(r.price),
        change: r.change != null ? String(r.change) : null,
        changePercent: r.changePercent != null ? String(r.changePercent) : null,
        unit: r.unit ?? null,
        currency: r.currency ?? null,
        source: r.sourceRecords[0]?.source ?? "unknown",
        sourceUrl: r.sourceRecords[0]?.url ?? null,
        sourceTimestamp: r.updatedAt ? new Date(r.updatedAt) : null,
      });
    }
  } catch {
    /* best-effort */
  }
}

/* --------------------------- detail + sub-engines --------------------------- */

export interface CommodityHistoryResult {
  symbol: string;
  points: ReturnType<typeof normalizeHistory>["points"];
  dropped: number;
  priceType: "OHLC" | "CLOSE_ONLY";
  source: string;
}

/** Real OHLC via Yahoo (the same futures symbols Simplize's own charts use). */
async function historyProducer(def: CommodityDef, tf: string, limit: number): Promise<CommodityHistoryResult> {
  if (!def.yahooSymbol) throw new Error("commodity_history_unavailable");
  const { interval, range, aggregate4h } = (() => {
    if (tf === "4h") return { interval: "1h", range: "730d", aggregate4h: true };
    if (tf === "1w") return { interval: "1wk", range: "10y", aggregate4h: false };
    if (tf === "1M") return { interval: "1mo", range: "max", aggregate4h: false };
    if (tf === "1d") return { interval: "1d", range: "10y", aggregate4h: false };
    if (tf === "1h") return { interval: "60m", range: "730d", aggregate4h: false };
    throw new Error("commodity_timeframe_unsupported");
  })();
  const { candles } = await getYahooChart(def.yahooSymbol, interval, range);
  let series: ChartCandle[] = candles;
  if (aggregate4h) series = aggregateCandles(candles, TF_MS["4h"]);
  const bars: OhlcvBar[] = series.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
  const q = validateBars(bars);
  if (q.status !== "VALID") {
    void logQualityEvent("commodity-history", `${def.key}:${tf}`, q);
    if (q.status === "INVALID") throw new Error("invalid commodity series");
  }
  const norm = normalizeHistory(
    def.symbol,
    "Yahoo Finance (futures)",
    q.cleaned.slice(-Math.min(limit, 1000)).map((c) => ({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
  );
  return { symbol: def.symbol, points: norm.points, dropped: norm.dropped, priceType: norm.priceType, source: "Yahoo Finance (futures)" };
}

export async function getCommodityHistory(needle: string, opts: { timeframe?: string; limit?: number } = {}): Promise<CommodityHistoryResult | null> {
  const def = defByKeyOrSymbol(needle);
  if (!def) return null;
  const tf = opts.timeframe ?? "1d";
  const limit = Math.min(Math.max(opts.limit ?? 250, 10), 1000);
  try {
    return await cached(`commodity:history:${def.key}:${tf}:${limit}`, {
      ttlMs: 10 * 60_000,
      staleMs: 24 * 3_600_000,
      producer: () => historyProducer(def, tf, limit),
    }).then((r) => r.value);
  } catch {
    return null;
  }
}

export async function getCommodityPerformance(needle: string): Promise<{ performance: PerformanceResult[]; providerPerf: Record<string, number | null> | null; basis: "historical" | "provider" } | null> {
  const def = defByKeyOrSymbol(needle);
  if (!def) return null;
  try {
    // historical first (nearest valid observation), provider metrics as fallback
    const hist = await getCommodityHistory(needle, { timeframe: "1d", limit: 400 });
    const histSeries: HistoricalPoint[] = hist ? hist.points.map((p) => ({ timestamp: p.timestamp, price: p.close })) : [];
    const market = await getCommodityMarket();
    const row = market?.data.rows.find((r) => r.symbol === def.symbol || r.id === def.key) ?? null;
    const perf = computePerformance(histSeries, {
      provider: row?.providerPerf
        ? {
            "1D": { change: row.change ?? 0, changePercent: row.changePercent ?? 0 },
            "1W": { change: 0, changePercent: row.providerPerf["1W"] ?? 0 },
            "1M": { change: 0, changePercent: row.providerPerf["1M"] ?? 0 },
            "1Q": { change: 0, changePercent: row.providerPerf["3M"] ?? 0 },
            "1Y": { change: 0, changePercent: row.providerPerf["1Y"] ?? 0 },
          }
        : undefined,
    });
    const basis = perf.some((p) => p.basis === "historical") ? "historical" : "provider";
    return { performance: perf, providerPerf: row?.providerPerf ?? null, basis };
  } catch {
    return null;
  }
}

export async function getCommodityImpact(needle: string): Promise<{ rows: CommodityImpactRow[]; note: string } | null> {
  const def = defByKeyOrSymbol(needle);
  if (!def) return null;
  try {
    const market = await getCommodityMarket();
    const row = market?.data.rows.find((r) => r.symbol === def.symbol || r.id === def.key) ?? null;
    const rows = buildImpactRows(def.name, def.vnImpact ?? null, row?.relatedStocks ?? [], {
      transmissionChannel: `${def.name} → chi phí/doanh thu ngành liên quan → kết quả kinh doanh doanh nghiệp niêm yết (exposure theo mô tả ngành công khai)`,
    });
    return {
      rows,
      note: "Đây là ECONOMIC EXPOSURE (cơ chế ngành công khai) + RELATED-SOURCE (danh sách liên quan công khai). Không suy luận nhân quả từ tương quan. Correlation nếu có chỉ là chỉ số bổ sung — CORRELATION IS NOT CAUSATION.",
    };
  } catch {
    return null;
  }
}

export interface CommodityDetail {
  def: CommodityDef;
  row: CommodityRow | null;
  unavailableReason: string | null;
}

export async function getCommodityDetail(needle: string): Promise<CommodityDetail | null> {
  const def = defByKeyOrSymbol(needle);
  if (!def) return null;
  try {
    // store-first note: fetchAll writes the shared store entry; reads below are
    // cached server-side, so no per-client provider calls happen.
    const market = await getCommodityMarket();
    const row = market?.data.rows.find((r) => r.symbol === def.symbol || r.id === def.key) ?? null;
    const unavailableReason = market?.data.unavailable.find((u) => u.key === def.key)?.reason ?? null;
    return { def, row, unavailableReason };
  } catch {
    return null;
  }
}

export const CATALOG = COMMODITY_CATALOG;
