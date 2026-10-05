import "server-only";
import { vndirectJson } from "../financial/vndirect-http";
import { vnPriceQuoteToVnd } from "../financial/vn-units";

const VND = "vndirect-company";

/** Alias dùng bởi valuation / screener / intelligence (board-lot → full VND). */
export const priceQuoteToVnd = vnPriceQuoteToVnd;

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

export interface VndEquitySnapshot {
  sharesOutstanding: number | null;
  totalShares: number | null;
  marketCapReported: number | null;
  reportDate: string | null;
  source: string;
}

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

function mapProfileRow(sym: string, row: Record<string, unknown>): VndCompanyProfile {
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

export async function getVndCompanyProfile(symbol: string): Promise<VndCompanyProfile | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;

  async function once(timeoutMs: number, retries: number): Promise<VndCompanyProfile | null> {
    try {
      const payload = (
        await vndirectJson<{ data?: Record<string, unknown>[] }>(
          `/v4/company_profiles?q=code:${encodeURIComponent(sym)}&size=1`,
          {
            provider: VND,
            timeoutMs,
            retries,
            accept: (value) => Array.isArray(value.data) && value.data.length > 0,
          },
        )
      ).data;
      const row = payload.data?.[0] ?? null;
      if (!row) return null;
      return mapProfileRow(sym, row);
    } catch {
      return null;
    }
  }

  const first = await once(10_000, 2);
  if (first) return first;
  return once(15_000, 2);
}

export async function getVndShareholders(symbol: string, size = 30): Promise<VndShareholder[]> {
  const sym = symbol.toUpperCase();
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/shareholders?q=code:${encodeURIComponent(sym)}&size=${Math.max(1, Math.min(100, size))}`,
        {
          provider: VND,
          timeoutMs: 12_000,
          retries: 2,
          accept: (value) => Array.isArray(value.data),
        },
      )
    ).data;
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
        };
      })
      .filter((x) => x.name && x.name !== "—");
  } catch {
    return [];
  }
}

export async function getVndEquitySnapshot(symbol: string): Promise<VndEquitySnapshot | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/stock_prices?q=code:${encodeURIComponent(sym)}&size=1&sort=date:desc`,
        {
          provider: VND,
          timeoutMs: 10_000,
          retries: 1,
          accept: (value) => Array.isArray(value.data),
        },
      )
    ).data;
    const row = payload.data?.[0];
    if (!row) return null;
    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };
    return {
      sharesOutstanding: n(row.listedShare) ?? n(row.sharesOutstanding),
      totalShares: n(row.totalShare) ?? n(row.listedShare),
      marketCapReported: n(row.marketCap),
      reportDate: typeof row.date === "string" ? row.date : null,
      source: "vndirect",
    };
  } catch {
    return null;
  }
}

export async function getVndValuationRatios(symbol: string): Promise<VndValuationRatios | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/ratios?q=code:${encodeURIComponent(sym)}&size=1&sort=reportDate:desc`,
        {
          provider: VND,
          timeoutMs: 10_000,
          retries: 1,
          accept: (value) => Array.isArray(value.data) && value.data.length > 0,
        },
      )
    ).data;
    const row = payload.data?.[0];
    if (!row) return null;
    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };
    return {
      pe: n(row.pe) ?? n(row.priceToEarning),
      pb: n(row.pb) ?? n(row.priceToBook),
      ps: n(row.ps) ?? n(row.priceToSales),
      evEbitda: n(row.evEbitda),
      eps: n(row.eps),
      bvps: n(row.bvps) ?? n(row.bookValuePerShare),
      roe: n(row.roe),
      roa: n(row.roa),
      dividendYield: normalizeYieldRatio(n(row.dividendYield)),
      marketCap: n(row.marketCap),
      reportDate: typeof row.reportDate === "string" ? row.reportDate : null,
      source: "vndirect",
    };
  } catch {
    return null;
  }
}

export async function getVndOutstandingShares(
  symbol: string,
): Promise<{ shares: number | null; source: string } | null> {
  const snap = await getVndEquitySnapshot(symbol);
  if (!snap) return null;
  return {
    shares: snap.sharesOutstanding ?? snap.totalShares,
    source: snap.source,
  };
}
