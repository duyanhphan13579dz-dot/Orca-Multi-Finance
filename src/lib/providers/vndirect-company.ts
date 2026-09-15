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
 * Thử nhiều ratioCode / endpoint để tránh miss dữ liệu.
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
      url: `${base()}/v4/ratios?q=${encodeURIComponent(q)}&size=20&sort=reportDate:desc`,
    },
    {
      label: "ratios-out",
      url: `${base()}/v4/ratios?q=code:${sym}~ratioCode:OUTSTANDING_SHARES&size=5&sort=reportDate:desc`,
    },
    {
      label: "ratios-total",
      url: `${base()}/v4/ratios?q=code:${sym}~ratioCode:TOTAL_SHARES&size=5&sort=reportDate:desc`,
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
        if (
          (code === "OUTSTANDING_SHARES" || code === "LISTED_SHARES") &&
          outstanding == null
        ) {
          outstanding = v;
        }
        if (code === "TOTAL_SHARES" && total == null) total = v;
        if ((code === "MARKET_CAP" || code === "MARKETCAP") && marketCapReported == null) {
          marketCapReported = v > 1e6 ? v : v * 1e9;
        }
      }
      source = `vndirect-ratios:${att.label}`;
      if (outstanding != null || total != null) break;
    } catch {
      /* next attempt */
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
