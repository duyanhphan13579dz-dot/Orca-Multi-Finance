import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { COMMODITY_CATALOG, scrapeVietnambiz } from "../providers/commodities";
import type { CommodityRow, Meta } from "../types";

/**
 * Commodity domain — VietnamBiz ONLY.
 * Pulls every catalog item from vietnambiz.vn boards; no secondary sources.
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

async function fetchAll(): Promise<CommodityMarket> {
  const errors: string[] = [];
  const rows: CommodityRow[] = [];
  const unavailable: CommodityUnavailable[] = [];
  const sourcesUsed = new Set<string>();

  await Promise.all(
    COMMODITY_CATALOG.map(async (def) => {
      try {
        const q = await scrapeVietnambiz(def);
        sourcesUsed.add("VietnamBiz");
        rows.push({
          commodity: def.key,
          symbol: def.symbol,
          name: def.nameVi,
          group: def.group,
          assetClass: "commodity",
          price: q.price,
          change: q.change ?? null,
          changePercent: q.changePercent ?? null,
          high: q.high ?? null,
          low: q.low ?? null,
          unit: q.unit ?? def.unit,
          currency: q.currency ?? def.currency,
          updatedAt: q.timestamp ? new Date(q.timestamp).toISOString() : null,
          sourceRecords: [
            {
              source: q.source,
              price: q.price,
              timestamp: q.timestamp ? new Date(q.timestamp).toISOString() : null,
              url: q.url ?? null,
            },
          ],
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "vietnambiz error";
        errors.push(`${def.key}: ${msg}`);
        unavailable.push({
          key: def.key,
          name: def.name,
          nameVi: def.nameVi,
          group: def.group,
          reason: msg,
        });
      }
    }),
  );

  rows.sort(
    (a, b) =>
      COMMODITY_CATALOG.findIndex((c) => c.key === a.commodity) -
      COMMODITY_CATALOG.findIndex((c) => c.key === b.commodity),
  );

  return { rows, unavailable, sourcesUsed: [...sourcesUsed], errors };
}

export async function getCommodityMarket(): Promise<{ data: CommodityMarket; meta: Meta } | null> {
  try {
    const res = await cached("commodities:vnb-only", {
      ttlMs: 5 * 60_000,
      staleMs: 12 * 3_600_000,
      producer: fetchAll,
    });
    const allTs = res.value.rows
      .flatMap((r) => r.sourceRecords.map((s) => (s.timestamp ? Date.parse(s.timestamp) : 0)))
      .filter((x) => x > 0);
    const latestTs = allTs.length ? Math.max(...allTs) : null;
    const meta = buildMeta({
      source: "VietnamBiz (Hàng hóa)",
      sourceTimestampMs: latestTs,
      cached: res.cached,
      stale: res.stale,
      degraded: res.value.errors.length > 0 || res.value.unavailable.length > 0,
      partial: res.value.unavailable.length > 0,
      note: res.value.unavailable.length
        ? `${res.value.unavailable.length}/${COMMODITY_CATALOG.length} mặt hàng parse lỗi từ VietnamBiz`
        : `Đồng bộ ${res.value.rows.length} mặt hàng từ VietnamBiz`,
      slas: { liveSlaMs: 15 * 60_000, freshSlaMs: 2 * 60 * 60_000, delayedSlaMs: 12 * 3_600_000 },
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
        source: "VietnamBiz",
        sourceUrl: r.sourceRecords[0]?.url ?? null,
        sourceTimestamp: r.updatedAt ? new Date(r.updatedAt) : null,
      });
    }
  } catch {
    /* best-effort */
  }
}

export const CATALOG = COMMODITY_CATALOG;
