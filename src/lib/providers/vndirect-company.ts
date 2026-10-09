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
  /** Mã đăng ký kinh doanh (thường trùng MST). */
  registrationCode: string | null;
  vnAddress: string | null;
  enAddress: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  email: string | null;
  employees: number | null;
  branches: number | null;
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

/** Công ty con / liên doanh / công ty mẹ / kiểm toán / tư vấn niêm yết. */
export type VndRelationType =
  | "SUBSIDIARY"
  | "ASSOCIATE"
  | "PARENT"
  | "AUDITOR"
  | "LISTCONSUL"
  | "OTHER"
  | string;

export interface VndCompanyRelation {
  code: string;
  relationType: VndRelationType;
  nameVn: string;
  nameEn: string | null;
  relationId: number | null;
  ownershipPct: number | null;
  investmentCapital: number | null;
  unit: string | null;
  effectiveDate: string | null;
  year: string | null;
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
    registrationCode: s(row.registrationCode) ?? s(row.taxCode),
    vnAddress: s(row.vnAddress),
    enAddress: s(row.enAddress),
    phone: s(row.phone),
    fax: s(row.fax),
    website: s(row.website),
    email: s(row.email),
    employees: n(row.employees),
    branches: n(row.branches),
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

/**
 * Quan hệ doanh nghiệp: công ty con, liên doanh/liên kết, công ty mẹ, kiểm toán, tư vấn niêm yết.
 * Dedup theo (relationType + nameVn), giữ bản ghi mới nhất theo effectiveDate/year.
 */
export async function getVndCompanyRelations(
  symbol: string,
  size = 80,
): Promise<VndCompanyRelation[]> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return [];

  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/company_relations?q=code:${encodeURIComponent(sym)}&size=${Math.max(1, Math.min(200, size))}`,
        {
          provider: VND,
          timeoutMs: 12_000,
          retries: 2,
          accept: (value) => Array.isArray(value.data),
        },
      )
    ).data;
    const rows = payload.data ?? [];
    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const mapped: VndCompanyRelation[] = rows
      .map((r) => {
        const nameVn = s(r.relationNameVn) ?? s(r.relationNameEn) ?? "";
        return {
          code: String(r.code ?? sym),
          relationType: (s(r.relationType) ?? "OTHER") as VndRelationType,
          nameVn,
          nameEn: s(r.relationNameEn),
          relationId: n(r.relationId),
          ownershipPct: n(r.ownershipPct),
          investmentCapital: n(r.investmentCapital),
          unit: s(r.unit),
          effectiveDate: s(r.effectiveDate),
          year: s(r.year),
        };
      })
      .filter((x) => x.nameVn);

    const byKey = new Map<string, VndCompanyRelation>();
    for (const row of mapped) {
      const key = `${row.relationType}::${row.nameVn.toLowerCase()}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, row);
        continue;
      }
      const prevScore = (prev.effectiveDate ?? prev.year ?? "") + "";
      const nextScore = (row.effectiveDate ?? row.year ?? "") + "";
      if (nextScore >= prevScore) byKey.set(key, row);
    }

    const preferredOrder = ["PARENT", "SUBSIDIARY", "ASSOCIATE", "AUDITOR", "LISTCONSUL"];
    return [...byKey.values()].sort((a, b) => {
      const ia = preferredOrder.indexOf(String(a.relationType).toUpperCase());
      const ib = preferredOrder.indexOf(String(b.relationType).toUpperCase());
      const ra = ia < 0 ? 99 : ia;
      const rb = ib < 0 ? 99 : ib;
      if (ra !== rb) return ra - rb;
      const oa = a.ownershipPct ?? -1;
      const ob = b.ownershipPct ?? -1;
      return ob - oa;
    });
  } catch {
    return [];
  }
}

export async function getVndValuationRatios(symbol: string): Promise<VndValuationRatios | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  try {
    const payload = (
      await vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/ratios?q=code:${encodeURIComponent(sym)}&size=100&sort=reportDate:desc`,
        {
          provider: VND,
          timeoutMs: 10_000,
          retries: 2,
          accept: (value) => Array.isArray(value.data) && value.data.length > 0,
        },
      )
    ).data;
    const rows = payload.data ?? [];
    if (!rows.length) return null;

    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };

    let pe: number | null = null;
    let pb: number | null = null;
    let ps: number | null = null;
    let evEbitda: number | null = null;
    let eps: number | null = null;
    let bvps: number | null = null;
    let roe: number | null = null;
    let roa: number | null = null;
    let dividendYield: number | null = null;
    let marketCap: number | null = null;
    let reportDate: string | null = null;

    for (const r of rows) {
      const rc = String(r.ratioCode ?? "").toUpperCase();
      const val = n(r.value);
      if (val == null) continue;
      if (!reportDate && typeof r.reportDate === "string") reportDate = r.reportDate;

      if (rc === "PRICE_TO_EARNINGS" && pe == null) pe = val;
      if (rc === "PRICE_TO_BOOK" && pb == null) pb = val;
      if (rc === "PRICE_TO_SALES" && ps == null) ps = val;
      if (rc === "EV_EBITDA" && evEbitda == null) evEbitda = val;
      if (rc === "EPS" && eps == null) eps = val;
      if ((rc === "BVPS_CR" || rc === "BVPS") && bvps == null) bvps = val;
      if (rc === "ROE" && roe == null) roe = val;
      if (rc === "ROA" && roa == null) roa = val;
      if (rc === "DIVIDEND_YIELD" && dividendYield == null) dividendYield = normalizeYieldRatio(val);
      if (rc === "MARKETCAP" && marketCap == null) marketCap = val;
    }

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
      marketCap,
      reportDate,
      source: "vndirect",
    };
  } catch {
    return null;
  }
}

export async function getVndEquitySnapshot(symbol: string): Promise<VndEquitySnapshot | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  try {
    const [pricePayload, ratiosPayload] = await Promise.allSettled([
      vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/stock_prices?q=code:${encodeURIComponent(sym)}&size=1&sort=date:desc`,
        {
          provider: VND,
          timeoutMs: 8_000,
          retries: 1,
          accept: (value) => Array.isArray(value.data),
        },
      ),
      vndirectJson<{ data?: Record<string, unknown>[] }>(
        `/v4/ratios?q=code:${encodeURIComponent(sym)}&size=60&sort=reportDate:desc`,
        {
          provider: VND,
          timeoutMs: 8_000,
          retries: 1,
          accept: (value) => Array.isArray(value.data),
        },
      ),
    ]);

    const priceRow =
      pricePayload.status === "fulfilled" ? pricePayload.value.data?.data?.[0] : null;
    const ratioRows =
      ratiosPayload.status === "fulfilled" ? ratiosPayload.value.data?.data ?? [] : [];

    const n = (v: unknown) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };

    let outstanding: number | null = null;
    let total: number | null = null;
    let marketCap: number | null = null;
    let reportDate: string | null = null;

    for (const r of ratioRows) {
      const rc = String(r.ratioCode ?? "").toUpperCase();
      const val = n(r.value);
      if (val == null) continue;
      if (!reportDate && typeof r.reportDate === "string") reportDate = r.reportDate;

      if ((rc === "OUTSTANDING_SHARES" || rc === "LISTED_SHARES") && outstanding == null) {
        outstanding = val;
      }
      if (rc === "TOTAL_SHARES" && total == null) total = val;
      if (rc === "MARKETCAP" && marketCap == null) marketCap = val;
    }

    if (priceRow) {
      if (outstanding == null) outstanding = n(priceRow.listedShare) ?? n(priceRow.sharesOutstanding);
      if (total == null) total = n(priceRow.totalShare) ?? outstanding;
      if (marketCap == null) marketCap = n(priceRow.marketCap);
      if (!reportDate && typeof priceRow.date === "string") reportDate = priceRow.date;
    }

    if (outstanding == null && total == null && marketCap == null) return null;

    return {
      sharesOutstanding: outstanding ?? total,
      totalShares: total ?? outstanding,
      marketCapReported: marketCap,
      reportDate,
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
