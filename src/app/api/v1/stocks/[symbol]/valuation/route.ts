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
 * Phase 1–3 Valuation Engine (multiples, cash-flow, DCF, sensitivity, fair value).
 * Query: ?peers=0 to skip peer fetch.
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

    const fv = valuation.fairValue;

    return ok(
      {
        symbol,
        currentPrice: valuation.price,
        marketCap: valuation.marketCap,
        enterpriseValue: valuation.enterpriseValue,
        multiples: valuation.multiples,
        phase1: valuation.phase1 ?? null,
        phase2: valuation.phase2 ?? null,
        phase3: valuation.phase3 ?? null,
        historical: valuation.historical ?? null,
        peerComparison: valuation.peers ?? null,
        fairValues: {
          blended: fv?.blendedFairValue ?? null,
          dcfBase: fv?.methods.dcfBase ?? null,
          dcfBear: fv?.methods.dcfBear ?? null,
          dcfBull: fv?.methods.dcfBull ?? null,
          peBased: fv?.methods.peBased ?? null,
          pbBased: fv?.methods.pbBased ?? null,
          evEbitdaBased: fv?.methods.evEbitdaBased ?? null,
          pfcfBased: fv?.methods.pfcfBased ?? null,
          weightsUsed: fv?.weightsUsed ?? null,
          dcf: valuation.dcf,
        },
        sensitivity: valuation.sensitivity ?? null,
        valuationScore: null,
        valuationStatus: fv?.valuationStatus ?? null,
        upsideDownside: fv?.upsidePct ?? null,
        confidence: valuation.confidence,
        valuationConfidence: fv?.confidence ?? null,
        dataQuality: valuation.dataQuality,
        assumptions: {
          dcf: valuation.phase3?.dcf.map((d) => ({
            label: d.label,
            growthY1toN: d.assumptions.growthY1toN,
            terminalGrowth: d.assumptions.terminalGrowth,
            discountRate: d.assumptions.discountRate,
            cashFlowType: d.assumptions.cashFlowType,
            status: d.status,
          })),
          costOfCapital: valuation.phase3?.costOfCapital ?? null,
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
