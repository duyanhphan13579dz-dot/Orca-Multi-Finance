import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  fetchVietnambizGoods,
  GROUP_LABELS,
  type CommodityDef,
  type CommodityGroup,
} from "../providers/commodities";
import type { CommodityRow, Meta } from "../types";

/**
 * Commodity domain — VietnamBiz Data portal ONLY
 * https://data.vietnambiz.vn/goods — all groups synchronized.
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
  catalog: CommodityDef[];
}

const GROUP_ORDER: CommodityGroup[] = [
  "hang_tieu_dung",
  "kim_loai_phi_kim",
  "hoa_chat",
  "vat_lieu_xay_dung",
  "nang_luong",
  "nhua_va_cao_su",
];

async function fetchAll(): Promise<CommodityMarket> {
  const snap = await fetchVietnambizGoods();
  const rows: CommodityRow[] = [];
  const catalog: CommodityDef[] = [];

  for (const { def, quote } of snap.items) {
    catalog.push(def);
    rows.push({
      commodity: def.key,
      symbol: def.symbol,
      name: def.nameVi,
      group: def.group,
      assetClass: "commodity",
      price: quote.price,
      change: quote.change ?? null,
      changePercent: quote.changePercent ?? null,
      high: quote.high ?? null,
      low: quote.low ?? null,
      unit: quote.unit ?? def.unit,
      currency: quote.currency ?? def.currency,
      updatedAt: quote.timestamp ? new Date(quote.timestamp).toISOString() : null,
      sourceRecords: [
        {
          source: quote.source,
          price: quote.price,
          timestamp: quote.timestamp ? new Date(quote.timestamp).toISOString() : null,
          url: quote.url ?? "https://data.vietnambiz.vn/goods",
        },
      ],
    });
  }

  rows.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group as CommodityGroup);
    const gb = GROUP_ORDER.indexOf(b.group as CommodityGroup);
    if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
    return (a.name ?? "").localeCompare(b.name ?? "", "vi");
  });
  catalog.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.nameVi.localeCompare(b.nameVi, "vi");
  });

  return {
    rows,
    unavailable: [],
    sourcesUsed: ["VietnamBiz Data (data.vietnambiz.vn/goods)"],
    errors: [],
    catalog,
  };
}

export async function getCommodityMarket(): Promise<{ data: CommodityMarket; meta: Meta } | null> {
  try {
    const res = await cached("commodities:vnb-data-goods", {
      ttlMs: 5 * 60_000,
      staleMs: 12 * 3_600_000,
      producer: fetchAll,
    });
    const allTs = res.value.rows
      .map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : 0))
      .filter((x) => x > 0);
    const latestTs = allTs.length ? Math.max(...allTs) : null;
    const meta = buildMeta({
      source: "VietnamBiz Data · data.vietnambiz.vn/goods",
      sourceTimestampMs: latestTs,
      cached: res.cached,
      stale: res.stale,
      note: `Đồng bộ ${res.value.rows.length} mặt hàng · ${Object.keys(GROUP_LABELS).length} nhóm`,
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
    for (const r of rows.slice(0, 80)) {
      await db.insert(commodityQuotes).values({
        commodity: r.commodity,
        symbol: r.symbol,
        group: r.group,
        price: String(r.price),
        change: r.change != null ? String(r.change) : null,
        changePercent: r.changePercent != null ? String(r.changePercent) : null,
        unit: r.unit ?? null,
        currency: r.currency ?? null,
        source: "VietnamBiz Data",
        sourceUrl: r.sourceRecords[0]?.url ?? "https://data.vietnambiz.vn/goods",
        sourceTimestamp: r.updatedAt ? new Date(r.updatedAt) : null,
      });
    }
  } catch {
    /* best-effort */
  }
}

export const CATALOG: CommodityDef[] = [];
export { GROUP_LABELS };
