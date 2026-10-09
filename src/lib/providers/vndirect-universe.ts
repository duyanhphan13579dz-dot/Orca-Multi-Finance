import "server-only";
import { httpJson } from "../http";

const VND = "vndirect";
const base = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
  "X-Requested-With": "XMLHttpRequest",
};

/** Official VN equity floors — OHLCV cascade covers every listed STOCK on these. */
export const VN_EXCHANGES = ["HOSE", "HNX", "UPCOM"] as const;
export type VnExchange = (typeof VN_EXCHANGES)[number];

type Page<T> = {
  data?: T[];
  totalElements?: number;
  totalPages?: number;
  size?: number;
  currentPage?: number;
};

type VndStockRow = {
  code?: string;
  companyName?: string;
  companyNameEng?: string;
  shortName?: string;
  floor?: string;
  industryName?: string;
  status?: string;
  type?: string;
  listedDate?: string;
  listingDate?: string;
};

export type VndUniverseItem = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  industry: string | null;
  listedDate: string | null;
  status: string | null;
};

export const IPO_SEED_2025_2026: VndUniverseItem[] = [
  { symbol: "TCX", name: "Công ty Cổ phần Chứng khoán Techcombank", exchange: "HOSE", industry: "Chứng khoán", listedDate: "2025-10-21", status: "listed" },
  { symbol: "VPX", name: "Công ty cổ phần Chứng khoán VPBank", exchange: "HOSE", industry: "Chứng khoán", listedDate: "2025-12-11", status: "listed" },
  { symbol: "VCK", name: "Công ty Cổ phần Chứng khoán VPS", exchange: "HOSE", industry: "Chứng khoán", listedDate: "2025-12-16", status: "listed" },
  { symbol: "HPA", name: "CTCP Phát triển Nông nghiệp Hòa Phát", exchange: "HOSE", industry: "Nông nghiệp", listedDate: "2026-02-06", status: "listed" },
  { symbol: "DMX", name: "Công ty cổ phần Đầu tư Điện Máy Xanh", exchange: "HOSE", industry: "Bán lẻ", listedDate: "2026-08-06", status: "listed" },
  { symbol: "VPL", name: "Vinpearl", exchange: "HOSE", industry: "Du lịch & Giải trí", listedDate: "2025-05-01", status: "listed" },
  { symbol: "TAL", name: "Taseco Land", exchange: "HOSE", industry: "Bất động sản", listedDate: "2025-06-01", status: "listed" },
  { symbol: "CRV", name: "CRV Real Estate", exchange: "HOSE", industry: "Bất động sản", listedDate: "2025-10-01", status: "listed" },
];

async function vndGet<T>(path: string, timeoutMs = 12_000): Promise<T> {
  const res = await httpJson<T>(`${base()}${path}`, {
    provider: VND,
    timeoutMs,
    retries: 1,
    backoffBaseMs: 200,
    headers: HEADERS,
  });
  if (!res.ok || res.data == null) {
    throw new Error(`vndirect universe: ${res.error ?? "unreachable"}`);
  }
  return res.data;
}

function normalizeExchange(floor: string | null | undefined): VnExchange | null {
  const f = String(floor ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (f === "HOSE" || f === "HSX" || f === "HCM") return "HOSE";
  if (f === "HNX" || f === "HASTC") return "HNX";
  if (f === "UPCOM" || f === "UPCO") return "UPCOM";
  return null;
}

function mapRow(r: VndStockRow): VndUniverseItem | null {
  const symbol = String(r.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 2) return null;
  const st = String(r.status ?? "").toLowerCase();
  if (st.includes("delist")) return null;
  const listedDate = String(r.listedDate ?? r.listingDate ?? "").slice(0, 10) || null;
  const exchange = normalizeExchange(r.floor) ?? (r.floor ? String(r.floor).toUpperCase() : null);
  return {
    symbol,
    name: r.companyName ?? r.companyNameEng ?? r.shortName ?? null,
    exchange,
    industry: r.industryName ?? null,
    listedDate,
    status: r.status ?? null,
  };
}

export async function lookupVndSymbol(symbol: string): Promise<VndUniverseItem | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length < 2 || sym.length > 12) return null;
  try {
    const payload = await vndGet<Page<VndStockRow>>(`/v4/stocks?q=code:${sym}&size=5`, 8_000);
    const row = (payload.data ?? []).find(
      (r) => String(r.code ?? "").toUpperCase() === sym && String(r.type ?? "STOCK").toUpperCase() === "STOCK",
    );
    if (!row) return null;
    return mapRow(row);
  } catch {
    return null;
  }
}

/** Page one floor until exhausted (VNDirect returns ~200–500 per page). */
async function pageFloor(floor: VnExchange, bySym: Map<string, VndUniverseItem>): Promise<number> {
  const pageSize = 200;
  let page = 1;
  let totalPages = 1;
  let added = 0;
  while (page <= totalPages && page <= 20) {
    try {
      const payload = await vndGet<Page<VndStockRow>>(
        `/v4/stocks?q=type:STOCK~floor:${floor}&size=${pageSize}&page=${page}&sort=code:asc`,
        15_000,
      );
      const data = payload.data ?? [];
      totalPages = Math.max(1, Number(payload.totalPages) || 1);
      for (const r of data) {
        const item = mapRow(r);
        if (!item) continue;
        // Force exchange label when floor query is explicit
        const normalized: VndUniverseItem = {
          ...item,
          exchange: item.exchange ?? floor,
        };
        if (!normalized.exchange || normalizeExchange(normalized.exchange) == null) {
          normalized.exchange = floor;
        }
        const prev = bySym.get(normalized.symbol);
        if (!prev) {
          bySym.set(normalized.symbol, normalized);
          added += 1;
        } else {
          bySym.set(normalized.symbol, {
            ...prev,
            name: prev.name ?? normalized.name,
            exchange: prev.exchange ?? normalized.exchange,
            industry: prev.industry ?? normalized.industry,
            listedDate: prev.listedDate ?? normalized.listedDate,
            status: prev.status ?? normalized.status,
          });
        }
      }
      if (!data.length) break;
      page += 1;
    } catch {
      break;
    }
  }
  return added;
}

/**
 * Full equity universe across HOSE + HNX + UPCOM.
 * Strategy: floor-paged VNDirect (complete counts) → recent listings → SSI iBoard merge → IPO seeds.
 * OHLCV for any returned symbol is available via getVnOhlcv (dchart ∥ stock_prices ∥ public ∥ SSI).
 */
export async function fetchVndFullUniverse(): Promise<VndUniverseItem[]> {
  const bySym = new Map<string, VndUniverseItem>();

  for (const s of IPO_SEED_2025_2026) bySym.set(s.symbol, s);

  // Primary: page each floor independently (covers ~440 HOSE + ~360 HNX + ~1170 UPCOM)
  await Promise.all(VN_EXCHANGES.map((floor) => pageFloor(floor, bySym)));

  // Legacy LISTED query as supplemental (status spelling variants)
  try {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 15) {
      const payload = await vndGet<Page<VndStockRow>>(
        `/v4/stocks?q=type:STOCK~status:LISTED&size=500&page=${page}&sort=code:asc`,
        15_000,
      );
      const data = payload.data ?? [];
      totalPages = Math.max(1, Number(payload.totalPages) || 1);
      for (const r of data) {
        const item = mapRow(r);
        if (!item) continue;
        const prev = bySym.get(item.symbol);
        if (!prev) bySym.set(item.symbol, item);
        else if (!prev.exchange && item.exchange) {
          bySym.set(item.symbol, { ...prev, exchange: item.exchange });
        }
      }
      if (!data.length) break;
      page += 1;
    }
  } catch {
    /* non-fatal — floor pages already primary */
  }

  for (let p = 1; p <= 5; p++) {
    try {
      const recent = await vndGet<Page<VndStockRow>>(
        `/v4/stocks?q=type:STOCK&size=200&page=${p}&sort=listedDate:desc`,
        12_000,
      );
      for (const r of recent.data ?? []) {
        const item = mapRow(r);
        if (!item) continue;
        const prev = bySym.get(item.symbol);
        if (!prev) bySym.set(item.symbol, item);
        else if (!prev.listedDate && item.listedDate) {
          bySym.set(item.symbol, { ...prev, listedDate: item.listedDate, name: item.name ?? prev.name });
        }
      }
      if (!(recent.data ?? []).length) break;
    } catch {
      break;
    }
  }

  // SSI iBoard — independent HOSE/HNX/UPCOM board (fills gaps VNDirect misses)
  try {
    const { getSsiIboardUniverse } = await import("./ssi-iboard");
    const ssi = await getSsiIboardUniverse();
    for (const row of ssi) {
      const prev = bySym.get(row.symbol);
      const ex = normalizeExchange(row.exchange) ?? row.exchange;
      if (!prev) {
        bySym.set(row.symbol, {
          symbol: row.symbol,
          name: row.name,
          exchange: ex,
          industry: null,
          listedDate: row.listedDate,
          status: "listed",
        });
      } else {
        bySym.set(row.symbol, {
          ...prev,
          name: prev.name ?? row.name,
          exchange: prev.exchange ?? ex,
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  await Promise.all(
    IPO_SEED_2025_2026.map(async (s) => {
      const live = await lookupVndSymbol(s.symbol);
      if (live) bySym.set(live.symbol, live);
    }),
  );

  return [...bySym.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function filterUniverseByExchange(
  items: VndUniverseItem[],
  exchange: VnExchange | "ALL",
): VndUniverseItem[] {
  if (exchange === "ALL") return items;
  return items.filter((x) => normalizeExchange(x.exchange) === exchange);
}

export function universeCountsByExchange(items: VndUniverseItem[]): Record<VnExchange | "OTHER", number> {
  const counts: Record<VnExchange | "OTHER", number> = { HOSE: 0, HNX: 0, UPCOM: 0, OTHER: 0 };
  for (const x of items) {
    const ex = normalizeExchange(x.exchange);
    if (ex) counts[ex] += 1;
    else counts.OTHER += 1;
  }
  return counts;
}

export async function fetchVndRecentListings(withinDays = 365): Promise<VndUniverseItem[]> {
  const all = await fetchVndFullUniverse();
  const cutoff = Date.now() - Math.max(1, withinDays) * 86_400_000;
  return all
    .filter((x) => {
      if (!x.listedDate) return IPO_SEED_2025_2026.some((s) => s.symbol === x.symbol);
      const t = Date.parse(`${x.listedDate}T00:00:00+07:00`);
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => String(b.listedDate ?? "").localeCompare(String(a.listedDate ?? "")));
}
