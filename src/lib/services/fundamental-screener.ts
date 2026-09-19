import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth } from "../engines/fundamental";
import { periodsToLegacyRows } from "../financial/vndirect-fs";
import { getFinancialPackage } from "../financial/service";
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import { DEFAULT_SYMBOLS } from "./valuation-screener";

export type FundamentalScreenRow = {
  symbol: string;
  sector: string | null;
  price: number | null;
  roe: number | null;
  roa: number | null;
  ros: number | null;
  roic: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  reportDate: string | null;
  score: number;
};

const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? null : Number((value * 100).toFixed(2));

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function screenFundamental(opts: { symbols?: string[]; sector?: string }) {
  const symbols = (opts.symbols?.length ? opts.symbols : DEFAULT_SYMBOLS.split(","))
    .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((s, i, all) => s.length >= 3 && all.indexOf(s) === i)
    .slice(0, 80);
  const key = `screener:fundamental:${symbols.join(",")}`;
  const result = await cached(key, {
    ttlMs: 15 * 60_000,
    staleMs: 60 * 60_000,
    producer: async () => {
      const quotes = await getVnQuotes(symbols).catch(() => null);
      const quoteMap = new Map((quotes?.quotes ?? []).map((q) => [q.symbol, q]));
      const rows = (await mapPool(symbols, 4, async (symbol): Promise<FundamentalScreenRow | null> => {
        const financial = await getFinancialPackage(symbol).catch(() => null);
        if (!financial?.pkg.periods?.length) return null;
        const legacy = periodsToLegacyRows(financial.pkg.periods, symbol);
        const health = computeFinancialHealth({ income: legacy.income as Record<string, unknown>[], balance: legacy.balance as Record<string, unknown>[], cashflow: legacy.cashflow as Record<string, unknown>[] }, { symbol });
        const roe = pct(health.groups.profitability.roe);
        const roa = pct(health.groups.profitability.roa);
        const ros = pct(health.groups.profitability.netMargin);
        const roic = pct(health.groups.profitability.roic);
        const grossMargin = pct(health.groups.profitability.grossMargin);
        const netMargin = pct(health.groups.profitability.netMargin);
        const metrics = [roe, roa, ros, roic, grossMargin, netMargin];
        if (metrics.every((v) => v == null)) return null;
        return { symbol, sector: sectorOf(symbol), price: quoteMap.get(symbol)?.price ?? null, roe, roa, ros, roic, grossMargin, netMargin, reportDate: financial.pkg.meta.latestPeriod ?? null, score: metrics.filter((v) => v != null).length };
      })).filter((row): row is FundamentalScreenRow => row !== null);
      rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
      return { rows, scanned: symbols.length, skipped: symbols.length - rows.length };
    },
  });
  return {
    ...result.value,
    meta: buildMeta({
      source: "financial-source-router",
      cached: result.cached,
      stale: result.stale,
      partial: result.value.skipped > 0,
      note: `ROE/ROA/ROS/ROIC từ BCTC · ${result.value.rows.length}/${result.value.scanned} mã có dữ liệu · tối đa 4 kết nối song song · ROIC dùng NOPAT xấp xỉ 80% EBIT`,
    }),
  };
}

export { DEFAULT_SYMBOLS };
