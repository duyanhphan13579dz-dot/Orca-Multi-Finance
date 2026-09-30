import { ok, unavailable } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * GET /api/v1/stocks/:symbol/financials
 * Fast path: fetchVndirectFinancials (cached) → map bảng.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym || !/^[A-Z0-9]{3,12}$/.test(sym)) {
    return unavailable("financial-reports", "Mã cổ phiếu không hợp lệ");
  }

  try {
    const { fetchVndirectFinancials, periodsToLegacyRows } = await import(
      "@/lib/financial/vndirect-fs"
    );

    const direct = await fetchVndirectFinancials(sym, { limitPeriods: 12 });
    if (!direct?.periods?.length) {
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
              notes: r.notes,
              purpose: "reports-page",
            },
            r.meta,
          );
        }
      } catch {
        /* */
      }
      return unavailable(
        "financial-reports",
        `Không lấy được BCTC ${sym} từ VNDirect (api-finfo). Thử lại sau vài giây.`,
      );
    }

    const legacy = periodsToLegacyRows(direct.periods, sym);
    const has =
      legacy.income.length + legacy.balance.length + legacy.cashflow.length > 0;
    if (!has) {
      return unavailable(
        "financial-reports",
        `Đã tải raw FS ${sym} nhưng chưa map được chỉ tiêu. Xem DStock để đối chiếu.`,
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
          note: `vndirect-fs · ${direct.latencyMs}ms · ${direct.periods.length} kỳ · ${direct.profile}`,
        },
        notes: [`api-finfo VNDirect · ${direct.periods.length} kỳ · ${direct.latencyMs}ms`],
        purpose: "reports-page",
      },
      {
        source: "vndirect-fs",
        sourceTimestampMs: Date.now(),
        note: `fast-path · ${direct.latencyMs}ms`,
      },
    );
  } catch (e) {
    console.error("[financials]", sym, e);
    return unavailable(
      "financial-reports",
      e instanceof Error ? e.message : `Lỗi tải BCTC ${sym}`,
    );
  }
}
