/**
 * Pipeline phân tích cơ bản + định giá — ĐỘC LẬP với trang Báo cáo tài chính.
 */
import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { computeValuation } from "../engines/valuation";
import { collectPeerMetrics } from "../engines/valuation-peers";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import { computeDetailedRatios, pickMetricsFromPeriods } from "../financial/ratio-engine";
import {
  getVndEquitySnapshot,
  getVndValuationRatios,
  priceQuoteToVnd,
} from "../providers/vndirect-company";
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

function saneMultiple(v: number | null | undefined, maxAbs = 500): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= 0) return null;
  if (Math.abs(v) > maxAbs) return null;
  return v;
}

function saneYieldPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > 80) return null;
  return v;
}

export async function runFundamentalValuation(
  symbolRaw: string,
  opts?: { peers?: boolean; full?: boolean },
): Promise<FundamentalValuationResult | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3 || symbol.length > 12) return null;

  const wantFull = opts?.full === true;
  const wantPeers = opts?.peers === true || (opts?.peers !== false && wantFull);

  try {
    if (process.env.VNDIRECT_WS_DISABLED !== "true") {
      ensureVndirectWsStarted();
      vndirectWs.watchSymbol(symbol);
    }
  } catch {
    /* serverless */
  }

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

  const ratiosP = cached(`fv:ratios:${symbol}`, {
    ttlMs: 5 * 60_000,
    staleMs: 60 * 60_000,
    producer: async () => {
      try {
        return await getVndValuationRatios(symbol);
      } catch {
        return null;
      }
    },
  }).then((r) => r.value);

  const peersP = wantPeers
    ? collectPeerMetrics(symbol, 4).catch(() => null)
    : Promise.resolve(null);

  const [fs, quotes, equity, vndRatios, peerPack] = await Promise.all([
    fsP,
    quoteP,
    equityP,
    ratiosP,
    peersP,
  ]);

  const priceQuote =
    quotes?.quotes?.[0]?.price && quotes.quotes[0].price > 0 ? quotes.quotes[0].price : 0;
  const priceSource = quotes?.meta?.source ?? "vndirect";
  const priceVnd = priceQuoteToVnd(priceQuote);

  if (!fs?.periods?.length && priceQuote <= 0 && !vndRatios?.marketCap) {
    return null;
  }

  const notes: string[] = [];
  notes.push("Pipeline độc lập — giá realtime + ratios + BCTC VNDirect + DCF 2 giai đoạn.");
  if (priceQuote > 0 && priceQuote < 500) {
    notes.push(`Giá quote ${priceQuote} → ${priceVnd.toLocaleString("vi-VN")} VND (×1000 nghìn đồng).`);
  }

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
    notes.push("Không lấy được BCTC từ VNDirect — dùng ratios/giá thị trường.");
  }

  let sharesOutstanding: number | null = health.anchors?.shares ?? null;
  let sharesSource: string | null = sharesOutstanding != null ? "financial-statements" : null;
  let sharesReportDate: string | null = null;
  let marketCapReported: number | null = null;

  if (equity?.sharesOutstanding && equity.sharesOutstanding > 0) {
    sharesOutstanding = equity.sharesOutstanding;
    sharesSource = equity.source ?? "vndirect-equity";
    sharesReportDate = equity.reportDate ?? null;
    marketCapReported = equity.marketCapReported ?? null;
  }

  let epsTtm: number | null = health.anchors?.eps ?? null;
  if (vndRatios?.eps && vndRatios.eps > 0) {
    epsTtm = vndRatios.eps;
    notes.push(`EPS từ VNDirect ratios: ${epsTtm}`);
  } else if (vndRatios?.pe && vndRatios.pe > 0 && priceQuote > 0) {
    epsTtm = priceQuote / vndRatios.pe;
    notes.push(`EPS suy từ giá quote / PE ratios`);
  }

  let fcfProxy: number | null = health.anchors?.fcf ?? null;
  if (fcfProxy == null && health.anchors?.netProfit != null && health.anchors.netProfit > 0) {
    fcfProxy = health.anchors.netProfit * 0.7;
    notes.push("FCF proxy = 70% LN ròng (thiếu OCF−CAPEX dương)");
  }

  const marketCapFromPrice =
    priceVnd > 0 && sharesOutstanding != null && sharesOutstanding > 0
      ? priceVnd * sharesOutstanding
      : null;
  const marketCapPreferred =
    marketCapReported && marketCapReported > 0
      ? marketCapReported
      : marketCapFromPrice ?? vndRatios?.marketCap ?? null;

  if (marketCapPreferred) {
    notes.push(`Vốn hóa: ${Math.round(marketCapPreferred).toLocaleString("vi-VN")} VND`);
  }

  health = {
    ...health,
    anchors: {
      ...health.anchors,
      shares: sharesOutstanding ?? health.anchors.shares,
      eps:
        epsTtm ??
        (health.anchors.netProfit != null && sharesOutstanding && sharesOutstanding > 0
          ? health.anchors.netProfit / sharesOutstanding
          : health.anchors.eps),
      fcf: fcfProxy ?? health.anchors.fcf,
    },
  };

  const peerComparison = peerPack?.peers ?? null;
  if (peerComparison?.length) {
    notes.push(`Peers: ${peerComparison.map((p: { symbol: string }) => p.symbol).join(", ")}`);
  }

  const valuation = computeValuation({
    price: priceQuote > 0 ? priceQuote : 0,
    health,
    sector: sectorOf(symbol),
    peerComparison: peerComparison as Parameters<typeof computeValuation>[0]["peerComparison"],
    marketCapOverride: marketCapPreferred,
    historical: null,
  });

  const eng = valuation.multiples;
  const multiples = {
    pe: saneMultiple(vndRatios?.pe) ?? saneMultiple(eng.pe),
    pb: saneMultiple(vndRatios?.pb) ?? saneMultiple(eng.pb),
    ps: saneMultiple(vndRatios?.ps) ?? saneMultiple(eng.ps),
    peg: saneMultiple(eng.peg),
    pcf: saneMultiple(eng.pcf),
    pfcf: saneMultiple(eng.pfcf),
    evEbitda: saneMultiple(vndRatios?.evEbitda) ?? saneMultiple(eng.evEbitda),
    evEbit: saneMultiple(eng.evEbit),
    evSales: saneMultiple(eng.evSales),
    evFcff: saneMultiple(eng.evFcff),
    fcfYield: saneYieldPct(eng.fcfYield),
    dividendYield: saneYieldPct(vndRatios?.dividendYield) ?? saneYieldPct(eng.dividendYield),
    earningsYield: saneYieldPct(eng.earningsYield),
  };

  const p3 = valuation.phase3;
  const p4 = valuation.phase4;
  const p5 = valuation.phase5;
  const blended = p5?.confidenceBands?.base ?? valuation.fairValue?.blended ?? null;
  if (blended == null && priceQuote > 0) {
    notes.push("Chưa đủ dữ liệu DCF/fair value đầy đủ — dựa multiples thị trường.");
  }

  const upside =
    blended != null && priceQuote > 0
      ? {
          fairValue: blended,
          price: priceQuote,
          upsidePct: ((blended - priceQuote) / priceQuote) * 100,
        }
      : null;

  const enterpriseValue =
    valuation.enterpriseValue ??
    (marketCapPreferred != null
      ? marketCapPreferred + (health.anchors?.netDebt ?? 0)
      : null);

  const dcfScenarios = (valuation.dcf ?? []).map((row) => {
    return {
      label: row.label,
      growthY1to5: row.growthY1to5,
      terminalGrowth: row.terminalGrowth,
      discountRate: row.discountRate,
      intrinsicPerShare: row.intrinsicPerShare,
      marginOfSafetyPct: row.marginOfSafetyPct,
      terminalMethod: "gordon",
      cashFlowType: "fcf_proxy",
      explicitYears: [],
      notes: [],
    };
  });

  // Detailed ratio suite (liquidity · leverage · profitability · efficiency · valuation · DuPont)
  let detailedRatios = null as ReturnType<typeof computeDetailedRatios> | null;
  try {
    const picked = pickMetricsFromPeriods(fs?.periods ?? []);
    detailedRatios = computeDetailedRatios({
      metrics: picked.metrics,
      prior: picked.prior,
      priceQuote: priceQuote > 0 ? priceQuote : null,
      sharesOutstanding,
      marketMultiples: vndRatios
        ? {
            pe: vndRatios.pe,
            pb: vndRatios.pb,
            ps: vndRatios.ps,
            evEbitda: vndRatios.evEbitda,
            dividendYield: vndRatios.dividendYield,
            marketCap: vndRatios.marketCap ?? marketCapPreferred ?? null,
          }
        : { marketCap: marketCapPreferred ?? null },
      periodLabel: picked.label,
    });
    if (detailedRatios.quality.filled > 0) {
      notes.push(
        `Chỉ số TC chi tiết: ${detailedRatios.quality.filled}/${detailedRatios.quality.total} · score ${detailedRatios.quality.score}/100`,
      );
    }
  } catch {
    /* non-fatal */
  }

  const allNotes = [...notes, ...(valuation.notes ?? [])].slice(0, 40);

  const resolvedMarketCap =
    marketCapPreferred ?? valuation.marketCap ?? marketCapFromPrice;

  const data: Record<string, unknown> = {
    symbol,
    sharesOutstanding,
    sharesSource,
    sharesReportDate,
    marketCap: resolvedMarketCap,
    marketCapReported,
    marketSnapshot: {
      price: priceQuote > 0 ? priceQuote : valuation.price,
      priceVnd,
      priceSource,
      sharesOutstanding,
      sharesSource,
      sharesReportDate,
      marketCap: resolvedMarketCap,
      marketCapReported,
      enterpriseValue: enterpriseValue ?? null,
    },
    enterpriseValue,
    multiples,
    detailedRatios,
    vndirectRatios: vndRatios
      ? {
          pe: vndRatios.pe,
          pb: vndRatios.pb,
          ps: vndRatios.ps,
          eps: vndRatios.eps,
          bvps: vndRatios.bvps,
          roe: vndRatios.roe,
          roa: vndRatios.roa,
          dividendYield: vndRatios.dividendYield,
          marketCap: vndRatios.marketCap,
          reportDate: vndRatios.reportDate,
          source: vndRatios.source,
        }
      : null,
    fairValues: {
      blended,
      low: p5?.confidenceBands?.low ?? null,
      base: p5?.confidenceBands?.base ?? null,
      high: p5?.confidenceBands?.high ?? null,
      bandWidthPct: p5?.confidenceBands?.bandWidthPct ?? null,
      dcf: valuation.dcf,
    },
    dcfDetail: {
      scenarios: dcfScenarios,
      sensitivity: valuation.sensitivity ?? p3?.sensitivity ?? null,
      costOfCapital: p3?.costOfCapital ?? null,
    },
    upsideDownside: upside,
    confidence: valuation.confidence,
    dataQuality: valuation.dataQuality,
    health: {
      score: health.scores?.overall ?? null,
      scores: health.scores,
      coverage: health.coverage,
      anchors: health.anchors,
      groups: health.groups,
      warnings: health.warnings?.slice(0, 8),
      riskFlags: health.riskFlags?.slice(0, 8),
      industry: health.industry,
    },
    notes: allNotes,
    pipeline: "fundamental-valuation-direct-v4-ratios",
    calculatedAt: new Date().toISOString(),
    valuationEngineVersion: valuation.valuationEngineVersion,
  };

  if (wantFull) {
    data.phase1 = valuation.phase1 ?? null;
    data.phase2 = valuation.phase2 ?? null;
    data.phase3 = p3 ?? null;
    data.phase4 = p4 ?? null;
    data.phase5 = p5 ?? null;
  }

  const meta = buildMeta({
    source: `fundamental-direct+${priceSource}+vndirect-fs+ratios`,
    sourceTimestampMs: Date.now(),
    note: allNotes[0] ?? "Định giá độc lập từ VNDirect",
  });

  return { symbol, data, meta, health };
}
