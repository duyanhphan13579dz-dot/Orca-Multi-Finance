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

/**
 * Toàn bộ cổ phiếu đang LISTED trên HOSE/HNX/UPCOM từ VNDirect.
 * Phân trang đủ (không chỉ page 1) để bắt mã mới niêm yết.
 */
export async function fetchVndFullUniverse(): Promise<VndUniverseItem[]> {
  const pageSize = 500;
  let page = 1;
  let totalPages = 1;
  const bySym = new Map<string, VndUniverseItem>();

  // 1) status:LISTED (primary)
  while (page <= totalPages && page <= 20) {
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
  }

  // 2) Bổ sung mã type:STOCK không filter status (đôi khi mã mới chưa gắn LISTED)
  //    Chỉ lấy page đầu sort listedDate desc để bắt IPO/niêm yết gần đây
  try {
    const recent = await vndGet<Page<VndStockRow>>(
      `/v4/stocks?q=type:STOCK&size=200&page=1&sort=listedDate:desc`,
      12_000,
    );
    for (const r of recent.data ?? []) {
      const st = String(r.status ?? "").toLowerCase();
      // bỏ delisted
      if (st.includes("delist")) continue;
      const item = mapRow(r);
      if (!item) continue;
      const prev = bySym.get(item.symbol);
      if (!prev) {
        bySym.set(item.symbol, item);
      } else if (!prev.listedDate && item.listedDate) {
        bySym.set(item.symbol, { ...prev, listedDate: item.listedDate });
      }
    }
  } catch {
    /* non-fatal */
  }

  return [...bySym.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Cổ phiếu niêm yết trong N ngày gần đây (mặc định 180 ngày).
 */
export async function fetchVndRecentListings(
  withinDays = 180,
): Promise<VndUniverseItem[]> {
  const all = await fetchVndFullUniverse();
  const cutoff = Date.now() - Math.max(1, withinDays) * 86_400_000;
  return all
    .filter((x) => {
      if (!x.listedDate) return false;
      const t = Date.parse(`${x.listedDate}T00:00:00+07:00`);
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => String(b.listedDate).localeCompare(String(a.listedDate)));
}
