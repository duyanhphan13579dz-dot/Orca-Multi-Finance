/**
 * Pipeline phân tích cơ bản + định giá — ĐỘC LẬP với trang Báo cáo tài chính.
 *
 * Không đi qua getFinancialPackage / getFinancialsForSymbol / snapshot báo cáo.
 * Kéo BCTC thẳng từ VNDirect api-finfo → health → valuation.
 */
import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { computeValuation } from "../engines/valuation";
import { collectPeerMetrics } from "../engines/valuation-peers";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import { getVndEquitySnapshot } from "../providers/vndirect-company";
import { ensureVndirectWsStarted, vndirectWs } from "../realtime/vndirect-ws";
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import type { Meta } from "../types";

export interface FundamentalValuationResult {
  symbol: string;
  data: Record<string, unknown>;
  meta: Meta;
  health: FinancialHealthResult;
}

export async function runFundamentalValuation(
  symbolRaw: string,
  opts?: { peers?: boolean; full?: boolean },
): Promise<FundamentalValuationResult | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3 || symbol.length > 12) return null;

  const wantPeers = opts?.peers !== false;
  const wantFull = opts?.full === true;

  try {
    if (process.env.VNDIRECT_WS_DISABLED !== "true") {
      ensureVndirectWsStarted();
      vndirectWs.watchSymbol(symbol);
    }
  } catch {
    /* serverless */
  }

  // Parallel: BCTC trực tiếp + giá + CP lưu hành (+ peers)
  const fsP = cached(`fv:fs:${symbol}`, {
    ttlMs: 15 * 60_000,
    staleMs: 2 * 3_600_000,
    producer: async () => {
      try {
        return await fetchVndirectFinancials(symbol, { limitPeriods: 16 });
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);

  const quoteP = getVnQuotes([symbol]).catch(() => null);

  const equityP = cached(`fv:equity:${symbol}`, {
    ttlMs: 2 * 3_600_000,
    staleMs: 12 * 3_600_000,
    producer: async () => {
      try {
        return await getVndEquitySnapshot(symbol);
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);

  const peersP = wantPeers
    ? collectPeerMetrics(symbol, 4).catch(() => null)
    : Promise.resolve(null);

  const [fs, quotes, equity, peerPack] = await Promise.all([fsP, quoteP, equityP, peersP]);

  const price =
    quotes?.quotes?.[0]?.price && quotes.quotes[0].price > 0
      ? quotes.quotes[0].price
      : 0;
  const priceSource = quotes?.meta?.source ?? "vndirect";

  if (!fs?.periods?.length && price <= 0) {
    return null;
  }

  const notes: string[] = [];
  notes.push("Pipeline độc lập — BCTC kéo trực tiếp VNDirect api-finfo (không qua trang báo cáo).");

  let health: FinancialHealthResult;
  if (fs?.periods?.length) {
    const rows = periodsToLegacyRows(fs.periods, symbol);
    health = computeFinancialHealth(
      {
        income: rows.income as Record<string, unknown>[],
        balance: rows.balance as Record<string, unknown>[],
        cashflow: rows.cashflow as Record<string, unknown>[],
      },
      { symbol },
    );
    notes.push(`BCTC: ${fs.periods.length} kỳ · latency ${fs.latencyMs}ms · nguồn vndirect-fs`);
  } else {
    health = computeFinancialHealth(
      { income: [], balance: [], cashflow: [] },
      { symbol },
    );
    notes.push("Không lấy được BCTC từ VNDirect — định giá chỉ dựa giá/CP nếu có.");
  }

  let sharesOutstanding: number | null = health.anchors?.shares ?? null;
  let sharesSource: string | null = sharesOutstanding != null ? "financial-statements" : null;
  let sharesReportDate: string | null = null;
  let marketCapReported: number | null = null;

  if (equity?.sharesOutstanding && equity.sharesOutstanding > 0) {
    sharesOutstanding = equity.sharesOutstanding;
    sharesSource = equity.source;
    sharesReportDate = equity.reportDate;
    marketCapReported = equity.marketCapReported;
    health = {
      ...health,
      anchors: {
        ...health.anchors,
        shares: equity.sharesOutstanding,
        epsTtm:
          health.anchors.netProfit != null && equity.sharesOutstanding > 0
            ? health.anchors.netProfit / equity.sharesOutstanding
            : health.anchors.epsTtm,
      },
    };
  }

  const marketCapComputed =
    price > 0 && sharesOutstanding != null && sharesOutstanding > 0
      ? price * sharesOutstanding
      : marketCapReported;

  const peerComparison =
    peerPack && peerPack.peers && peerPack.peers.length > 0
      ? {
          symbol,
          sector: peerPack.sector ?? sectorOf(symbol),
          subject: {
            symbol,
            pe: null as number | null,
            pb: null as number | null,
            ps: null as number | null,
            evEbitda: null as number | null,
          },
          peers: peerPack.peers,
        }
      : undefined;

  const valuation = computeValuation({
    price: price > 0 ? price : 0,
    health,
    symbol,
    peerComparison: peerComparison as Parameters<typeof computeValuation>[0]["peerComparison"],
  });

  const fv = valuation.fairValue ?? null;
  const p4 = valuation.phase4 ?? null;
  const p5 = valuation.phase5 ?? null;

  const resolvedMarketCap =
    valuation.marketCap ??
    marketCapComputed ??
    (price > 0 && sharesOutstanding ? price * sharesOutstanding : null);

  const allNotes = [...notes, ...(valuation.notes ?? [])];

  const data: Record<string, unknown> = {
    symbol,
    currentPrice: valuation.price,
    priceSource,
    sharesOutstanding,
    sharesSource,
    sharesReportDate,
    marketCap: resolvedMarketCap,
    marketCapReported,
    marketSnapshot: {
      price: valuation.price,
      priceSource,
      sharesOutstanding,
      sharesSource,
      sharesReportDate,
      marketCap: resolvedMarketCap,
      marketCapReported,
      enterpriseValue: valuation.enterpriseValue ?? null,
    },
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
    health: {
      score: health.score,
      grade: health.grade,
      anchors: health.anchors,
      groups: health.groups,
      warnings: health.warnings?.slice(0, 8),
    },
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
    notes: allNotes,
    pipeline: "fundamental-valuation-direct",
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
    data.fsPeriodCount = fs?.periods?.length ?? 0;
  }

  const meta = buildMeta({
    source: `fundamental-direct+${priceSource}+vndirect-fs`,
    sourceTimestampMs: Date.now(),
    note: allNotes[0] ?? "Định giá độc lập từ VNDirect",
  });

  return { symbol, data, meta, health };
}
