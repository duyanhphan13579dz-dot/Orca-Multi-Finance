import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  COMMODITY_CATALOG,
  defByKeyOrSymbol,
  type CommodityDef,
  type RawCommodityQuote,
} from "../providers/commodities";
import { getVnbGoodsQuotes } from "../providers/vietnambiz-data";
import { getYahooChart } from "../providers/yahoo";
import { env } from "../env";
import { marketStore } from "../realtime/market-store";
import { aggregateCandles, TF_MS, type ChartCandle } from "../chart-const";
import {
  computePerformance,
  commodityFreshness,
  normalizeHistory,
  buildImpactRows,
  computeSensitivity,
  type CommodityImpactRow,
  type HistoricalPoint,
  type PerformanceResult,
  type SensitivityResult,
} from "../engines/commodity";
import { aggregateNews } from "../providers/news";
import { validateBars, validateQuote, logQualityEvent } from "../quality";
import type { CommodityRow, Meta, NewsArticle, OhlcvBar } from "../types";

/**
 * Commodity domain service — nguồn DUY NHẤT VietnamBiz Data (WiFeed /goods).
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

/* ------------------------- nguồn DUY NHẤT: WiFeed --------------------------
 * User directive 2026-09-06: toàn bộ hàng hóa lấy từ data.vietnambiz.vn/goods.
 * Simplize (và Yahoo/MSN/Binance quote) đã bỏ. Yahoo chỉ còn cho chart OHLC
 * lịch sử (getCommodityHistory). Mỗi cycle: 1 request bảng WiFeed → map 66 mục
 * → validate → market store. Cache WiFeed 6h (nguồn chỉ refresh 00:00 hằng ngày);
 * nguồn trực tiếp lỗi → fallback bản ghi cuối ≤48h đã lưu DB (nhãn STALE, không mock).
 */

/** Bản ghi WiFeed cuối cùng đã lưu DB (< 48h) — dữ liệu THẬT, chỉ dùng khi nguồn trực tiếp lỗi. */
async function loadLastKnownQuotes(): Promise<Map<string, RawCommodityQuote>> {
  try {
    const { db } = await import("@/db");
    const { commodityQuotes } = await import("@/db/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await db.select().from(commodityQuotes).orderBy(desc(commodityQuotes.ingestedAt)).limit(800);
    const out = new Map<string, RawCommodityQuote>();
    const cutoff = Date.now() - 48 * 3_600_000;
    for (const r of rows) {
      if (out.has(r.symbol)) continue; // đã có bản mới nhất cho symbol này
      const ts = r.sourceTimestamp ? new Date(r.sourceTimestamp).getTime() : (r.ingestedAt ? new Date(r.ingestedAt).getTime() : null);
      if (ts == null || ts < cutoff) continue; // quá cũ → không dùng
      const price = r.price != null ? Number(r.price) : NaN;
      if (!Number.isFinite(price) || price <= 0) continue;
      out.set(r.symbol, {
        source: `${r.source ?? "VietnamBiz Data (WiFeed)"} — bản ghi cuối`,
        price,
        change: r.change != null ? Number(r.change) : null,
        changePercent: r.changePercent != null ? Number(r.changePercent) : null,
        unit: r.unit ?? null,
        currency: r.currency ?? null,
        timestamp: ts,
        url: r.sourceUrl,
      });
    }
    return out;
  } catch {
    return new Map(); // DB chưa cấu hình → chỉ UNAVAILABLE, không giả
  }
}

async function fetchAll(): Promise<CommodityMarket> {
  const errors: string[] = [];
  const sourcesUsed = new Set<string>();
  const rows: CommodityRow[] = [];
  const unavailable: CommodityUnavailable[] = [];
  let vnbDataByKey: Map<string, RawCommodityQuote> | null = null;
  try {
    vnbDataByKey = await getVnbGoodsQuotes();
    if (vnbDataByKey.size) sourcesUsed.add("VietnamBiz Data (WiFeed)");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  // Nguồn trực tiếp lỗi → thử bản ghi WiFeed cuối đã lưu DB (nhãn STALE/DELAYED thật)
  let usingLastKnown = false;
  if (!vnbDataByKey || vnbDataByKey.size === 0) {
    const lk = await loadLastKnownQuotes();
    if (lk.size > 0) {
      vnbDataByKey = new Map<string, RawCommodityQuote>();
      for (const def of COMMODITY_CATALOG) {
        const q = lk.get(def.symbol);
        if (q) vnbDataByKey.set(def.key, q);
      }
      if (vnbDataByKey.size > 0) {
        usingLastKnown = true;
        sourcesUsed.add("VietnamBiz Data (WiFeed) — bản ghi cuối (DB)");
        errors.push("WiFeed trực tiếp tạm lỗi — đang hiển thị bản ghi cuối cùng (≤48h) đã lưu từ trang /goods (dữ liệu thật, không phải mock)");
      }
    }
  }

  for (const def of COMMODITY_CATALOG) {
    const best = vnbDataByKey?.get(def.key) ?? null;
    if (!best || !Number.isFinite(best.price) || best.price <= 0) {
      const reason = errors.length
        ? `Nguồn duy nhất (VietnamBiz Data) lỗi — ${errors.slice(0, 2).join(" | ")}`
        : `Không có dòng "${def.nameVi}" trên data.vietnambiz.vn/goods — không dùng dữ liệu giả`;
      unavailable.push({ key: def.key, name: def.name, nameVi: def.nameVi, group: def.group, reason, freshness: "UNAVAILABLE" });
      continue;
    }

    const freshness = commodityFreshness(best.timestamp, { hasData: true });
    if (usingLastKnown) {
      freshness.note = "Nguồn WiFeed trực tiếp tạm lỗi — giá là bản công bố cuối cùng đã lưu (refresh 00:00 hằng ngày)";
    }
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
      sourceRecords: [{
        source: best.source,
        price: best.price,
        timestamp: best.timestamp ? new Date(best.timestamp).toISOString() : null,
        url: best.url ?? null,
      }],
      id: def.key,
      name: def.name,
      nameVi: def.nameVi,
      category: def.category,
      subcategory: def.subcategory ?? null,
      subgroup: def.subgroup ?? def.subcategory ?? null,
      market: def.market,
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
      continue;
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

  rows.sort(
    (a, b) =>
      COMMODITY_CATALOG.findIndex((c) => c.symbol === a.symbol) -
      COMMODITY_CATALOG.findIndex((c) => c.symbol === b.symbol),
  );
  return { rows, unavailable, sourcesUsed: [...sourcesUsed], errors };
}

export async function getCommodityMarket(): Promise<{ data: CommodityMarket; meta: Meta } | null> {
  try {
    const res = await cached("commodities:all", { ttlMs: env.commoditySnapshotTtlMs, staleMs: 12 * 3_600_000, producer: fetchAll });
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

/** Chỉ ghi khi giá/timestamp đổi (WiFeed đổi 1 lần/ngày → ~1 write/mục/ngày). */
const lastPersisted = new Map<string, string>();

async function persistQuotes(rows: CommodityRow[]) {
  try {
    const { db } = await import("@/db");
    const { commodityQuotes } = await import("@/db/schema");
    for (const r of rows) {
      const sig = `${r.symbol}:${r.price}:${r.sourceTimestamp ?? ""}`;
      if (lastPersisted.get(r.symbol) === sig) continue;
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
      lastPersisted.set(r.symbol, sig);
    }
    if (lastPersisted.size > 200) lastPersisted.clear(); // chống leak
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

/** Real OHLC lịch sử via Yahoo futures — CHỈ cho chart, không dùng làm quote. */
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

/* ---------------------- NEWS & CATALYST / CORRELATION ---------------------- */

/** keyword set for the news filter — curated per commodity + derived from name */
function newsKeywordsFor(def: CommodityDef): string[] {
  const kws = new Set<string>(def.newsKeywords ?? []);
  const words = `${def.name} ${def.nameVi} ${def.subcategory ?? ""} ${def.group}`
    .toLowerCase()
    .split(/[^a-z0-9à-ỹđ]+/)
    .filter((w) => w.length >= 2 && !["usd","vnd","cny","jpy","the","và","của"].includes(w));
  for (const w of words) kws.add(w);
  return [...kws];
}

export interface CommodityNewsResult {
  articles: NewsArticle[];
  note: string;
  basis: "keyword-match";
}

/**
 * Latest news related to a commodity — real RSS articles filtered by
 * commodity keywords (title/summary), newest first. Never shows old news as a
 * fresh catalyst: timestamps come from the feeds (validated by news engine).
 */
export async function getCommodityNews(needle: string): Promise<CommodityNewsResult | null> {
  const def = defByKeyOrSymbol(needle);
  if (!def) return null;
  const keywords = newsKeywordsFor(def);
  if (!keywords.length) return { articles: [], note: "Không có từ khóa tin tức cho hàng hóa này", basis: "keyword-match" };
  try {
    const res = await cached(`commodity:news:${def.key}`, {
      ttlMs: 3 * 60_000,
      staleMs: 30 * 60_000,
      producer: async () => {
        const { articles } = await aggregateNews();
        const hits = articles
          .filter((a) => {
            const hay = `${a.title} ${a.summary ?? ""}`.toLowerCase();
            return keywords.some((k) => hay.includes(k.toLowerCase()));
          })
          .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
          .slice(0, 8);
        return { articles: hits, note: "Lọc từ nguồn tin thật (RSS) theo từ khóa hàng hóa — mới nhất trước", basis: "keyword-match" as const };
      },
    });
    return res.value;
  } catch {
    return { articles: [], note: "Nguồn tin chưa khả dụng — không tự tạo catalyst", basis: "keyword-match" };
  }
}

export interface CommodityCorrelationResult {
  correlation: SensitivityResult;
  benchmark: string;
}

/**
 * Historical correlation + sensitivity vs VNINDEX (benchmark). Computed from
 * REAL price series only (Yahoo futures history for INTL commodities); VN
 * domestic commodities have no public history series → INSUFFICIENT_DATA.
 * Statistics are NEVER used as causal evidence (note in result).
 */
export async function getCommodityCorrelation(needle: string): Promise<CommodityCorrelationResult | null> {
  const def = defByKeyOrSymbol(needle);
  if (!def) return null;
  const insufficient = (obs: number, why: string): CommodityCorrelationResult => ({
    benchmark: "^VNINDEX",
    correlation: { r: null, beta: null, observations: obs, window: "1Y", status: "INSUFFICIENT_DATA", note: why },
  });
  try {
    const series = (await getCommodityHistory(needle, { timeframe: "1d", limit: 500 }))?.points ?? [];
    if (series.length < 30) {
      return insufficient(series.length, "Không có chuỗi lịch sử giá thật đủ dài cho hàng hóa này (nguồn chỉ công bố giá hiện tại) — không ước lượng tương quan");
    }
    const indexRes = await cached("commodity:benchmark:^VNINDEX:1d", {
      ttlMs: 30 * 60_000,
      staleMs: 24 * 3_600_000,
      producer: () => getYahooChart("^VNINDEX", "1d", "10y"),
    }).then((r) => r.value);
    if (!indexRes.candles.length) return insufficient(0, "Chuỗi chỉ số VNINDEX chưa khả dụng — không ước lượng tương quan");
    const commodity: HistoricalPoint[] = series.map((p) => ({ timestamp: p.timestamp, price: p.close }));
    const benchmark: HistoricalPoint[] = indexRes.candles.map((c) => ({ timestamp: c.time, price: c.close }));
    const correlation = computeSensitivity(commodity, benchmark, "1Y");
    return { benchmark: "^VNINDEX", correlation };
  } catch {
    return insufficient(0, "Không thể tính tương quan (nguồn lịch sử lỗi) — không tự tạo số liệu");
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
