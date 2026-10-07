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
import { fetchVnstockFinancials } from "../financial/vnstock-provider";
import { computeDetailedRatios, pickMetricsFromPeriods } from "../financial/ratio-engine";
import { buildTtmPeriod } from "../financial/normalize";
import {
  getVndEquitySnapshot,
  getVndValuationRatios,
  priceQuoteToVnd,
} from "../providers/vndirect-company";
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import type { Meta } from "../types";
import type { NormalizedPeriod } from "../financial/types";

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

function yieldRatioToPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  const ratio = v > 1 ? v / 100 : v;
  return ratio <= 0.8 ? Number((ratio * 100).toFixed(2)) : null;
}

type ValuationCashFlowInputs = {
  ebitTtm: number | null;
  taxRate: number | null;
  daTtm: number | null;
  capexTtm: number | null;
  deltaNwc: number | null;
  netBorrowing: number | null;
};

function finitePositive(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Derive only statement-backed FCFF/FCFE inputs. Missing fields stay null so
 * valuation methods can report incomplete data instead of silently assuming 0.
 */
function deriveValuationCashFlowInputs(
  periods: NormalizedPeriod[] | undefined,
  ttm: NormalizedPeriod | null | undefined,
): ValuationCashFlowInputs {
  const m = ttm?.metrics;
  const ebitTtm = m?.ebit ?? m?.operatingProfit ?? null;
  const ebitdaTtm = m?.ebitda ?? null;
  const daTtm =
    ebitTtm != null && ebitdaTtm != null && ebitdaTtm >= ebitTtm
      ? ebitdaTtm - ebitTtm
      : null;
  const capexTtm = m?.capex != null && Number.isFinite(m.capex) ? Math.abs(m.capex) : null;
  const taxRate =
    m?.taxExpense != null && m.profitBeforeTax != null && m.profitBeforeTax > 0
      ? Math.min(0.5, Math.max(0, m.taxExpense / m.profitBeforeTax))
      : null;

  const snapshots = (periods ?? [])
    .filter(
      (p) =>
        p.periodType === "quarter" &&
        (p.metrics.currentAssets != null ||
          p.metrics.currentLiabilities != null ||
          p.metrics.shortTermDebt != null ||
          p.metrics.longTermDebt != null),
    )
    .sort((a, b) => String(b.fiscalDate ?? b.period).localeCompare(String(a.fiscalDate ?? a.period)));
  const latest = snapshots[0]?.metrics;
  const prior = snapshots[1]?.metrics;
  const debt = (x: typeof latest) =>
    x && (x.shortTermDebt != null || x.longTermDebt != null)
      ? (x.shortTermDebt ?? 0) + (x.longTermDebt ?? 0)
      : null;
  const operatingNwc = (x: typeof latest) => {
    if (!x || x.currentAssets == null || x.currentLiabilities == null) return null;
    return (
      x.currentAssets -
      (x.cash ?? 0) -
      (x.shortTermInvestments ?? 0) -
      (x.currentLiabilities - (x.shortTermDebt ?? 0))
    );
  };
  const latestNwc = operatingNwc(latest);
  const priorNwc = operatingNwc(prior);
  const latestDebt = debt(latest);
  const priorDebt = debt(prior);

  return {
    ebitTtm: finitePositive(ebitTtm) ?? (ebitTtm != null && ebitTtm < 0 ? ebitTtm : null),
    taxRate,
    daTtm: finitePositive(daTtm),
    capexTtm: finitePositive(capexTtm),
    deltaNwc: latestNwc != null && priorNwc != null ? latestNwc - priorNwc : null,
    netBorrowing: latestDebt != null && priorDebt != null ? latestDebt - priorDebt : null,
  };
}

export async function runFundamentalValuation(
  symbolRaw: string,
  opts?: { peers?: boolean; full?: boolean },
): Promise<FundamentalValuationResult | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length < 3 || symbol.length > 12) return null;

  const wantFull = opts?.full === true;
  const wantPeers = opts?.peers === true || (opts?.peers !== false && wantFull);

  const fsP = cached(`fv:fs:${symbol}:v3`, {
    ttlMs: 15 * 60_000,
    staleMs: 2 * 3_600_000,
    producer: async () => {
      const primary = await fetchVndirectFinancials(symbol, { limitPeriods: 16 });
      if (primary?.periods.length) return primary;
      const fallback = await fetchVnstockFinancials(symbol, { limitPeriods: 16 });
      if (fallback?.periods.length) return fallback;
      throw new Error(`financial statements unavailable from configured providers: ${symbol}`);
    },
  })
    .then((r) => r.value)
    .catch(() => null);

  const quoteP = getVnQuotes([symbol]).catch(() => null);

  const equityP = cached(`fv:equity:${symbol}:v2`, {
    ttlMs: 2 * 3_600_000,
    staleMs: 12 * 3_600_000,
    producer: async () => {
      const result = await getVndEquitySnapshot(symbol);
      if (!result) throw new Error(`equity snapshot unavailable: ${symbol}`);
      return result;
    },
  })
    .then((r) => r.value)
    .catch(() => null);

  const ratiosP = cached(`fv:ratios:${symbol}:v2`, {
    ttlMs: 5 * 60_000,
    staleMs: 60 * 60_000,
    producer: async () => {
      const result = await getVndValuationRatios(symbol);
      if (!result) throw new Error(`valuation ratios unavailable: ${symbol}`);
      return result;
    },
  })
    .then((r) => r.value)
    .catch(() => null);

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
  notes.push("Pipeline độc lập — quote thị trường + VNDirect ratios + BCTC đa nguồn + DCF 2 giai đoạn.");
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
    notes.push(`BCTC: ${fs.periods.length} kỳ · latency ${fs.latencyMs}ms · nguồn ${fs.periods[0]?.source ?? "financial-provider"}`);
  } else {
    health = computeFinancialHealth(
      { income: [], balance: [], cashflow: [] },
      { symbol },
    );
    notes.push("Không lấy được BCTC từ nguồn đã cấu hình — chỉ dùng ratios/giá thị trường nếu có.");
  }

  let sharesOutstanding: number | null = health.anchors?.shares ?? null;
  let sharesSource: string | null = sharesOutstanding != null ? "financial-statements" : null;
  let sharesReportDate: string | null = null;
  let marketCapReported: number | null = equity?.marketCapReported ?? null;
  if (equity) sharesReportDate = equity.reportDate ?? null;

  if (equity?.sharesOutstanding && equity.sharesOutstanding > 0) {
    sharesOutstanding = equity.sharesOutstanding;
    sharesSource = equity.source ?? "vndirect-equity";
  }

  let epsTtm: number | null = health.anchors.epsTtm;
  if (vndRatios?.eps != null && Number.isFinite(vndRatios.eps) && vndRatios.eps !== 0) {
    epsTtm = vndRatios.eps;
    notes.push(`EPS TTM từ VNDirect ratios: ${epsTtm}`);
  } else if (vndRatios?.pe != null && vndRatios.pe > 0 && priceVnd > 0) {
    // EPS must use full VND/share just like statements, not the market quote unit.
    epsTtm = priceVnd / vndRatios.pe;
    notes.push("EPS suy ngược từ giá VND / P/E VNDirect (được đánh dấu là suy ra)");
  }

  const fcfTtm = health.anchors.fcfTtm;
  const cashFlowInputs = deriveValuationCashFlowInputs(
    fs?.periods,
    fs?.periods?.length ? buildTtmPeriod(fs.periods) : null,
  );

  const marketCapFromPrice =
    priceVnd > 0 && sharesOutstanding != null && sharesOutstanding > 0
      ? priceVnd * sharesOutstanding
      : null;
  // Re-price shares outstanding with the current quote; fall back to the latest
  // reported market cap only when quote or share count is unavailable.
  const marketCapPreferred =
    sharesSource?.includes("estimate") && marketCapReported != null && marketCapReported > 0
      ? marketCapReported
      : marketCapFromPrice ??
        (marketCapReported != null && marketCapReported > 0 ? marketCapReported : null) ??
        vndRatios?.marketCap ??
        null;

  if (marketCapPreferred) {
    notes.push(`Vốn hóa: ${Math.round(marketCapPreferred).toLocaleString("vi-VN")} VND`);
  }

  health = {
    ...health,
    anchors: {
      ...health.anchors,
      shares: sharesOutstanding ?? health.anchors.shares,
      epsTtm:
        epsTtm ??
        (health.anchors.netProfit != null && sharesOutstanding != null && sharesOutstanding > 0
          ? health.anchors.netProfit / sharesOutstanding
          : health.anchors.epsTtm),
      fcfTtm,
    },
  };

  const anchors = health.anchors;
  const currentPe =
    vndRatios?.pe ??
    (priceVnd > 0 && epsTtm != null && epsTtm > 0 ? priceVnd / epsTtm : null);
  const bvps =
    anchors.equity != null && sharesOutstanding != null && sharesOutstanding > 0
      ? anchors.equity / sharesOutstanding
      : null;
  const currentPb =
    vndRatios?.pb ?? (priceVnd > 0 && bvps != null && bvps > 0 ? priceVnd / bvps : null);
  const currentPs =
    vndRatios?.ps ??
    (marketCapPreferred != null && anchors.revenue != null && anchors.revenue > 0
      ? marketCapPreferred / anchors.revenue
      : null);
  const currentEv =
    marketCapPreferred != null && anchors.totalDebt != null && anchors.cash != null
      ? marketCapPreferred + anchors.totalDebt - anchors.cash
      : null;
  const currentEvEbitda =
    vndRatios?.evEbitda ??
    (currentEv != null && anchors.ebitdaTtm != null && anchors.ebitdaTtm > 0
      ? currentEv / anchors.ebitdaTtm
      : null);
  const currentPfcf =
    marketCapPreferred != null && fcfTtm != null && fcfTtm > 0
      ? marketCapPreferred / fcfTtm
      : null;
  const dividendYieldRatio =
    vndRatios?.dividendYield == null
      ? null
      : vndRatios.dividendYield > 1
        ? vndRatios.dividendYield / 100
        : vndRatios.dividendYield;

  const peerComparison = peerPack?.peers.length
    ? {
        symbol,
        sector: peerPack.sector || sectorOf(symbol),
        subject: {
          symbol,
          pe: currentPe,
          pb: currentPb,
          ps: currentPs,
          evEbitda: currentEvEbitda,
          pfcf: currentPfcf,
          dividendYield: dividendYieldRatio,
          marketCap: marketCapPreferred,
        },
        peers: peerPack.peers,
      }
    : undefined;
  if (peerComparison) {
    notes.push(`Peers: ${peerComparison.peers.map((p) => p.symbol).join(", ")}`);
  }

  const valuation = computeValuation({
    price: priceQuote > 0 ? priceQuote : 0,
    priceVnd: priceVnd > 0 ? priceVnd : null,
    health,
    peerComparison,
    marketCapOverride: marketCapPreferred,
    dividendYield: dividendYieldRatio,
    ebitTtm: cashFlowInputs.ebitTtm,
    taxRate: cashFlowInputs.taxRate,
    daTtm: cashFlowInputs.daTtm,
    deltaNwc: cashFlowInputs.deltaNwc,
    netBorrowing: cashFlowInputs.netBorrowing,
    capexTtm: cashFlowInputs.capexTtm,
    symbol,
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
    dividendYield: yieldRatioToPct(vndRatios?.dividendYield) ?? saneYieldPct(eng.dividendYield),
    earningsYield: saneYieldPct(eng.earningsYield),
  };

  const p3 = valuation.phase3;
  const p4 = valuation.phase4;
  const p5 = valuation.phase5;
  const blended = p5?.finalFairValue ?? valuation.fairValue?.blendedFairValue ?? null;
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

  const enterpriseValue = valuation.enterpriseValue;

  // Preserve the detailed DCF model rows (assumptions, yearly PVs, terminal
  // value, fairPriceQuote and sensitivity-compatible units) for the UI.
  const dcfScenarios = valuation.phase3?.dcf ?? [];

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
  const timestampMs = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const quoteTimestampMs =
    timestampMs(quotes?.meta?.sourceTimestamp) ??
    timestampMs(quotes?.quotes?.[0]?.updatedAt);
  const financialTimestampMs = timestampMs(fs?.periods?.[0]?.fiscalDate);
  const ratioTimestampMs = timestampMs(vndRatios?.reportDate);
  const sourceTimestampMs =
    quoteTimestampMs ?? financialTimestampMs ?? ratioTimestampMs ?? timestampMs(equity?.reportDate);
  const sourceParts = [
    priceQuote > 0 ? quotes?.meta?.source : null,
    fs?.periods.length ? fs.periods[0]?.source ?? "vndirect-fs" : null,
    equity?.source,
    vndRatios?.source,
    peerPack?.peers.length ? "sector-peers" : null,
  ].filter((part): part is string => Boolean(part));

  const data: Record<string, unknown> = {
    symbol,
    sharesOutstanding,
    sharesSource,
    sharesReportDate,
    marketCap: resolvedMarketCap,
    marketCapReported,
    currentPrice: priceQuote > 0 ? priceQuote : null,
    priceSource,
    marketSnapshot: {
      price: priceQuote > 0 ? priceQuote : null,
      priceVnd: priceVnd > 0 ? priceVnd : null,
      priceSource,
      priceUnitScale: priceQuote > 0 ? priceVnd / priceQuote : null,
      sharesOutstanding,
      sharesSource,
      sharesReportDate,
      marketCap: resolvedMarketCap,
      marketCapReported,
      enterpriseValue: enterpriseValue ?? null,
    },
    valuationUnits: {
      marketPrice: "market-quote",
      fairValue: "market-quote",
      financialPerShare: "VND/share",
      marketCap: "VND",
      enterpriseValue: "VND",
      quoteScale: priceQuote > 0 ? priceVnd / priceQuote : 1_000,
    },
    sourceDetails: {
      market: {
        source: priceQuote > 0 ? quotes?.meta?.source ?? priceSource : null,
        sourceTimestamp: quotes?.meta?.sourceTimestamp ?? quotes?.quotes?.[0]?.updatedAt ?? null,
      },
      financialStatements: {
        source: fs?.periods?.[0]?.source ?? null,
        latestPeriod: fs?.periods?.[0]?.period ?? null,
        fiscalDate: fs?.periods?.[0]?.fiscalDate ?? null,
      },
      equity: {
        source: equity?.source ?? null,
        reportDate: equity?.reportDate ?? null,
        shares: sharesOutstanding,
      },
      ratios: {
        source: vndRatios?.source ?? null,
        reportDate: vndRatios?.reportDate ?? null,
      },
      peers: peerPack?.peers.map((peer) => peer.symbol) ?? [],
      sourcesUsed: sourceParts,
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
      dcfBase: valuation.phase3?.fairValue.methods.dcfBase ?? null,
      dcfBear: valuation.phase3?.fairValue.methods.dcfBear ?? null,
      dcfBull: valuation.phase3?.fairValue.methods.dcfBull ?? null,
      dcf: dcfScenarios,
    },
    dcfDetail: {
      scenarios: dcfScenarios,
      sensitivity: valuation.sensitivity ?? p3?.sensitivity ?? null,
      costOfCapital: p3?.costOfCapital ?? null,
    },
    upsideDownside: upside?.upsidePct ?? null,
    upsideDownsideDetail: upside,
    valuationScore: p5?.valuationScore ?? null,
    valuationGrade: p5?.grade ?? null,
    industryProfile: p5?.profileId ?? null,
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
    source: `fundamental-direct+${sourceParts.join("+") || "no-source"}`,
    sourceTimestampMs,
    hasData: Boolean(priceQuote > 0 || fs?.periods.length || resolvedMarketCap),
    degraded: priceQuote <= 0 || !fs?.periods.length,
    partial: priceQuote <= 0 || !fs?.periods.length || sharesOutstanding == null,
    note: allNotes[0] ?? "Định giá độc lập từ nguồn dữ liệu thị trường/BCTC",
    slas: { liveSlaMs: 20_000, freshSlaMs: 120_000, delayedSlaMs: 7 * 86_400_000 },
  });

  return { symbol, data, meta, health };
}
