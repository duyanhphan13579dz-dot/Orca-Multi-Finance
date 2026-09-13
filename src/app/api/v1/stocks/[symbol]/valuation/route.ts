import { ok, badRequest, fail } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";
import { computeFinancialHealth } from "@/lib/engines/fundamental";
import { computeValuation } from "@/lib/engines/valuation";
import { collectPeerMetrics } from "@/lib/engines/valuation-peers";
import { sectorOf } from "@/lib/vn/master";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/valuation
 * Phase 1+2 Valuation Engine.
 * Query: ?peers=0 to skip peer fetch (faster).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol: raw } = await ctx.params;
    const symbol = (raw ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{3}$/.test(symbol)) {
      return badRequest("symbol phải là mã 3 ký tự (ví dụ FPT, VCB)");
    }

    const url = new URL(req.url);
    const wantPeers = url.searchParams.get("peers") !== "0";

    const pack = await getVnStockDetail(symbol);
    if (!pack) {
      return fail("STOCK_UNAVAILABLE", `Không lấy được dữ liệu ${symbol}`, 503);
    }
    const { detail, meta } = pack;

    const price = detail.quote?.price ?? detail.bars?.at(-1)?.close ?? 0;
    const income = (detail.financials?.income ?? []) as Record<string, unknown>[];
    const balance = (detail.financials?.balance ?? []) as Record<string, unknown>[];
    const cashflow = (detail.financials?.cashflow ?? []) as Record<string, unknown>[];

    const health =
      detail.financialHealth ??
      computeFinancialHealth({ income, balance, cashflow }, { symbol });

    const capexFromGroup =
      typeof health.groups.cashflow?.ocfTtm === "number" &&
      typeof health.groups.cashflow?.fcfTtm === "number"
        ? health.groups.cashflow.ocfTtm - health.groups.cashflow.fcfTtm
        : null;

    let valuation = computeValuation({
      price,
      health,
      capexTtm: capexFromGroup,
    });

    if (wantPeers) {
      try {
        const { sector, peers } = await collectPeerMetrics(symbol, 6);
        valuation = computeValuation({
          price,
          health,
          capexTtm: capexFromGroup,
          peerComparison: {
            symbol,
            sector: sector || sectorOf(symbol),
            subject: {
              symbol,
              pe: valuation.multiples.pe,
              pb: valuation.multiples.pb,
              ps: valuation.multiples.ps,
              evEbitda: valuation.multiples.evEbitda,
              pfcf: valuation.multiples.pfcf,
              dividendYield: valuation.multiples.dividendYield,
              marketCap: valuation.marketCap,
            },
            peers,
          },
        });
      } catch (e) {
        console.warn("[valuation] peers skipped", e);
      }
    }

    return ok(
      {
        symbol,
        currentPrice: valuation.price,
        marketCap: valuation.marketCap,
        enterpriseValue: valuation.enterpriseValue,
        multiples: valuation.multiples,
        phase1: valuation.phase1 ?? null,
        phase2: valuation.phase2 ?? null,
        historical: valuation.historical ?? null,
        peerComparison: valuation.peers ?? null,
        fairValues: {
          dcfBase: valuation.dcf?.find((s) => s.label === "Base")?.intrinsicPerShare ?? null,
          dcf: valuation.dcf,
        },
        valuationScore: null,
        valuationStatus: null,
        upsideDownside:
          valuation.dcf?.find((s) => s.label === "Base")?.marginOfSafetyPct ?? null,
        confidence: valuation.confidence,
        dataQuality: valuation.dataQuality,
        assumptions: {
          dcf: valuation.dcf
            ? {
                method: "two-stage-fcf",
                scenarios: valuation.dcf.map((s) => ({
                  label: s.label,
                  growthY1to5: s.growthY1to5,
                  terminalGrowth: s.terminalGrowth,
                  discountRate: s.discountRate,
                })),
              }
            : null,
          fcfDefinition: valuation.phase2?.cashFlow.fcfDefinition ?? null,
        },
        notes: valuation.notes,
        sources: valuation.phase1?.sources ?? [],
        calculatedAt: valuation.phase1?.calculatedAt ?? new Date().toISOString(),
        valuationEngineVersion: valuation.valuationEngineVersion,
      },
      meta,
    );
  } catch (e) {
    console.error("[valuation]", e);
    return fail("VALUATION_ERROR", e instanceof Error ? e.message : "valuation failed", 500);
  }
}
