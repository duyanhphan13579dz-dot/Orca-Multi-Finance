import { ok, unavailable } from "@/lib/envelope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/stocks/:symbol/financials
 *
 * P7-D: fail-fast order
 *  1) VNDirect public direct (fast, no package normalize)
 *  2) Financial package engine (health/growth/TTM)
 *  3) Multi-source race
 * Soft timeout on heavy steps so Workers stay under budget.
 */
async function soft<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p.then((v) => v).catch(() => null as T | null),
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
}

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

    // Stage 1 — VNDirect direct (usually <3s)
    const direct = await soft(fetchVndirectFinancials(sym, { limitPeriods: 12 }), 8_000);
    if (direct?.periods?.length) {
      const legacy = periodsToLegacyRows(direct.periods, sym);
      const has =
        legacy.income.length + legacy.balance.length + legacy.cashflow.length > 0;
      if (has) {
        // Optional enrich via package engine if still within budget
        const pack = await soft(
          import("@/lib/financial/service").then((m) => m.getFinancialsForSymbol(sym)),
          6_000,
        );
        if (
          pack &&
          (pack.financials.income || pack.financials.balance || pack.financials.cashflow)
        ) {
          return ok(
            {
              symbol: sym,
              financials: pack.financials,
              health: pack.health,
              packageMeta: pack.packageMeta,
              growth: pack.growth,
              ttm: pack.ttm,
              quality: pack.quality,
              notes: pack.notes,
              purpose: "reports-page",
            },
            pack.meta,
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
              statementScope: "legacy-direct",
              sourceUrls: {
                balance: `https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${sym}`,
                income: `https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${sym}`,
                cashflow: `https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${sym}`,
              },
            },
            growth: null,
            ttm: null,
            quality: null,
            notes: ["P7 fast-path VNDirect public"],
            purpose: "reports-page",
          },
          {
            source: "vndirect-fs",
            sourceTimestampMs: Date.now(),
          },
        );
      }
    }

    // Stage 2 — package engine alone
    const pack = await soft(
      import("@/lib/financial/service").then((m) => m.getFinancialsForSymbol(sym)),
      12_000,
    );
    if (pack && (pack.financials.income || pack.financials.balance || pack.financials.cashflow)) {
      return ok(
        {
          symbol: sym,
          financials: pack.financials,
          health: pack.health,
          packageMeta: pack.packageMeta,
          growth: pack.growth,
          ttm: pack.ttm,
          quality: pack.quality,
          notes: pack.notes,
          purpose: "reports-page",
        },
        pack.meta,
      );
    }

    // Stage 3 — multi-source
    try {
      const { fetchFinancialStatementsMulti } = await import("@/lib/financial/fs-multi");
      const multi = await soft(fetchFinancialStatementsMulti(sym), 10_000);
      if (multi?.periods?.length) {
        const legacy = periodsToLegacyRows(multi.periods, sym);
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
                primarySource: multi.sources?.[0] ?? "fs-multi",
                latestPeriod: multi.periods[0]?.period ?? null,
                reportTypeLabel:
                  multi.periods[0]?.periodType === "year" ? "Báo cáo năm" : "Báo cáo quý",
                statementScope: "multi-source",
                sourceUrls: {
                  balance: `https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${sym}`,
                  income: `https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${sym}`,
                  cashflow: `https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${sym}`,
                },
              },
              growth: null,
              ttm: null,
              quality: null,
              notes: [`Multi-source BCTC: ${(multi.sources ?? []).join(" ∥ ")}`],
              purpose: "reports-page",
            },
            {
              source: (multi.sources ?? ["fs-multi"]).join("+"),
              sourceTimestampMs: Date.now(),
            },
          );
        }
      }
    } catch (e) {
      console.error("[stocks/financials] fs-multi", sym, e);
    }

    return unavailable(
      "financial-reports",
      `Không lấy được BCTC ${sym} từ nguồn công khai (VNDirect / multi). Thử lại sau vài giây.`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return unavailable("financial-reports", `Lỗi tải BCTC ${sym}: ${msg.slice(0, 160)}`);
  }
}
