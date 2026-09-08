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
        role: typeof r.roleType === "string" ? r.roleType : typeof r.enRoleType === "string" ? r.enRoleType : null,
        shares: Number.isFinite(shares) ? shares : null,
        ownershipPct: Number.isFinite(pct) ? pct : null,
        effectiveDate: typeof r.effectiveDate === "string" ? r.effectiveDate : null,
      } satisfies VndShareholder;
    })
    .sort((a, b) => (b.ownershipPct ?? 0) - (a.ownershipPct ?? 0));
}
