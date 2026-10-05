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
  const sym = symbol.toUpperCase();
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/company_profiles?q=code:${encodeURIComponent(sym)}&size=1`,
        {
          provider: VND,
          timeoutMs: 14_000,
          retries: 2,
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

export async function getVndShareholders(symbol: string, size = 30): Promise<VndShareholder[]> {
  const sym = symbol.toUpperCase();
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/shareholders?q=code:${encodeURIComponent(sym)}&size=${Math.max(1, Math.min(100, size))}`,
        {
          provider: VND,
          timeoutMs: 10_000,
          retries: 1,
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
  const sym = symbol.toUpperCase();
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/ratios?q=code:${encodeURIComponent(sym)}~itemCode:TOTAL_EQUITY,OUTSTANDING_SHARE,MARKET_CAP&size=20`,
        { provider: VND, timeoutMs: 12_000, retries: 1 },
      )
    ).data;
    const rows = payload.data ?? [];
    let sharesOutstanding: number | null = null;
    let totalShares: number | null = null;
    let marketCapReported: number | null = null;
    let reportDate: string | null = null;
    for (const r of rows) {
      const code = String(r.itemCode ?? "");
      const val = Number(r.value ?? r.numericValue);
      if (!Number.isFinite(val)) continue;
      if (code.includes("OUTSTANDING") || code.includes("SHARE")) sharesOutstanding = val;
      if (code.includes("TOTAL_EQUITY")) totalShares = val;
      if (code.includes("MARKET_CAP")) marketCapReported = val;
      if (typeof r.reportDate === "string") reportDate = r.reportDate;
    }
    if (sharesOutstanding == null && totalShares == null && marketCapReported == null) {
      try {
        const holders = await getVndShareholders(sym, 5);
        const sum = holders.reduce((a, h) => a + (h.shares ?? 0), 0);
        if (sum > 0) sharesOutstanding = sum;
      } catch {
        /* */
      }
    }
    if (sharesOutstanding == null && totalShares == null && marketCapReported == null) return null;
    return {
      sharesOutstanding,
      totalShares,
      marketCapReported: marketCapReported != null ? vnPriceQuoteToVnd(marketCapReported) : null,
      reportDate,
      source: VND,
    };
  } catch {
    return null;
  }
}

export async function getVndValuationRatios(symbol: string): Promise<VndValuationRatios | null> {
  const sym = symbol.toUpperCase();
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/ratios?q=code:${encodeURIComponent(sym)}~itemCode:PE,PB,PS,EV_EBITDA,EPS,BVPS,ROE,ROA,DIVIDEND_YIELD,MARKET_CAP&size=40`,
        { provider: VND, timeoutMs: 12_000, retries: 1 },
      )
    ).data;
    const rows = payload.data ?? [];
    const pick = (codes: string[]) => {
      for (const r of rows) {
        const c = String(r.itemCode ?? "").toUpperCase();
        if (codes.some((x) => c.includes(x))) {
          const v = Number(r.value ?? r.numericValue);
          if (Number.isFinite(v)) return v;
        }
      }
      return null;
    };
    const pe = pick(["PE"]);
    const pb = pick(["PB"]);
    const ps = pick(["PS"]);
    const evEbitda = pick(["EV_EBITDA", "EVEBITDA"]);
    const eps = pick(["EPS"]);
    const bvps = pick(["BVPS"]);
    const roe = pick(["ROE"]);
    const roa = pick(["ROA"]);
    const dividendYield = normalizeYieldRatio(pick(["DIVIDEND_YIELD", "DIVYIELD"]));
    const marketCap = pick(["MARKET_CAP"]);
    let reportDate: string | null = null;
    for (const r of rows) {
      if (typeof r.reportDate === "string") {
        reportDate = r.reportDate;
        break;
      }
    }
    if ([pe, pb, ps, eps, bvps, roe, marketCap].every((x) => x == null)) return null;
    return {
      pe,
      pb,
      ps,
      evEbitda,
      eps,
      bvps,
      roe,
      roa,
      dividendYield,
      marketCap: marketCap != null ? vnPriceQuoteToVnd(marketCap) : null,
      reportDate,
      source: VND,
    };
  } catch {
    return null;
  }
}

/** @deprecated dùng getVndEquitySnapshot */
export async function getVndOutstandingShares(
  symbol: string,
): Promise<{ shares: number | null; source: string } | null> {
  const snap = await getVndEquitySnapshot(symbol);
  if (!snap) return null;
  return { shares: snap.sharesOutstanding ?? snap.totalShares, source: snap.source };
}
