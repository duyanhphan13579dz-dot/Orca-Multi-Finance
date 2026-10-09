import { ok, badRequest, fail } from "@/lib/envelope";
import { cached } from "@/lib/cache";
import { periodsToLegacyRows, fetchVndirectFinancials } from "@/lib/financial/vndirect-fs";
import { fetchFinancialStatementsMulti } from "@/lib/financial/fs-multi";
import { computeGrowth, sortPeriodsNewestFirst } from "@/lib/financial/normalize";
import { getVnQuotes } from "@/lib/services/stocks";
import { getVndEquitySnapshot, getVndValuationRatios } from "@/lib/providers/vndirect-company";
import { computeFinancialHealth } from "@/lib/engines/fundamental";
import { computeInvestmentPerformance } from "@/lib/financial/investment-performance";
import { fetchVndDchartHistory } from "@/lib/providers/vndirect-dchart";
import { getVietcapCompany } from "@/lib/providers/vietcap";
import type { OhlcvBar } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function closesFromBars(bars: OhlcvBar[] | null | undefined): number[] {
  if (!bars?.length) return [];
  const out: number[] = [];
  for (const b of bars) {
    const c = Number(b.close);
    if (Number.isFinite(c) && c > 0) out.push(c);
  }
  return out;
}

/**
 * GET /api/v1/stocks/:symbol/fundamentals
 * BCTC + giá TT + lịch sử dchart (mã + VNINDEX) + ratios → TSR/Beta/Sharpe/Alpha/cổ tức.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = (raw ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
      return badRequest("symbol không hợp lệ");
    }

    const cachedRes = await cached(`fund:ui:${symbol}:v6`, {
      ttlMs: 90_000,
      staleMs: 300_000,
      producer: async () => {
        // Song song: BCTC, giá, equity, ratios, lịch sử mã, lịch sử VNINDEX
        const [fsPrimary, fsMulti, quotes, equity, ratios, bars, idxBars, vietcap] = await Promise.all([
          fetchVndirectFinancials(symbol, { limitPeriods: 16 }).catch(() => null),
          fetchFinancialStatementsMulti(symbol).catch(() => null),
          getVnQuotes([symbol]).catch(() => null),
          getVndEquitySnapshot(symbol).catch(() => null),
          getVndValuationRatios(symbol).catch(() => null),
          fetchVndDchartHistory(symbol, "D", 320).catch(() => [] as OhlcvBar[]),
          fetchVndDchartHistory("VNINDEX", "D", 320).catch(() => [] as OhlcvBar[]),
          getVietcapCompany(symbol).catch(() => null),
        ]);

        // Prefer multi-source richest set, then primary VNDirect
        const fs =
          fsMulti?.periods?.length
            ? { periods: fsMulti.periods, latencyMs: fsMulti.latencyMs, profile: null as string | null, sources: fsMulti.sources }
            : fsPrimary?.periods?.length
              ? { periods: fsPrimary.periods, latencyMs: fsPrimary.latencyMs, profile: fsPrimary.profile, sources: ["vndirect-fs"] }
              : null;

        // Retry dchart nếu lần 1 rỗng (timeout / rate limit)
        let stockBars = bars ?? [];
        let indexBars = idxBars ?? [];
        if (!stockBars.length) {
          stockBars = await fetchVndDchartHistory(symbol, "D", 320).catch(() => [] as OhlcvBar[]);
        }
        if (!indexBars.length) {
          indexBars = await fetchVndDchartHistory("VNINDEX", "D", 320).catch(() => [] as OhlcvBar[]);
        }

        // Soft-fail: still return quote/performance shell when BCTC missing
        const periods = fs?.periods?.length ? sortPeriodsNewestFirst(fs.periods) : [];
        const rows = periods.length
          ? periodsToLegacyRows(periods, symbol)
          : { income: [] as Record<string, unknown>[], balance: [] as Record<string, unknown>[], cashflow: [] as Record<string, unknown>[], ratios: [] as Record<string, unknown>[] };
        const health = computeFinancialHealth(
          {
            income: rows.income as Record<string, unknown>[],
            balance: rows.balance as Record<string, unknown>[],
            cashflow: rows.cashflow as Record<string, unknown>[],
          },
          { symbol },
        );

        let shares =
          equity?.sharesOutstanding ??
          equity?.totalShares ??
          health.anchors?.shares ??
          vietcap?.sharesOutstanding ??
          null;
        if (equity?.sharesOutstanding && equity.sharesOutstanding > 0) {
          shares = equity.sharesOutstanding;
        } else if ((shares == null || shares <= 0) && vietcap?.sharesOutstanding && vietcap.sharesOutstanding > 0) {
          shares = vietcap.sharesOutstanding;
        }

        let price = quotes?.quotes?.[0]?.price ?? null;
        if ((price == null || price <= 0) && vietcap?.price && vietcap.price > 0) {
          price = vietcap.price >= 1000 ? vietcap.price / 1000 : vietcap.price;
        }
        const growth = periods.length ? computeGrowth(periods) : { yoy: [], qoq: [], latestPeriod: null, priorYearPeriod: null, priorQuarterPeriod: null };

        const closes = closesFromBars(stockBars);
        const indexCloses = closesFromBars(indexBars);

        const income0 = (rows.income[0] ?? {}) as Record<string, unknown>;
        const ni =
          typeof income0.netIncome === "number"
            ? income0.netIncome
            : typeof income0.netProfit === "number"
              ? income0.netProfit
              : typeof income0.netIncomeParent === "number"
                ? income0.netIncomeParent
                : null;

        const dividendYield =
          ratios?.dividendYield != null && Number.isFinite(ratios.dividendYield)
            ? ratios.dividendYield
            : null;

        // Cổ tức tiền mặt năm ≈ yield × giá VND × SLCP
        let annualDividendCash: number | null = null;
        if (dividendYield != null && dividendYield > 0 && price != null && shares != null && shares > 0) {
          const priceVnd = price < 500 ? price * 1000 : price;
          annualDividendCash = dividendYield * priceVnd * shares;
        }

        const performance = computeInvestmentPerformance({
          closes,
          indexCloses,
          dividendYield,
          netIncome: typeof ni === "number" ? ni : null,
          annualDividendCash,
        });

        return {
          symbol,
          pipeline: "fundamental-direct-v5",
          financials: {
            income: rows.income,
            balance: rows.balance,
            cashflow: rows.cashflow,
          },
          financialHealth: {
            ...health,
            anchors: {
              ...health.anchors,
              shares: shares ?? health.anchors.shares,
            },
          },
          financialGrowth: growth,
          quote: quotes?.quotes?.[0] ?? null,
          sharesOutstanding: shares,
          sharesSource: equity?.source ?? null,
          marketCap:
            price != null && shares != null && shares > 0
              ? price * shares
              : (equity?.marketCapReported ?? ratios?.marketCap ?? null),
          periodCount: periods.length,
          latencyMs: fs?.latencyMs ?? 0,
          profile: fs?.profile ?? null,
          fsSources: fs && "sources" in fs ? fs.sources : null,
          notes: periods.length
            ? [`BCTC ${periods.length} kỳ`]
            : ["Chưa lấy được BCTC — hiển thị partial (giá/hiệu suất nếu có)."],
          closes,
          indexClosesCount: indexCloses.length,
          performance,
          vndirectRatios: ratios
            ? {
                pe: ratios.pe,
                pb: ratios.pb,
                ps: ratios.ps,
                eps: ratios.eps,
                bvps: ratios.bvps,
                roe: ratios.roe,
                roa: ratios.roa,
                dividendYield: ratios.dividendYield,
                marketCap: ratios.marketCap,
                reportDate: ratios.reportDate,
              }
            : null,
        };
      },
    });

    const r = cachedRes.value;
    return ok(r, {
      source: "vndirect-fs+dchart+ratios",
      sourceTimestampMs: Date.now(),
      cached: cachedRes.cached,
      stale: cachedRes.stale,
      note: r.periodCount
        ? `BCTC ${r.periodCount} kỳ · giá ${r.closes?.length ?? 0} phiên · VNINDEX ${r.indexClosesCount ?? 0} · ${r.latencyMs}ms`
        : `Partial: chưa có BCTC · giá ${r.closes?.length ?? 0} phiên · ${r.latencyMs}ms`,
      partial: !r.periodCount,
    });
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "STOCK_UNAVAILABLE") {
      return fail(
        "STOCK_UNAVAILABLE",
        e instanceof Error ? e.message : "Không lấy được dữ liệu",
        503,
      );
    }
    console.error("[fundamentals-direct]", e);
    return fail("FUNDAMENTALS_ERROR", e instanceof Error ? e.message : "failed", 500);
  }
}
