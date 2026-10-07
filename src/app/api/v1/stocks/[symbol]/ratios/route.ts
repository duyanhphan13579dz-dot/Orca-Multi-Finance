import { ok, badRequest, unavailable } from "@/lib/envelope";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * GET /api/v1/stocks/:symbol/ratios
 *
 * Chỉ số tài chính chi tiết phục vụ định giá:
 * thanh khoản, đòn bẩy, sinh lời, hiệu quả, định giá, dòng tiền, DuPont, per-share.
 * Nguồn: BCTC VNDirect + giá multi-quote + equity snapshot.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await ctx.params;
  const symbol = (raw ?? "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9]{3,12}$/.test(symbol)) {
    return badRequest("Mã cổ phiếu không hợp lệ (ví dụ FPT, VCB)");
  }

  try {
    const cacheKey = `ratios:detail:${symbol}`;
    const cachedRes = await cached(cacheKey, {
      ttlMs: 90_000,
      staleMs: 300_000,
      producer: async () => {
        const [
          { fetchVndirectFinancials },
          { getVnQuotes },
          { getVndEquitySnapshot, getVndValuationRatios },
          ratioMod,
        ] = await Promise.all([
          import("@/lib/financial/vndirect-fs"),
          import("@/lib/services/stocks"),
          import("@/lib/providers/vndirect-company"),
          import("@/lib/financial/ratio-engine"),
        ]);

        const [fs, quotes, equity, vndRatios] = await Promise.all([
          fetchVndirectFinancials(symbol, { limitPeriods: 12 }).catch(() => null),
          getVnQuotes([symbol]).catch(() => null),
          getVndEquitySnapshot(symbol).catch(() => null),
          getVndValuationRatios(symbol).catch(() => null),
        ]);

        if (!fs?.periods?.length && !(quotes?.quotes?.[0]?.price)) {
          throw Object.assign(new Error(`Không lấy được BCTC/giá ${symbol}`), { code: "UNAVAILABLE" });
        }

        const picked = ratioMod.pickMetricsFromPeriods(fs?.periods ?? []);
        const price = quotes?.quotes?.[0]?.price ?? null;
        const shares =
          equity?.sharesOutstanding && equity.sharesOutstanding > 0
            ? equity.sharesOutstanding
            : null;

        const ratios = ratioMod.computeDetailedRatios({
          metrics: picked.metrics,
          prior: picked.prior,
          priceQuote: price,
          sharesOutstanding: shares,
          marketMultiples: vndRatios
            ? {
                pe: vndRatios.pe ?? null,
                pb: vndRatios.pb ?? null,
                ps: vndRatios.ps ?? null,
                evEbitda: vndRatios.evEbitda ?? null,
                dividendYield: vndRatios.dividendYield ?? null,
                marketCap: vndRatios.marketCap ?? equity?.marketCapReported ?? null,
              }
            : {
                marketCap: equity?.marketCapReported ?? null,
              },
          periodLabel: picked.label,
        });

        return {
          symbol,
          ratios,
          sources: {
            financials: fs ? "vndirect-fs" : null,
            quote: quotes?.meta?.source ?? null,
            equity: equity?.source ?? null,
            marketRatios: vndRatios ? "vndirect-ratios" : null,
          },
          periodsAvailable: fs?.periods?.length ?? 0,
          latencyMs: fs?.latencyMs ?? null,
        };
      },
    });

    return ok(cachedRes.value, {
      source: "ratio-engine",
      cached: cachedRes.cached,
      stale: cachedRes.stale,
      ageMs: 0,
      freshness: cachedRes.stale ? "STALE" : "FRESH",
    });
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "UNAVAILABLE") {
      return unavailable("ratio-engine", e instanceof Error ? e.message : "Không đủ dữ liệu");
    }
    console.error("[ratios]", e);
    return unavailable("ratio-engine", e instanceof Error ? e.message : "ratio engine failed");
  }
}
