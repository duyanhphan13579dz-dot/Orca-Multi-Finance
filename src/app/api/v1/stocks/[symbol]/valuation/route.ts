import { ok, badRequest, fail } from "@/lib/envelope";
import { getVnStockDetail } from "@/lib/services/stocks";
import { computeFinancialHealth } from "@/lib/engines/fundamental";
import { computeValuation } from "@/lib/engines/valuation";
import { collectPeerMetrics } from "@/lib/engines/valuation-peers";
import { sectorOf } from "@/lib/vn/master";
import { getVndOutstandingShares } from "@/lib/providers/vndirect-company";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/stocks/:symbol/valuation
 * Optimized: parallel detail+shares+peers, response cache, slim payload.
 * Query: ?peers=0 skip peers | ?full=1 include raw phase objects
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
    const wantFull = url.searchParams.get("full") === "1";
    const cacheKey = `val:api:${symbol}:p${wantPeers ? 1 : 0}:f${wantFull ? 1 : 0}`;

    try {
      const cachedRes = await cached(cacheKey, {
        ttlMs: 90_000,
        staleMs: 300_000,
        producer: () => buildValuationPayload(symbol, wantPeers, wantFull),
      });
      return ok(cachedRes.value.data, {
        ...cachedRes.value.meta,
        cached: cachedRes.cached,
        stale: cachedRes.stale,
      });
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "STOCK_UNAVAILABLE") {
        return fail("STOCK_UNAVAILABLE", e instanceof Error ? e.message : `Không lấy được dữ liệu ${symbol}`, 503);
      }
      throw e;
    }
  } catch (e) {
    console.error("[valuation]", e);
    return fail("VALUATION_ERROR", e instanceof Error ? e.message : "valuation failed", 500);
  }
}

async function buildValuationPayload(
  symbol: string,
  wantPeers: boolean,
  wantFull: boolean,
) {
  // Parallel: stock detail + shares + peers (peers independent of shares)
  const detailP = getVnStockDetail(symbol);
  const sharesP = cached(`val:shares:${symbol}`, {
    ttlMs: 6 * 3_600_000,
    staleMs: 24 * 3_600_000,
    producer: async () => {
      try {
        return await getVndOutstandingShares(symbol);
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);
  const peersP = wantPeers
    ? collectPeerMetrics(symbol, 4).catch((e) => {
        console.warn("[valuation] peers skipped", e);
        return { sector: sectorOf(symbol), peers: [] as Awaited<ReturnType<typeof collectPeerMetrics>>["peers"] };
      })
    : Promise.resolve(null);

  const [pack, vndShares, peerPack] = await Promise.all([detailP, sharesP, peersP]);

  if (!pack) {
    throw Object.assign(new Error(`Không lấy được dữ liệu ${symbol}`), {
      code: "STOCK_UNAVAILABLE",
      status: 503,
    });
  }
  const { detail, meta } = pack;

  const price = detail.quote?.price ?? detail.bars?.at(-1)?.close ?? 0;
  const priceSource = meta.source?.includes("ssi")
    ? "ssi-fcdata"
    : meta.source?.includes("vndirect")
      ? "vndirect"
      : meta.source || "unknown";

  const income = (detail.financials?.income ?? []) as Record<string, unknown>[];
  const balance = (detail.financials?.balance ?? []) as Record<string, unknown>[];
  const cashflow = (detail.financials?.cashflow ?? []) as Record<string, unknown>[];

  let health =
    detail.financialHealth ??
    computeFinancialHealth({ income, balance, cashflow }, { symbol });

  let sharesOutstanding: number | null = health.anchors?.shares ?? null;
  let sharesSource: string | null = sharesOutstanding != null ? "financial-statements" : null;
  let sharesReportDate: string | null = null;

  if (vndShares?.shares && vndShares.shares > 0) {
    sharesOutstanding = vndShares.shares;
    sharesSource = vndShares.source;
    sharesReportDate = vndShares.reportDate;
    health = {
      ...health,
      anchors: {
        ...health.anchors,
        shares: vndShares.shares,
        epsTtm:
          health.anchors.netProfit != null && vndShares.shares > 0
            ? health.anchors.netProfit / vndShares.shares
            : health.anchors.epsTtm,
      },
    };
  }

  const capexFromGroup =
    typeof health?.groups?.cashflow?.ocfTtm === "number" &&
    typeof health?.groups?.cashflow?.fcfTtm === "number"
      ? (health.groups!.cashflow!.ocfTtm as number) - (health.groups!.cashflow!.fcfTtm as number)
      : null;

  const peerComparison =
    peerPack && peerPack.peers.length > 0
      ? {
          symbol,
          sector: peerPack.sector || sectorOf(symbol),
          subject: {
            symbol,
            pe: null as number | null,
            pb: null as number | null,
            ps: null as number | null,
            evEbitda: null as number | null,
            pfcf: null as number | null,
            dividendYield: null as number | null,
            marketCap: null as number | null,
          },
          peers: peerPack.peers,
        }
      : undefined;

  let valuation = computeValuation({
    price,
    health,
    capexTtm: capexFromGroup,
    symbol,
    peerComparison,
  });

  if (peerComparison) {
    peerComparison.subject = {
      symbol,
      pe: valuation.multiples.pe,
      pb: valuation.multiples.pb,
      ps: valuation.multiples.ps,
      evEbitda: valuation.multiples.evEbitda,
      pfcf: valuation.multiples.pfcf,
      dividendYield: valuation.multiples.dividendYield,
      marketCap: valuation.marketCap,
    };
    valuation = computeValuation({
      price,
      health,
      capexTtm: capexFromGroup,
      symbol,
      peerComparison,
    });
  }

  const fv = valuation.fairValue;
  const p4 = valuation.phase4;
  const p5 = valuation.phase5;

  const data: Record<string, unknown> = {
    symbol,
    currentPrice: valuation.price,
    priceSource,
    sharesOutstanding,
    sharesSource,
    sharesReportDate,
    marketCap: valuation.marketCap,
    enterpriseValue: valuation.enterpriseValue,
    multiples: valuation.multiples,
    fairValues: {
      blended: p5?.finalFairValue ?? fv?.blendedFairValue ?? null,
      low: p5?.confidenceBands?.low ?? null,
      base: p5?.confidenceBands?.base ?? null,
      high: p5?.confidenceBands?.high ?? null,
      bandWidthPct: p5?.confidenceBands?.bandWidthPct ?? null,
      dcfBase: fv?.methods?.dcfBase ?? null,
      dcfBear: fv?.methods?.dcfBear ?? null,
      dcfBull: fv?.methods?.dcfBull ?? null,
      peBased: fv?.methods?.peBased ?? null,
      pbBased: fv?.methods?.pbBased ?? null,
      evEbitdaBased: fv?.methods?.evEbitdaBased ?? null,
      pfcfBased: fv?.methods?.pfcfBased ?? null,
      residualIncome: p4?.methodPrices?.residualIncome ?? null,
      ddm: p4?.methodPrices?.ddm ?? null,
      nav: p4?.methodPrices?.nav ?? null,
      sotp: p4?.methodPrices?.sotp ?? null,
      industryWeightsApplied: p5?.score?.industryBlend?.weightsApplied ?? null,
      weightsUsed: fv?.weightsUsed ?? null,
      dcf: valuation.dcf,
    },
    sensitivity: valuation.sensitivity ?? null,
    valuationScore: p5?.valuationScore ?? null,
    valuationGrade: p5?.grade ?? null,
    valuationScoreBreakdown: p5?.score?.breakdown ?? null,
    valuationStatus: p5?.valuationStatus ?? fv?.valuationStatus ?? null,
    upsideDownside: p5?.score?.upsidePct ?? fv?.upsidePct ?? null,
    confidence: valuation.confidence,
    valuationConfidence: fv?.confidence ?? null,
    confidenceBands: p5?.confidenceBands ?? null,
    dataQuality: valuation.dataQuality,
    industryProfile: p5?.profileId ?? null,
    industryMethodWeights: p5?.industryWeights ?? null,
    historical: valuation.historical ?? null,
    peerComparison: valuation.peers ?? null,
    assumptions: {
      dcf: (valuation.phase3?.dcf ?? []).map((d) => ({
        label: d.label,
        growthY1toN: d.assumptions.growthY1toN,
        terminalGrowth: d.assumptions.terminalGrowth,
        discountRate: d.assumptions.discountRate,
        cashFlowType: d.assumptions.cashFlowType,
        status: d.status,
      })),
      costOfCapital: valuation.phase3?.costOfCapital ?? null,
      fcfDefinition: valuation.phase2?.cashFlow?.fcfDefinition ?? null,
    },
    notes: valuation.notes,
    calculatedAt: new Date().toISOString(),
    valuationEngineVersion: valuation.valuationEngineVersion,
  };

  if (wantFull) {
    data.phase1 = valuation.phase1 ?? null;
    data.phase2 = valuation.phase2 ?? null;
    data.phase3 = valuation.phase3 ?? null;
    data.phase4 = p4 ?? null;
    data.phase5 = p5 ?? null;
    data.sources = valuation.phase1?.sources ?? [];
  }

  return { data, meta };
}
