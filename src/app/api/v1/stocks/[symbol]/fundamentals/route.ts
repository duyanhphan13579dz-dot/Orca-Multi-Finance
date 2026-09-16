import { ok, badRequest, fail } from "@/lib/envelope";
import { cached } from "@/lib/cache";
import { periodsToLegacyRows, fetchVndirectFinancials } from "@/lib/financial/vndirect-fs";
import { computeGrowth, sortPeriodsNewestFirst } from "@/lib/financial/normalize";
import { getVnQuotes } from "@/lib/services/stocks";
import { getVndEquitySnapshot, getVndValuationRatios } from "@/lib/providers/vndirect-company";
import { computeFinancialHealth } from "@/lib/engines/fundamental";
import { computeInvestmentPerformance } from "@/lib/financial/investment-performance";
import { fetchVndDchartHistory } from "@/lib/providers/vndirect-dchart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/fundamentals
 * Phân tích cơ bản độc lập — BCTC + giá + hiệu suất (Beta/Sharpe/Alpha/TSR/cổ tức).
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

    const cachedRes = await cached(`fund:ui:${symbol}:v4`, {
      ttlMs: 90_000,
      staleMs: 300_000,
      producer: async () => {
        const [fs, quotes, equity, ratios, bars, idxBars] = await Promise.all([
          fetchVndirectFinancials(symbol, { limitPeriods: 16 }).catch(() => null),
          getVnQuotes([symbol]).catch(() => null),
          getVndEquitySnapshot(symbol).catch(() => null),
          getVndValuationRatios(symbol).catch(() => null),
          fetchVndDchartHistory(symbol, "D", 280).catch(() => [] as { c: number }[]),
          fetchVndDchartHistory("VNINDEX", "D", 280).catch(() => [] as { c: number }[]),
        ]);

        if (!fs?.periods?.length) {
          throw Object.assign(new Error(`Không lấy được BCTC ${symbol} từ VNDirect`), {
            code: "STOCK_UNAVAILABLE",
          });
        }

        const periods = sortPeriodsNewestFirst(fs.periods);
        const rows = periodsToLegacyRows(periods, symbol);
        const health = computeFinancialHealth(
          {
            income: rows.income as Record<string, unknown>[],
            balance: rows.balance as Record<string, unknown>[],
            cashflow: rows.cashflow as Record<string, unknown>[],
          },
          { symbol },
        );

        let shares = equity?.sharesOutstanding ?? health.anchors?.shares ?? null;
        if (equity?.sharesOutstanding && equity.sharesOutstanding > 0) {
          shares = equity.sharesOutstanding;
        }

        const price = quotes?.quotes?.[0]?.price ?? null;
        const growth = computeGrowth(periods);

        const closes = (bars ?? [])
          .map((b) => Number((b as { c?: number }).c))
          .filter((c) => Number.isFinite(c) && c > 0);
        const indexCloses = (idxBars ?? [])
          .map((b) => Number((b as { c?: number }).c))
          .filter((c) => Number.isFinite(c) && c > 0);

        const income0 = (rows.income[0] ?? {}) as Record<string, unknown>;
        const ni =
          typeof income0.netIncome === "number"
            ? income0.netIncome
            : typeof income0.netProfit === "number"
              ? income0.netProfit
              : null;

        const dividendYield =
          ratios?.dividendYield != null && Number.isFinite(ratios.dividendYield)
            ? ratios.dividendYield
            : null;

        let annualDividendCash: number | null = null;
        if (dividendYield != null && price != null && shares != null && shares > 0) {
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
          pipeline: "fundamental-direct-v4",
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
              : (equity?.marketCapReported ?? null),
          periodCount: periods.length,
          latencyMs: fs.latencyMs,
          profile: fs.profile,
          closes,
          performance,
          vndirectRatios: ratios
            ? {
                pe: ratios.pe,
                pb: ratios.pb,
                dividendYield: ratios.dividendYield,
                eps: ratios.eps,
              }
            : null,
        };
      },
    });

    const r = cachedRes.value;
    return ok(r, {
      source: `vndirect-fs+dchart+ratios`,
      sourceTimestampMs: Date.now(),
      cached: cachedRes.cached,
      stale: cachedRes.stale,
      note: `BCTC ${r.periodCount} kỳ · perf ${r.performance?.sampleDays ?? 0} phiên · ${r.latencyMs}ms`,
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
