import { ok, badRequest, fail } from "@/lib/envelope";
import { cached } from "@/lib/cache";
import { periodsToLegacyRows, fetchVndirectFinancials } from "@/lib/financial/vndirect-fs";
import { computeGrowth, sortPeriodsNewestFirst } from "@/lib/financial/normalize";
import { getVnQuotes } from "@/lib/services/stocks";
import { getVndEquitySnapshot } from "@/lib/providers/vndirect-company";
import { computeFinancialHealth } from "@/lib/engines/fundamental";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/fundamentals
 * Phân tích cơ bản độc lập — kéo BCTC + giá trực tiếp VNDirect (kể cả ngân hàng model 101/102/103).
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

    const cachedRes = await cached(`fund:ui:${symbol}:v3`, {
      ttlMs: 90_000,
      staleMs: 300_000,
      producer: async () => {
        const [fs, quotes, equity] = await Promise.all([
          fetchVndirectFinancials(symbol, { limitPeriods: 16 }).catch(() => null),
          getVnQuotes([symbol]).catch(() => null),
          getVndEquitySnapshot(symbol).catch(() => null),
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

        return {
          symbol,
          pipeline: "fundamental-direct-v3",
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
        };
      },
    });

    const r = cachedRes.value;
    return ok(r, {
      source: `vndirect-fs+${r.profile}`,
      sourceTimestampMs: Date.now(),
      cached: cachedRes.cached,
      stale: cachedRes.stale,
      note: `BCTC trực tiếp ${r.periodCount} kỳ · ${r.latencyMs}ms`,
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
