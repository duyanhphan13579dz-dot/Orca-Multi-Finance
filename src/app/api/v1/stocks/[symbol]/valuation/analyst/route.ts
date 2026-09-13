import { ok, badRequest, fail } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";
import { computeFinancialHealth } from "@/lib/engines/fundamental";
import { computeValuation } from "@/lib/engines/valuation";
import {
  buildPhase6Valuation,
  buildPhase6ValuationSync,
} from "@/lib/engines/valuation-phase6";
import { collectPeerMetrics } from "@/lib/engines/valuation-peers";
import { sectorOf } from "@/lib/vn/master";
import { llmConfigured } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/v1/stocks/:symbol/valuation/analyst
 * Phase 6 — explain Phase 1–5 results only (no recalculation).
 * Query: ?llm=1 · ?peers=0
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
    const useLlm = url.searchParams.get("llm") === "1";
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
      typeof health?.groups?.cashflow?.ocfTtm === "number" &&
      typeof health?.groups?.cashflow?.fcfTtm === "number"
        ? (health.groups!.cashflow!.ocfTtm as number) - (health.groups!.cashflow!.fcfTtm as number)
        : null;

    let valuation = computeValuation({
      price,
      health,
      capexTtm: capexFromGroup,
      symbol,
    });

    if (wantPeers) {
      try {
        const { sector, peers } = await collectPeerMetrics(symbol, 6);
        valuation = computeValuation({
          price,
          health,
          capexTtm: capexFromGroup,
          symbol,
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
        console.warn("[valuation/analyst] peers skipped", e);
      }
    }

    const phase6 = useLlm
      ? await buildPhase6Valuation({ valuation, symbol, useLlm: true })
      : buildPhase6ValuationSync({ valuation, symbol });

    return ok(
      {
        symbol,
        narrative: phase6.narrative,
        deterministicNarrative: phase6.deterministicNarrative,
        usedLlm: phase6.usedLlm,
        model: phase6.model,
        latencyMs: phase6.latencyMs,
        fallbackReason: phase6.fallbackReason,
        llmConfigured: llmConfigured(),
        snapshot: phase6.snapshot,
        headline: {
          price: valuation.price,
          fairValue: phase6.snapshot?.fairValue?.blended ?? null,
          upsidePct: phase6.snapshot?.fairValue?.upsidePct ?? null,
          status: phase6.snapshot?.fairValue?.status ?? null,
          score: phase6.snapshot?.score?.value ?? null,
          grade: phase6.snapshot?.score?.grade ?? null,
          gaps: phase6.snapshot?.gaps ?? [],
        },
        valuationEngineVersion: phase6.valuationEngineVersion,
        engineVersion: valuation.valuationEngineVersion,
      },
      meta,
    );
  } catch (e) {
    console.error("[valuation/analyst]", e);
    return fail(
      "VALUATION_ANALYST_ERROR",
      e instanceof Error ? e.message : "analyst failed",
      500,
    );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  return GET(req, ctx);
}
