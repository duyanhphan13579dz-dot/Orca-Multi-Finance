import "server-only";

import { cached } from "../cache";
import { getSsiUniverse } from "../providers/ssi-fcdata";
import { getVndUniverse } from "../providers/vndirect";

export type MasterSource = "ssi" | "vndirect";

export type SecurityMasterRecord = {
  symbol: string;
  companyName: string | null;
  exchange: string | null;
  industry: string | null;
  securityType: "stock" | "fund" | "covered-warrant" | "other";
  sources: MasterSource[];
  provenance: {
    companyName: MasterSource | null;
    exchange: MasterSource | null;
    industry: MasterSource | null;
  };
  conflicts: Array<"companyName" | "exchange" | "industry">;
  updatedAt: string;
};

type ProviderRecord = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  industry: string | null;
};

const EXCHANGE_ALIASES: Record<string, string> = {
  HOSE: "HOSE",
  HSX: "HOSE",
  HNX: "HNX",
  UPCOM: "UPCOM",
  UPC: "UPCOM",
};

const INDUSTRY_ALIASES: Record<string, string> = {
  BANK: "Ngân hàng",
  BANKING: "Ngân hàng",
  "NGAN HANG": "Ngân hàng",
  SECURITIES: "Chứng khoán",
  "CHUNG KHOAN": "Chứng khoán",
  INSURANCE: "Bảo hiểm",
  "BAO HIEM": "Bảo hiểm",
  "REAL ESTATE": "Bất động sản",
  "BAT DONG SAN": "Bất động sản",
};

function normalizeText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizedComparable(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  return text ? text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : null;
}

function normalizeExchange(value: string | null | undefined): string | null {
  const key = normalizedComparable(value);
  return key ? EXCHANGE_ALIASES[key] ?? key : null;
}

function normalizeIndustry(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const key = normalizedComparable(text)?.replace(/[^A-Z0-9 ]/g, "") ?? "";
  return INDUSTRY_ALIASES[key] ?? text;
}

function classify(symbol: string): SecurityMasterRecord["securityType"] {
  if (/^CW\d|^C[A-Z0-9]{3,}$/.test(symbol)) return "covered-warrant";
  if (/^E1|^FU|^FUEVFV|^VFM|^SSIAM/.test(symbol)) return "fund";
  return "stock";
}

function distinct(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function mergeSecurityMaster(
  ssiRows: ProviderRecord[],
  vndirectRows: ProviderRecord[],
  updatedAt = new Date().toISOString(),
): SecurityMasterRecord[] {
  const bySymbol = new Map<string, { ssi?: ProviderRecord; vndirect?: ProviderRecord }>();
  for (const source of [{ rows: ssiRows, key: "ssi" as const }, { rows: vndirectRows, key: "vndirect" as const }]) {
    for (const row of source.rows) {
      const symbol = normalizeText(row.symbol)?.toUpperCase();
      if (!symbol) continue;
      const current = bySymbol.get(symbol) ?? {};
      current[source.key] = { ...row, symbol };
      bySymbol.set(symbol, current);
    }
  }

  return [...bySymbol.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, rows]) => {
    const ssi = rows.ssi;
    const vnd = rows.vndirect;
    const companyName = normalizeText(ssi?.name) ?? normalizeText(vnd?.name);
    const exchange = normalizeExchange(ssi?.exchange) ?? normalizeExchange(vnd?.exchange);
    const industry = normalizeIndustry(ssi?.industry) ?? normalizeIndustry(vnd?.industry);
    const conflicts: SecurityMasterRecord["conflicts"] = [];
    if (ssi?.name && vnd?.name && normalizedComparable(ssi.name) !== normalizedComparable(vnd.name)) conflicts.push("companyName");
    if (ssi?.exchange && vnd?.exchange && normalizeExchange(ssi.exchange) !== normalizeExchange(vnd.exchange)) conflicts.push("exchange");
    if (ssi?.industry && vnd?.industry && normalizedComparable(normalizeIndustry(ssi.industry)) !== normalizedComparable(normalizeIndustry(vnd.industry))) conflicts.push("industry");
    return {
      symbol,
      companyName,
      exchange,
      industry,
      securityType: classify(symbol),
      sources: [ssi ? "ssi" : null, vnd ? "vndirect" : null].filter((x): x is MasterSource => x != null),
      provenance: {
        companyName: ssi?.name ? "ssi" : vnd?.name ? "vndirect" : null,
        exchange: ssi?.exchange ? "ssi" : vnd?.exchange ? "vndirect" : null,
        industry: ssi?.industry ? "ssi" : vnd?.industry ? "vndirect" : null,
      },
      conflicts,
      updatedAt,
    };
  });
}

export async function getCanonicalSecurityMaster(): Promise<SecurityMasterRecord[]> {
  const result = await cached("vn:security-master:ssi-vndirect:v1", {
    ttlMs: 6 * 3_600_000,
    staleMs: 24 * 3_600_000,
    producer: async () => {
      const [ssi, vndirect] = await Promise.allSettled([getSsiUniverse(), getVndUniverse()]);
      const ssiRows = ssi.status === "fulfilled" ? ssi.value : [];
      const vndirectRows = vndirect.status === "fulfilled" ? vndirect.value : [];
      if (!ssiRows.length && !vndirectRows.length) throw new Error("No security master source available");
      return mergeSecurityMaster(ssiRows, vndirectRows);
    },
  });
  return result.value;
}

export function toCanonicalUniverse(records: SecurityMasterRecord[]) {
  return records.map((record) => ({
    symbol: record.symbol,
    name: record.companyName,
    exchange: record.exchange,
    industry: record.industry,
    sources: record.sources,
    conflicts: record.conflicts,
  }));
}

export function canonicalSourceCoverage(records: SecurityMasterRecord[]) {
  return {
    total: records.length,
    bothSources: records.filter((record) => record.sources.length === 2).length,
    conflicts: records.filter((record) => record.conflicts.length > 0).length,
    industries: distinct(records.map((record) => record.industry)).length,
  };
}

export function normalizeSecurityMasterText(value: string | null | undefined) {
  return normalizeText(value);
}
