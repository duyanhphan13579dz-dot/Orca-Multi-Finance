import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth } from "../engines/fundamental";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
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
  reportDate: string | null;
  score: number;
};

const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? null : Number((value * 100).toFixed(2));

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
      const rows = (await Promise.all(symbols.map(async (symbol): Promise<FundamentalScreenRow | null> => {
        const fs = await fetchVndirectFinancials(symbol, { limitPeriods: 12 }).catch(() => null);
        if (!fs?.periods?.length) return null;
        const legacy = periodsToLegacyRows(fs.periods, symbol);
        const health = computeFinancialHealth({ income: legacy.income as Record<string, unknown>[], balance: legacy.balance as Record<string, unknown>[], cashflow: legacy.cashflow as Record<string, unknown>[] }, { symbol });
        const roe = pct(health.groups.profitability.roe);
        const roa = pct(health.groups.profitability.roa);
        const ros = pct(health.groups.profitability.netMargin);
        const roic = pct(health.groups.profitability.roic);
        const metrics = [roe, roa, ros, roic];
        if (metrics.every((v) => v == null)) return null;
        return { symbol, sector: sectorOf(symbol), price: quoteMap.get(symbol)?.price ?? null, roe, roa, ros, roic, reportDate: null, score: metrics.filter((v) => v != null).length };
      }))).filter((row): row is FundamentalScreenRow => row !== null);
      return { rows, scanned: symbols.length, skipped: symbols.length - rows.length };
    },
  });
  return { ...result.value, meta: buildMeta({ source: "vndirect-financials", cached: result.cached, stale: result.stale, note: "ROE, ROA, ROS và ROIC tính từ BCTC; ROIC dùng NOPAT xấp xỉ 80% EBIT." }) };
}

export { DEFAULT_SYMBOLS };
