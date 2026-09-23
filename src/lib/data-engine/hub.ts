import "server-only";
import { coalesce, hubPeek } from "./coalesce";
import { hubStats, runInDataHub } from "./request-scope";
import { catalogSummary, SOURCE_CATALOG } from "./catalog";

export { runInDataHub, hubStats };
export { SOURCE_CATALOG, catalogSummary };

const kFin = (symbol: string) => `financial:package:${symbol.trim().toUpperCase()}`;
const kQuote = (symbol: string) => `market:quote:${symbol.trim().toUpperCase()}`;
const kCrypto = (symbol: string) => `crypto:quote:${symbol.trim().toUpperCase()}`;
const kForex = (pair: string) => `forex:pair:${pair.trim().toUpperCase()}`;
const kCommodity = (id: string) => `commodity:${id.trim().toLowerCase()}`;
const kNews = (q: string) => `news:${q.trim().toLowerCase().slice(0, 80)}`;
const kMacro = (id: string) => `macro:${id}`;

export async function hubLoad<T>(
  key: string,
  producer: () => Promise<T>,
  sourceIds: string[] = [],
): Promise<T> {
  return coalesce(key, producer, { sourceIds });
}

/** BCTC package — one fetch per symbol per request. */
export async function hubFinancialPackage(symbol: string) {
  const sym = symbol.trim().toUpperCase();
  return coalesce(
    kFin(sym),
    async () => {
      const { getFinancialPackage } = await import("../financial/service");
      return getFinancialPackage(sym);
    },
    { sourceIds: ["vndirect-fs"] },
  );
}

export function hubFinancialPackagePeek(symbol: string) {
  return hubPeek(kFin(symbol.trim().toUpperCase()));
}

export function hubCrossCheckNumbers(
  pairs: Array<{ label: string; a: number | null | undefined; b: number | null | undefined; tolPct?: number }>,
): { ok: boolean; details: Array<{ label: string; ok: boolean; a: number | null; b: number | null }> } {
  const details = pairs.map(({ label, a, b, tolPct = 2 }) => {
    const na = a == null || !Number.isFinite(a) ? null : a;
    const nb = b == null || !Number.isFinite(b) ? null : b;
    if (na == null || nb == null) return { label, ok: true, a: na, b: nb };
    const base = Math.max(Math.abs(na), Math.abs(nb), 1e-9);
    const ok = (Math.abs(na - nb) / base) * 100 <= tolPct;
    return { label, ok, a: na, b: nb };
  });
  return { ok: details.every((d) => d.ok), details };
}

export const HubKeys = {
  financial: kFin,
  quote: kQuote,
  crypto: kCrypto,
  forex: kForex,
  commodity: kCommodity,
  news: kNews,
  macro: kMacro,
};
