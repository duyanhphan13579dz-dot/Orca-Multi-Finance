import "server-only";
import { cached, invalidate } from "../cache";
import { buildMeta } from "../freshness";
import {
  fetchVietnambizGoods,
  GROUP_LABELS,
  type CommodityDef,
  type CommodityGroup,
} from "../providers/commodities";
import type { CommodityRow, Meta } from "../types";

/**
 * Commodity domain — VietnamBiz Data portal ONLY.
 * Performance:
 *  - TTL 10m (Next data JSON ~12KB; cron still force-refreshes)
 *  - persistQuotes only on refresh (not every GET)
 *  - single batch DB insert
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

export const CACHE_KEY = "commodities:vnb-data-goods";
const TTL_MS = 10 * 60_000;
const STALE_MS = 24 * 3_600_000;

function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g as CommodityGroup);
  return i < 0 ? 99 : i;
}

async function fetchAll(): Promise<CommodityMarket> {
  const snap = await fetchVietnambizGoods();
  const fetchPath = snap.path ?? "unknown";
  const rows: CommodityRow[] = new Array(snap.items.length);
  const catalog: CommodityDef[] = new Array(snap.items.length);

  for (let i = 0; i < snap.items.length; i++) {
    const { def, quote } = snap.items[i];
    catalog[i] = def;
    rows[i] = {
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
    };
  }

  rows.sort((a, b) => {
    const gr = groupRank(a.group) - groupRank(b.group);
    if (gr !== 0) return gr;
    return (a.name ?? "").localeCompare(b.name ?? "", "vi");
  });
  catalog.sort((a, b) => {
    const gr = groupRank(a.group) - groupRank(b.group);
    if (gr !== 0) return gr;
    return a.nameVi.localeCompare(b.nameVi, "vi");
  });

  return {
    rows,
    unavailable: [],
    sourcesUsed: [`VietnamBiz Data (data.vietnambiz.vn/goods · ${fetchPath})`],
    errors: [],
    catalog,
  };
}

export async function getCommodityMarket(): Promise<{ data: CommodityMarket; meta: Meta } | null> {
  try {
    const res = await cached(CACHE_KEY, {
      ttlMs: TTL_MS,
      staleMs: STALE_MS,
      producer: fetchAll,
    });
    let latestTs: number | null = null;
    for (const r of res.value.rows) {
      if (!r.updatedAt) continue;
      const t = Date.parse(r.updatedAt);
      if (t > (latestTs ?? 0)) latestTs = t;
    }
    const meta = buildMeta({
      source: "VietnamBiz Data · data.vietnambiz.vn/goods",
      sourceTimestampMs: latestTs,
      cached: res.cached,
      stale: res.stale,
      note: `Đồng bộ ${res.value.rows.length} mặt hàng · ${Object.keys(GROUP_LABELS).length} nhóm · ${res.value.sourcesUsed[0] ?? ""}`,
      slas: { liveSlaMs: 30 * 60_000, freshSlaMs: 6 * 60 * 60_000, delayedSlaMs: 24 * 3_600_000 },
    });
    return { data: res.value, meta };
  } catch {
    return null;
  }
}

async function persistQuotes(rows: CommodityRow[]) {
  try {
    const { db } = await import("@/db");
    const { commodityQuotes } = await import("@/db/schema");
    const values = rows.slice(0, 80).map((r) => ({
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
    }));
    if (!values.length) return;
    await db.insert(commodityQuotes).values(values);
  } catch {
    /* best-effort */
  }
}

export async function refreshCommodityMarket(): Promise<{
  ok: boolean;
  count: number;
  durationMs: number;
  sourceTimestamp: string | null;
  errors: string[];
  error?: string;
}> {
  const t0 = Date.now();
  try {
    invalidate(CACHE_KEY);
    const res = await cached(CACHE_KEY, { ttlMs: TTL_MS, staleMs: STALE_MS, producer: fetchAll });
    void persistQuotes(res.value.rows);
    let latestTs: number | null = null;
    for (const r of res.value.rows) {
      if (!r.updatedAt) continue;
      const t = Date.parse(r.updatedAt);
      if (t > (latestTs ?? 0)) latestTs = t;
    }
    return {
      ok: true,
      count: res.value.rows.length,
      durationMs: Date.now() - t0,
      sourceTimestamp: latestTs != null ? new Date(latestTs).toISOString() : new Date().toISOString(),
      errors: res.value.errors ?? [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      count: 0,
      durationMs: Date.now() - t0,
      sourceTimestamp: null,
      errors: [msg],
      error: msg,
    };
  }
}

export { GROUP_LABELS };
