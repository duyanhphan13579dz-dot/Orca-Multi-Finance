import "server-only";
import { vndirectJson } from "../financial/vndirect-http";
import { vnPriceQuoteToVnd } from "../financial/vn-units";

const VND = "vndirect-company";

function normalizeYieldRatio(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const ratio = value > 1 ? value / 100 : value;
  return ratio <= 0.8 ? ratio : null;
}

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
  evEbitda: number | null;
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
  let payload: { data?: Record<string, unknown>[] };
  try {
    payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/company_profiles?q=code:${encodeURIComponent(sym)}&size=1`,
        {
          provider: VND,
          timeoutMs: 10_000,
          retries: 1,
          accept: (value) => Array.isArray(value.data) && value.data.length > 0,
        },
      )
    ).data;
  } catch {
    return null;
  }
  const row = payload.data?.[0] ?? null;
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
  let payload: { data?: Record<string, unknown>[] };
  try {
    payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/shareholders?q=code:${encodeURIComponent(sym)}&size=${Math.max(1, Math.min(100, size))}`,
        {
          provider: VND,
          timeoutMs: 6_000,
          retries: 0,
          accept: (value) => Array.isArray(value.data) && value.data.length > 0,
        },
      )
    ).data;
  } catch {
    return [];
  }
  const rows = payload.data ?? [];
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

  const attempts: { path: string; label: string }[] = [
    {
      label: "ratios-desc",
      path: `/v4/ratios?q=${encodeURIComponent(q)}&size=30&sort=reportDate:desc`,
    },
    {
      label: "ratios-out",
      path: `/v4/ratios?q=${encodeURIComponent(`code:${sym}~ratioCode:OUTSTANDING_SHARES`)}&size=5&sort=reportDate:desc`,
    },
    {
      label: "ratios-mcap",
      path: `/v4/ratios?q=${encodeURIComponent(`code:${sym}~ratioCode:MARKETCAP`)}&size=5&sort=reportDate:desc`,
    },
  ];

  let outstanding: number | null = null;
  let total: number | null = null;
  let marketCapReported: number | null = null;
  let reportDate: string | null = null;
  let source = "vndirect-ratios";

  for (const att of attempts) {
    if (att.label === "ratios-out" && (outstanding != null || total != null)) continue;
    if (att.label === "ratios-mcap" && marketCapReported != null) continue;
    try {
      const res = await vndirectJson<{
        data?: { ratioCode?: string; value?: number; reportDate?: string; itemName?: string }[];
      }>(att.path, {
        provider: VND,
        timeoutMs: 6_000,
        retries: 0,
        accept: (value) => Array.isArray(value.data) && value.data.length > 0,
      });
      const rows = res.data.data ?? [];
      if (!rows.length) continue;
      for (const r of rows) {
        const code = String(r.ratioCode ?? "").toUpperCase();
        const v = Number(r.value);
        if (!Number.isFinite(v) || v <= 0) continue;
        if (!reportDate && r.reportDate) reportDate = String(r.reportDate).slice(0, 10);
        if ((code === "OUTSTANDING_SHARES" || code === "LISTED_SHARES") && outstanding == null) {
          outstanding = v;
        }
        if (code === "TOTAL_SHARES" && total == null) total = v;
        if ((code === "MARKET_CAP" || code === "MARKETCAP") && marketCapReported == null) {
          // VNDirect MARKETCAP is in full VND, unlike the usual market quote.
          marketCapReported = v;
        }
      }
      source = `vndirect-ratios:${att.label}`;
      // The combined query may contain only market cap or only shares. Continue
      // to the focused query until we have a share count and a reported cap.
      if ((outstanding != null || total != null) && marketCapReported != null) break;
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
    "EV_TO_EBITDA",
    "ENTERPRISE_VALUE_TO_EBITDA",
    "EPS",
    "BVPS",
    "ROE",
    "ROA",
    "DIVIDEND_YIELD",
    "MARKETCAP",
    "MARKET_CAP",
  ];
  const query = `code:${sym}~ratioCode:${codes.join(",")}`;
  try {
    const res = await vndirectJson<{
      data?: { ratioCode?: string; value?: number; reportDate?: string }[];
    }>(
      `/v4/ratios?q=${encodeURIComponent(query)}&size=40&sort=reportDate:desc`,
      {
        provider: VND,
        timeoutMs: 6_000,
        retries: 0,
        accept: (value) => Array.isArray(value.data) && value.data.length > 0,
      },
    );
    const rows = res.data.data ?? [];
    if (!rows.length) return null;

    const pick = (want: string): { v: number; d: string | null } | null => {
      for (const r of rows) {
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
    const evEbitda = pick("EV_TO_EBITDA") ?? pick("ENTERPRISE_VALUE_TO_EBITDA");
    const eps = pick("EPS");
    const bvps = pick("BVPS");
    const roe = pick("ROE");
    const roa = pick("ROA");
    const dy = pick("DIVIDEND_YIELD");
    const mcap = pick("MARKETCAP") ?? pick("MARKET_CAP");

    if (!pe && !pb && !ps && !evEbitda && !mcap && !eps) return null;

    const reportDate =
      pe?.d ?? pb?.d ?? ps?.d ?? mcap?.d ?? eps?.d ?? bvps?.d ?? null;

    return {
      pe: pe && pe.v > 0 ? pe.v : null,
      pb: pb && pb.v > 0 ? pb.v : null,
      ps: ps && ps.v > 0 ? ps.v : null,
      evEbitda: evEbitda && evEbitda.v > 0 ? evEbitda.v : null,
      eps: eps ? eps.v : null,
      bvps: bvps && bvps.v > 0 ? bvps.v : null,
      roe: roe ? roe.v : null,
      roa: roa ? roa.v : null,
      dividendYield: normalizeYieldRatio(dy?.v),
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
  return vnPriceQuoteToVnd(priceQuote) ?? 0;
}
