import "server-only";
import { httpJson } from "../http";

const VND = "vndirect";
const base = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

export interface VndCompanyProfile {
  code: string;
  floor: string | null;
  logo: string | null;
  vnName: string | null;
  enName: string | null;
  foundDate: string | null;
  taxCode: string | null;
  vnAddress: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  email: string | null;
  employees: number | null;
  vnSummary: string | null;
  enSummary: string | null;
}

export interface VndShareholder {
  name: string;
  type: string | null;
  role: string | null;
  shares: number | null;
  ownershipPct: number | null;
  effectiveDate: string | null;
}

/** Snapshot vốn / cổ phiếu lưu hành phục vụ định giá */
export interface VndEquitySnapshot {
  sharesOutstanding: number | null;
  totalShares: number | null;
  marketCapReported: number | null;
  reportDate: string | null;
  source: string;
}

/** Multiples & fundamentals từ VNDirect ratios (đồng bộ với DStock) */
export interface VndValuationRatios {
  pe: number | null;
  pb: number | null;
  ps: number | null;
  eps: number | null;
  bvps: number | null;
  roe: number | null;
  roa: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  reportDate: string | null;
  source: string;
}

export async function getVndCompanyProfile(symbol: string): Promise<VndCompanyProfile | null> {
  const sym = symbol.toUpperCase();
  const res = await httpJson<{ data?: Record<string, unknown>[] }>(
    `${base()}/v4/company_profiles?q=code:${sym}&size=1`,
    { provider: VND, timeoutMs: 10_000, retries: 1 },
  );
  const row = res.ok ? res.data?.data?.[0] : null;
  if (!row) return null;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    code: String(row.code ?? sym),
    floor: s(row.floor),
    logo: s(row.logo),
    vnName: s(row.vnName),
    enName: s(row.enName),
    foundDate: s(row.foundDate),
    taxCode: s(row.taxCode),
    vnAddress: s(row.vnAddress),
    phone: s(row.phone),
    fax: s(row.fax),
    website: s(row.website),
    email: s(row.email),
    employees: n(row.employees),
    vnSummary: s(row.vnSummary),
    enSummary: s(row.enSummary),
  };
}

export async function getVndShareholders(symbol: string, size = 30): Promise<VndShareholder[]> {
  const sym = symbol.toUpperCase();
  const res = await httpJson<{ data?: Record<string, unknown>[] }>(
    `${base()}/v4/shareholders?q=code:${sym}&size=${size}`,
    { provider: VND, timeoutMs: 12_000, retries: 1 },
  );
  const rows = res.ok ? res.data?.data ?? [] : [];
  return rows
    .map((r) => {
      const shares = Number(r.numberOfShares);
      const pct = Number(r.ownershipPct);
      return {
        name: String(r.shareholderName ?? "—"),
        type: typeof r.shareholderType === "string" ? r.shareholderType : null,
        role:
          typeof r.roleType === "string"
            ? r.roleType
            : typeof r.enRoleType === "string"
              ? r.enRoleType
              : null,
        shares: Number.isFinite(shares) ? shares : null,
        ownershipPct: Number.isFinite(pct) ? pct : null,
        effectiveDate: typeof r.effectiveDate === "string" ? r.effectiveDate : null,
      } satisfies VndShareholder;
    })
    .sort((a, b) => (b.ownershipPct ?? 0) - (a.ownershipPct ?? 0));
}

/**
 * Kéo snapshot CP lưu hành + vốn hóa báo cáo từ VNDirect ratios.
 */
export async function getVndEquitySnapshot(symbol: string): Promise<VndEquitySnapshot | null> {
  const sym = symbol.toUpperCase();
  const ratioCodes = [
    "OUTSTANDING_SHARES",
    "TOTAL_SHARES",
    "LISTED_SHARES",
    "MARKET_CAP",
    "MARKETCAP",
  ];
  const q = `code:${sym}~ratioCode:${ratioCodes.join(",")}`;

  const attempts: { url: string; label: string }[] = [
    {
      label: "ratios-desc",
      url: `${base()}/v4/ratios?q=${encodeURIComponent(q)}&size=30&sort=reportDate:desc`,
    },
    {
      label: "ratios-out",
      url: `${base()}/v4/ratios?q=code:${sym}~ratioCode:OUTSTANDING_SHARES&size=5&sort=reportDate:desc`,
    },
    {
      label: "ratios-mcap",
      url: `${base()}/v4/ratios?q=code:${sym}~ratioCode:MARKETCAP&size=5&sort=reportDate:desc`,
    },
  ];

  let outstanding: number | null = null;
  let total: number | null = null;
  let marketCapReported: number | null = null;
  let reportDate: string | null = null;
  let source = "vndirect-ratios";

  for (const att of attempts) {
    try {
      const res = await httpJson<{
        data?: { ratioCode?: string; value?: number; reportDate?: string; itemName?: string }[];
      }>(att.url, { provider: VND, timeoutMs: 10_000, retries: 1 });
      if (!res.ok || !res.data?.data?.length) continue;
      for (const r of res.data.data) {
        const code = String(r.ratioCode ?? "").toUpperCase();
        const v = Number(r.value);
        if (!Number.isFinite(v) || v <= 0) continue;
        if (!reportDate && r.reportDate) reportDate = String(r.reportDate).slice(0, 10);
        if ((code === "OUTSTANDING_SHARES" || code === "LISTED_SHARES") && outstanding == null) {
          outstanding = v;
        }
        if (code === "TOTAL_SHARES" && total == null) total = v;
        if ((code === "MARKET_CAP" || code === "MARKETCAP") && marketCapReported == null) {
          // VNDirect MARKETCAP luôn là VND đầy đủ (~1e11–1e15)
          marketCapReported = v;
        }
      }
      source = `vndirect-ratios:${att.label}`;
      if (outstanding != null || total != null || marketCapReported != null) break;
    } catch {
      /* next */
    }
  }

  if (outstanding == null && total == null) {
    try {
      const holders = await getVndShareholders(sym, 5);
      const sumShares = holders
        .map((h) => h.shares)
        .filter((x): x is number => x != null && x > 0)
        .reduce((a, b) => a + b, 0);
      const sumPct = holders
        .map((h) => h.ownershipPct)
        .filter((x): x is number => x != null && x > 0)
        .reduce((a, b) => a + b, 0);
      if (sumShares > 0 && sumPct >= 5 && sumPct <= 100) {
        outstanding = Math.round(sumShares / (sumPct / 100));
        source = "vndirect-shareholders-estimate";
      }
    } catch {
      /* ignore */
    }
  }

  if (outstanding == null && total == null && marketCapReported == null) return null;

  return {
    sharesOutstanding: outstanding ?? total,
    totalShares: total,
    marketCapReported,
    reportDate,
    source,
  };
}

/**
 * PE / PB / PS / EPS / BVPS / MARKETCAP từ VNDirect ratios — nguồn chuẩn DStock.
 * Giá HOSE/HNX trên API thường là nghìn đồng; MARKETCAP là VND đầy đủ.
 */
export async function getVndValuationRatios(symbol: string): Promise<VndValuationRatios | null> {
  const sym = symbol.toUpperCase();
  const codes = [
    "PRICE_TO_EARNINGS",
    "PRICE_TO_BOOK",
    "PRICE_TO_SALES",
    "EPS",
    "BVPS",
    "ROE",
    "ROA",
    "DIVIDEND_YIELD",
    "MARKETCAP",
    "MARKET_CAP",
  ];
  const url = `${base()}/v4/ratios?q=code:${sym}~ratioCode:${codes.join(",")}&size=40&sort=reportDate:desc`;
  try {
    const res = await httpJson<{
      data?: { ratioCode?: string; value?: number; reportDate?: string }[];
    }>(url, { provider: VND, timeoutMs: 10_000, retries: 1 });
    if (!res.ok || !res.data?.data?.length) return null;

    const pick = (want: string): { v: number; d: string | null } | null => {
      for (const r of res.data!.data!) {
        if (String(r.ratioCode ?? "").toUpperCase() !== want) continue;
        const v = Number(r.value);
        if (!Number.isFinite(v)) continue;
        return { v, d: r.reportDate ? String(r.reportDate).slice(0, 10) : null };
      }
      return null;
    };

    const pe = pick("PRICE_TO_EARNINGS");
    const pb = pick("PRICE_TO_BOOK");
    const ps = pick("PRICE_TO_SALES");
    const eps = pick("EPS");
    const bvps = pick("BVPS");
    const roe = pick("ROE");
    const roa = pick("ROA");
    const dy = pick("DIVIDEND_YIELD");
    const mcap = pick("MARKETCAP") ?? pick("MARKET_CAP");

    if (!pe && !pb && !ps && !mcap && !eps) return null;

    const reportDate =
      pe?.d ?? pb?.d ?? ps?.d ?? mcap?.d ?? eps?.d ?? bvps?.d ?? null;

    return {
      pe: pe && pe.v > 0 ? pe.v : null,
      pb: pb && pb.v > 0 ? pb.v : null,
      ps: ps && ps.v > 0 ? ps.v : null,
      eps: eps ? eps.v : null,
      bvps: bvps && bvps.v > 0 ? bvps.v : null,
      roe: roe ? roe.v : null,
      roa: roa ? roa.v : null,
      dividendYield: dy && dy.v >= 0 ? dy.v : null,
      marketCap: mcap && mcap.v > 0 ? mcap.v : null,
      reportDate,
      source: "vndirect-ratios",
    };
  } catch {
    return null;
  }
}

/** @deprecated dùng getVndEquitySnapshot */
export async function getVndOutstandingShares(
  symbol: string,
): Promise<{
  shares: number;
  totalShares: number | null;
  reportDate: string | null;
  source: string;
} | null> {
  const snap = await getVndEquitySnapshot(symbol);
  if (!snap?.sharesOutstanding) return null;
  return {
    shares: snap.sharesOutstanding,
    totalShares: snap.totalShares,
    reportDate: snap.reportDate,
    source: snap.source,
  };
}

/**
 * Giá quote VN (HOSE/HNX) thường là nghìn đồng.
 * BCTC + MARKETCAP VNDirect là VND đầy đủ.
 * Trả về giá VND để nhân với số CP lưu hành.
 */
export function priceQuoteToVnd(priceQuote: number): number {
  if (!Number.isFinite(priceQuote) || priceQuote <= 0) return 0;
  // Giá cổ phiếu VN hiếm khi < 1.000 VND trên sàn chính; quote < 500 gần như chắc là nghìn đồng
  if (priceQuote > 0 && priceQuote < 500) return priceQuote * 1000;
  return priceQuote;
}
