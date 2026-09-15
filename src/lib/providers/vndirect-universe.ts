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

function mapRow(r: VndStockRow): VndUniverseItem | null {
  const symbol = String(r.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 2) return null;
  const listedDate = String(r.listedDate ?? r.listingDate ?? "").slice(0, 10) || null;
  return {
    symbol,
    name: r.companyName ?? r.companyNameEng ?? r.shortName ?? null,
    exchange: r.floor ?? null,
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
    const st = String(row.status ?? "").toLowerCase();
    if (st.includes("delist")) return null;
    return mapRow(row);
  } catch {
    return null;
  }
}

export async function fetchVndFullUniverse(): Promise<VndUniverseItem[]> {
  const pageSize = 500;
  let page = 1;
  let totalPages = 1;
  const bySym = new Map<string, VndUniverseItem>();

  for (const s of IPO_SEED_2025_2026) bySym.set(s.symbol, s);

  while (page <= totalPages && page <= 25) {
    try {
      const payload = await vndGet<Page<VndStockRow>>(
        `/v4/stocks?q=type:STOCK~status:LISTED&size=${pageSize}&page=${page}&sort=code:asc`,
        15_000,
      );
      const data = payload.data ?? [];
      totalPages = Math.max(1, Number(payload.totalPages) || 1);
      for (const r of data) {
        const item = mapRow(r);
        if (item) bySym.set(item.symbol, item);
      }
      if (!data.length) break;
      page += 1;
    } catch {
      break;
    }
  }

  for (let p = 1; p <= 5; p++) {
    try {
      const recent = await vndGet<Page<VndStockRow>>(
        `/v4/stocks?q=type:STOCK&size=200&page=${p}&sort=listedDate:desc`,
        12_000,
      );
      for (const r of recent.data ?? []) {
        const st = String(r.status ?? "").toLowerCase();
        if (st.includes("delist")) continue;
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

  // SSI iBoard — HOSE/HNX/UPCOM (độc lập VNDirect)
  try {
    const { getSsiIboardUniverse } = await import("./ssi-iboard");
    const ssi = await getSsiIboardUniverse();
    for (const row of ssi) {
      const prev = bySym.get(row.symbol);
      if (!prev) {
        bySym.set(row.symbol, {
          symbol: row.symbol,
          name: row.name,
          exchange: row.exchange,
          industry: null,
          listedDate: row.listedDate,
          status: "listed",
        });
      } else if (!prev.name && row.name) {
        bySym.set(row.symbol, { ...prev, name: row.name, exchange: prev.exchange ?? row.exchange });
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
