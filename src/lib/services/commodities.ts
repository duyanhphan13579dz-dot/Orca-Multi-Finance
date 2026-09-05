import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  COMMODITY_CATALOG,
  getMsnQuotes,
  getSimplizeCommodity,
  getVietnambizSjcGold,
  type CommodityDef,
  type RawCommodityQuote,
} from "../providers/commodities";
import { getSpotTicker } from "../providers/binance";
import { getYahooQuotes } from "../providers/yahoo";
import { env } from "../env";
import type { CommodityRow, Meta } from "../types";

/**
 * Commodity domain service — aggregation + normalization layer.
 * Sources per instrument (priority): configured primary (Vietnambiz/Simplize/MSN)
 * → cross-source checks. Every row exposes ALL raw source records for
 * transparency (multi-source provenance is a product requirement).
 */

export interface CommodityUnavailable {
  key: string;
  name: string;
  nameVi: string;
  group: string;
  reason: string;
}

export interface CommodityMarket {
  rows: CommodityRow[];
  unavailable: CommodityUnavailable[];
  sourcesUsed: string[];
  errors: string[];
}

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

type SourceKind = "msn" | "binance" | "vietnambiz" | "simplize" | "yahoo";

/**
 * PROVIDER PRIORITY — configurable per asset/data-type, never a single
 * hardcoded "best" provider. VN domestic data prefers local sources;
 * world benchmarks prefer exchange/futures references.
 */
function priorityFor(def: CommodityDef): SourceKind[] {
  if (def.vietnambiz) return ["vietnambiz", "simplize", "msn", "yahoo", "binance"]; // VN domestic (SJC)
  if (def.binanceSymbol) return ["msn", "binance", "yahoo", "simplize"]; // 24/7 spot proxy available
  return ["simplize", "msn", "yahoo"]; // world futures benchmarks
}

async function fetchAll(): Promise<CommodityMarket> {
  const msnMap = env.msnCommodityMap;
  const msnIds: Record<string, string> = {}; // defKey -> instrumentId
  for (const def of COMMODITY_CATALOG) {
    if (def.msnKey && msnMap[def.msnKey]) msnIds[def.key] = msnMap[def.msnKey];
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

  // Approved public reference source — batch quotes for world benchmarks
  const yahooTickers = COMMODITY_CATALOG.filter((d) => d.yahooSymbol).map((d) => d.yahooSymbol as string);
  let yahooByTicker = new Map<string, Awaited<ReturnType<typeof getYahooQuotes>> extends Map<string, infer V> ? V : never>();
  try {
    yahooByTicker = await getYahooQuotes(yahooTickers);
    if (yahooByTicker.size) sourcesUsed.add("Yahoo Finance (futures/spot reference)");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "yahoo error");
  }

  const rows: CommodityRow[] = [];
  const unavailable: CommodityUnavailable[] = [];

  await Promise.all(
    COMMODITY_CATALOG.map(async (def) => {
      const records: { kind: string; q: RawCommodityQuote }[] = [];
      if (def.msnKey && msnIds[def.key] && msnById[msnIds[def.key]]) {
        records.push({ kind: "msn", q: msnById[msnIds[def.key]] });
      }
      if (def.binanceSymbol) {
        try {
          records.push({ kind: "binance", q: await paxgQuote(def.binanceSymbol) });
        } catch {
          /* not fatal */
        }
      }
      if (def.vietnambiz === "sjc-gold") {
        try {
          records.push({ kind: "vietnambiz", q: await getVietnambizSjcGold() });
        } catch {
          /* scraping is fragile by design */
        }
      }
      if (def.yahooSymbol) {
        const y = yahooByTicker.get(def.yahooSymbol);
        if (y && Number.isFinite(y.price)) {
          // unit normalization: US cents → USD where the contract quotes cents
          const f = def.centsQuoted ? 0.01 : 1;
          records.push({
            kind: "yahoo",
            q: {
              source: "Yahoo Finance",
              price: y.price * f,
              change: y.change != null ? y.change * f : null,
              changePercent: y.changePercent,
              high: y.dayHigh != null ? y.dayHigh * f : null,
              low: y.dayLow != null ? y.dayLow * f : null,
              unit: def.unit,
              currency: def.currency,
              timestamp: y.marketTime,
            },
          });
        }
      }
      if (env.simplizeApiKey) {
        try {
          records.push({ kind: "simplize", q: await getSimplizeCommodity(def.key) });
        } catch {
          /* degrade */
        }
      }
      const priority = priorityFor(def);
      records.sort((a, b) => priority.indexOf(a.kind as never) - priority.indexOf(b.kind as never));
      const best = records[0]?.q;
      if (!best || !Number.isFinite(best.price)) {
        unavailable.push({
          key: def.key,
          name: def.name,
          nameVi: def.nameVi,
          group: def.group,
          reason: records.length
            ? "Nguồn dữ liệu trả về giá trị không hợp lệ"
            : "Chưa cấu hình nguồn khả dụng (Vietnambiz/Simplize/MSN_COMMODITY_MAP)",
        });
        return;
      }
      for (const r of records) sourcesUsed.add(r.q.source);
      rows.push({
        commodity: def.name,
        symbol: def.symbol,
        group: def.group,
        assetClass: "commodity",
        price: best.price,
        change: best.change ?? null,
        changePercent: best.changePercent ?? null,
        high: best.high ?? null,
        low: best.low ?? null,
        unit: best.unit ?? def.unit,
        currency: best.currency ?? def.currency,
        updatedAt: best.timestamp ? new Date(best.timestamp).toISOString() : null,
        sourceRecords: records
          .filter((r) => Number.isFinite(r.q.price))
          .map((r) => ({ source: r.q.source, price: r.q.price, timestamp: r.q.timestamp ? new Date(r.q.timestamp).toISOString() : null, url: r.q.url ?? null })),
      });
    }),
  );

  rows.sort((a, b) => COMMODITY_CATALOG.findIndex((c) => c.symbol === a.symbol) - COMMODITY_CATALOG.findIndex((c) => c.symbol === b.symbol));
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
    // persist canonical records (best-effort, non-blocking)
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
    for (const r of rows.slice(0, 20)) {
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

export const CATALOG = COMMODITY_CATALOG;
