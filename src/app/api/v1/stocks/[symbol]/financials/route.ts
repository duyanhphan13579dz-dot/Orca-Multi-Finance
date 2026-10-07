import { ok, unavailable } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * GET /api/v1/stocks/:symbol/financials
 *
 * Tích hợp BCTC qua Financial Package Engine:
 *  - Primary public: VNDirect api-finfo / DStock (không API key)
 *  - Secondary: VNStock (nếu cấu hình key)
 *  - Official pipeline (SSC filings) gắn provenance
 *  - Health · growth · TTM · quality score · fallback level
 *
 * Không bịa số khi mọi nguồn trống.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym || !/^[A-Z0-9]{3,12}$/.test(sym)) {
    return unavailable("financial-reports", "Mã cổ phiếu không hợp lệ");
  }

  try {
    const { getFinancialsForSymbol } = await import("@/lib/financial/service");
    const r = await getFinancialsForSymbol(sym);
    if (r && (r.financials.income || r.financials.balance || r.financials.cashflow)) {
      return ok(
        {
          symbol: sym,
          financials: r.financials,
          health: r.health,
          packageMeta: r.packageMeta,
          growth: r.growth,
          ttm: r.ttm,
          quality: r.quality,
          notes: r.notes,
          purpose: "reports-page",
        },
        r.meta,
      );
    }

    const { fetchVndirectFinancials, periodsToLegacyRows } = await import(
      "@/lib/financial/vndirect-fs"
    );
    const direct = await fetchVndirectFinancials(sym, { limitPeriods: 12 });
    if (direct?.periods?.length) {
      const legacy = periodsToLegacyRows(direct.periods, sym);
      const has =
        legacy.income.length + legacy.balance.length + legacy.cashflow.length > 0;
      if (has) {
        return ok(
          {
            symbol: sym,
            financials: {
              income: legacy.income.length ? legacy.income : null,
              balance: legacy.balance.length ? legacy.balance : null,
              cashflow: legacy.cashflow.length ? legacy.cashflow : null,
              ratios: legacy.ratios.length ? legacy.ratios : null,
            },
            health: null,
            packageMeta: {
              primarySource: "vndirect-fs",
              latestPeriod: direct.periods[0]?.period ?? null,
              reportTypeLabel:
                direct.periods[0]?.periodType === "year" ? "Báo cáo năm" : "Báo cáo quý",
              statementScope: "legacy-direct",
            },
            growth: null,
            ttm: null,
            quality: null,
            notes: ["Fast path VNDirect public — package engine chưa normalize được kỳ này"],
            purpose: "reports-page",
          },
          {
            source: "vndirect-fs",
            sourceTimestampMs: Date.now(),
          },
        );
      }
    }

    return unavailable(
      "financial-reports",
      `Không lấy được BCTC ${sym} từ nguồn công khai (VNDirect api-finfo). Thử lại sau vài giây.`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return unavailable("financial-reports", `Lỗi tải BCTC ${sym}: ${msg.slice(0, 160)}`);
  }
}
