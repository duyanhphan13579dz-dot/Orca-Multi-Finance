import "server-only";
import { cached, invalidate, peekStale } from "../cache";
import { buildMeta } from "../freshness";
import {
  fetchVietnambizGoods,
  GROUP_LABELS,
  VNB_GOODS_URL,
  type CommodityDef,
  type CommodityGroup,
} from "../providers/commodities";
import type { CommodityRow, Meta } from "../types";

/**
 * Commodity domain — VietnamBiz Data portal ONLY.
 * Performance:
 *  - TTL 15m (board updates ~daily; cron still force-refreshes)
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
const TTL_MS = 15 * 60_000;
const STALE_MS = 24 * 3_600_000;

function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g as CommodityGroup);
  return i < 0 ? 99 : i;
}

async function fetchAll(): Promise<CommodityMarket> {
  const snap = await fetchVietnambizGoods();
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
    sourcesUsed: ["VietnamBiz Data (data.vietnambiz.vn/goods)"],
    errors: [],
    catalog,
  };
}

/** Fallback: rebuild view từ DB khi VietnamBiz tạm lỗi — tránh trang trắng */
async function loadFromDB(): Promise<CommodityMarket | null> {
  try {
    const { db } = await import("@/db");
    const { commodityQuotes } = await import("@/db/schema");
    const { desc } = await import("drizzle-orm");
    // Lấy 400 bản ghi mới nhất (đủ cho 6 nhóm) — sort theo ingestedAt
    const rows = await db.select().from(commodityQuotes).orderBy(desc(commodityQuotes.ingestedAt)).limit(400);
    if (!rows.length) return null;
    const mapped: CommodityRow[] = rows.map((r) => ({
      commodity: r.commodity,
      symbol: r.symbol,
      name: (r as unknown as { nameVi?: string }).nameVi ?? r.symbol,
      group: r.group ?? "hang_tieu_dung",
      assetClass: "commodity",
      price: Number(r.price),
      change: r.change != null ? Number(r.change) : null,
      changePercent: r.changePercent != null ? Number(r.changePercent) : null,
      high: null,
      low: null,
      unit: r.unit ?? "—",
      currency: r.currency ?? "—",
      updatedAt: r.sourceTimestamp ? new Date(r.sourceTimestamp).toISOString() : r.ingestedAt ? new Date(r.ingestedAt).toISOString() : null,
      sourceRecords: [
        {
          source: (r as unknown as { source?: string }).source ?? "VietnamBiz Data (DB cache)",
          price: Number(r.price),
          timestamp: r.sourceTimestamp ? new Date(r.sourceTimestamp).toISOString() : null,
          url: (r as unknown as { sourceUrl?: string }).sourceUrl ?? VNB_GOODS_URL,
        },
      ],
    }));
    // Dedupe theo commodity key giữ bản mới nhất
    const seen = new Map<string, CommodityRow>();
    for (const m of mapped) if (!seen.has(m.commodity)) seen.set(m.commodity, m);
    const deduped = Array.from(seen.values());
    deduped.sort((a, b) => {
      const gr = groupRank(a.group) - groupRank(b.group);
      if (gr !== 0) return gr;
      return (a.name ?? "").localeCompare(b.name ?? "", "vi");
    });
    if (!deduped.length) return null;
    const catalog: CommodityDef[] = deduped.map((r) => ({
      key: r.commodity,
      name: r.name ?? r.symbol,
      nameVi: r.name ?? r.symbol,
      group: r.group as CommodityGroup,
      symbol: r.symbol,
      unit: r.unit ?? "—",
      currency: r.currency ?? "—",
    }));
    return {
      rows: deduped,
      unavailable: [],
      sourcesUsed: ["VietnamBiz Data (DB cache — nguồn tạm không truy cập được)"],
      errors: ["Đang hiển thị dữ liệu cache DB do VietnamBiz tạm gián đoạn."],
      catalog,
    };
  } catch {
    return null;
  }
}

function buildMarketMeta(value: CommodityMarket, cached: boolean, stale: boolean, degraded = false): Meta {
  let latestTs: number | null = null;
  for (const r of value.rows) {
    if (!r.updatedAt) continue;
    const t = Date.parse(r.updatedAt);
    if (t > (latestTs ?? 0)) latestTs = t;
  }
  const baseNote = `Đồng bộ ${value.rows.length} mặt hàng · ${Object.keys(GROUP_LABELS).length} nhóm`;
  const note = degraded ? `${baseNote} · đang dùng cache (nguồn tạm lỗi)` : baseNote;
  return buildMeta({
    source: degraded ? "VietnamBiz Data · cache" : "VietnamBiz Data · data.vietnambiz.vn/goods",
    sourceTimestampMs: latestTs,
    cached,
    stale: stale || degraded,
    note,
    slas: { liveSlaMs: 30 * 60_000, freshSlaMs: 6 * 60 * 60_000, delayedSlaMs: 24 * 3_600_000 },
  });
}

export async function getCommodityMarket(): Promise<{ data: CommodityMarket; meta: Meta } | null> {
  try {
    const res = await cached(CACHE_KEY, {
      ttlMs: TTL_MS,
      staleMs: STALE_MS,
      producer: fetchAll,
    });
    const degraded = res.stale;
    const meta = buildMarketMeta(res.value, res.cached, res.stale, degraded);
    // Ghi chú degraded vào errors để UI/API có thể hiển thị banner
    if (degraded && !res.value.errors.length) {
      return { data: { ...res.value, errors: ["Đang hiển thị cache (nguồn tạm chậm)."] }, meta };
    }
    return { data: res.value, meta };
  } catch (err) {
    // Tầng 2: peekStale dù đã quá staleUntil — còn hơn trả trắng trang
    try {
      const stale = peekStale<CommodityMarket>(CACHE_KEY);
      if (stale?.value && stale.value.rows.length) {
        console.warn("[commodities] serving peekStale fallback:", err instanceof Error ? err.message : err);
        const meta = buildMarketMeta(stale.value, true, true, true);
        return { data: { ...stale.value, errors: ["Nguồn VietnamBiz tạm gián đoạn — hiển thị dữ liệu cache gần nhất."] }, meta };
      }
    } catch {}
    // Tầng 3: DB fallback
    const dbFallback = await loadFromDB();
    if (dbFallback) {
      console.warn("[commodities] serving DB fallback");
      const meta = buildMarketMeta(dbFallback, true, true, true);
      return { data: dbFallback, meta };
    }
    console.error("[commodities] getCommodityMarket failed (no fallback):", err);
    return null;
  }
}

async function persistQuotes(rows: CommodityRow[]) {
  try {
    const { db } = await import("@/db");
    const { commodityQuotes } = await import("@/db/schema");
    // Lưu toàn bộ rows (chia batch 100 để tránh payload quá lớn) — để DB fallback đủ 6 nhóm
    const chunk = 100;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const values = slice.map((r) => ({
        commodity: r.commodity,
        symbol: r.symbol,
        group: r.group,
        price: String(r.price),
        change: r.change != null ? String(r.change) : null,
        changePercent: r.changePercent != null ? String(r.changePercent) : null,
        unit: r.unit ?? null,
        currency: r.currency ?? null,
        source: "VietnamBiz Data",
        sourceUrl: r.sourceRecords[0]?.url ?? VNB_GOODS_URL,
        sourceTimestamp: r.updatedAt ? new Date(r.updatedAt) : null,
      }));
      if (!values.length) continue;
      await db.insert(commodityQuotes).values(values);
    }
  } catch {
    /* best-effort */
  }
}

export async function refreshCommodityMarket(): Promise<{
  ok: boolean;
  count: number;
  groups: Record<string, number>;
  errors: string[];
  durationMs: number;
  sourceTimestamp: string | null;
}> {
  const t0 = Date.now();
  // Không invalidate trước — để stale còn phục vụ nếu fetchAny fail (tránh trắng trang do cron chạy lúc nguồn chập chờn)
  try {
    const res = await cached(CACHE_KEY, {
      ttlMs: TTL_MS,
      staleMs: STALE_MS,
      skipCache: true,
      producer: fetchAll,
    });
    void persistQuotes(res.value.rows);

    const groups: Record<string, number> = {};
    let maxTs = 0;
    for (const r of res.value.rows) {
      groups[r.group] = (groups[r.group] ?? 0) + 1;
      if (r.updatedAt) {
        const t = Date.parse(r.updatedAt);
        if (t > maxTs) maxTs = t;
      }
    }
    return {
      ok: true,
      count: res.value.rows.length,
      groups,
      errors: res.value.errors,
      durationMs: Date.now() - t0,
      sourceTimestamp: maxTs ? new Date(maxTs).toISOString() : null,
    };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      groups: {},
      errors: [e instanceof Error ? e.message : "refresh failed"],
      durationMs: Date.now() - t0,
      sourceTimestamp: null,
    };
  }
}

export const CATALOG: CommodityDef[] = [];
export { GROUP_LABELS };
