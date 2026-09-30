import { ok, unavailable } from "@/lib/envelope";
import { getFinancialsForSymbol } from "@/lib/financial/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/:symbol/financials
 * Bảng BCTC đầy đủ — Data Hub + vndirect-fs (api-finfo), fallback fetch trực tiếp.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym || !/^[A-Z0-9]{3,12}$/.test(sym)) {
    return unavailable("financial-reports", "Mã cổ phiếu không hợp lệ");
  }

  try {
    const { runInDataHub, hubFinancialPackage } = await import("@/lib/data-engine/hub");

    const r = await runInDataHub(async () => {
      await hubFinancialPackage(sym).catch(() => null);
      return getFinancialsForSymbol(sym);
    });

    if (!r) {
      const { fetchVndirectFinancials, periodsToLegacyRows } = await import(
        "@/lib/financial/vndirect-fs"
      );
      const direct = await fetchVndirectFinancials(sym, { limitPeriods: 12 });
      if (!direct?.periods?.length) {
        return unavailable(
          "financial-reports",
          `Không lấy được BCTC ${sym} từ VNDirect (api-finfo). Kiểm tra mã hoặc thử lại.`,
        );
      }
      const legacy = periodsToLegacyRows(direct.periods, sym);
      const has =
        legacy.income.length + legacy.balance.length + legacy.cashflow.length > 0;
      if (!has) {
        return unavailable(
          "financial-reports",
          `Đã tải raw FS ${sym} nhưng chưa map được chỉ tiêu bảng. Thử lại hoặc xem DStock.`,
        );
      }
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
            statementScope: direct.periods[0]?.statementScope ?? "unknown",
            freshnessStatus: "FRESH",
            note: `direct-fs · ${direct.latencyMs}ms · profile ${direct.profile}`,
          },
          notes: [`Nguồn trực tiếp api-finfo · ${direct.periods.length} kỳ`],
          purpose: "reports-page",
        },
        {
          source: "vndirect-fs-direct",
          sourceTimestampMs: Date.now(),
          note: `direct · ${direct.periods.length} periods · ${direct.latencyMs}ms`,
        },
      );
    }

    if (!r.financials.income && !r.financials.balance && !r.financials.cashflow) {
      return unavailable(
        "financial-reports",
        `Không lấy được báo cáo tài chính ${sym} để hiển thị bảng (VNDirect).`,
      );
    }

    return ok(
      {
        symbol: sym,
        financials: r.financials,
        health: r.health,
        packageMeta: r.packageMeta,
        notes: r.notes,
        purpose: "reports-page",
      },
      r.meta,
    );
  } catch (e) {
    console.error("[financials]", sym, e);
    return unavailable(
      "financial-reports",
      e instanceof Error ? e.message : `Lỗi tải BCTC ${sym}`,
    );
  }
}
