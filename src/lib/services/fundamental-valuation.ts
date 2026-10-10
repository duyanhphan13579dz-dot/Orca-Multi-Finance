/**
 * Pipeline phân tích cơ bản + định giá — ĐỘC LẬP với trang Báo cáo tài chính.
 */
import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { computeFinancialHealth, type FinancialHealthResult } from "../engines/fundamental";
import { computeValuation } from "../engines/valuation";
import { collectPeerMetrics } from "../engines/valuation-peers";
import { periodsToLegacyRows } from "../financial/vndirect-fs";
import { computeDetailedRatios, pickMetricsFromPeriods } from "../financial/ratio-engine";
import { buildTtmPeriod } from "../financial/normalize";
import {
  getVndEquitySnapshot,
  getVndValuationRatios,
  priceQuoteToVnd,
} from "../providers/vndirect-company";
import { getVietcapCompany } from "../providers/vietcap";
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import { industryFairMultiples } from "../financial/industry-profiles";
import { fetchFinancialStatementsMulti } from "../financial/fs-multi";
import { resolveCapmInputs, type CapmInputs } from "../financial/valuation-capm";
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

function deriveValuationCashFlowInputs(
  periods: NormalizedPeriod[] | undefined,
  ttm: NormalizedPeriod | null | undefined,
): ValuationCashFlowInputs {
  const ordered = (periods ?? []).filter((p) => p.periodType !== "ttm");
  const latest = ordered[0];
  const prior = ordered[1];
  const ebitTtm = ttm?.metrics?.ebit ?? latest?.metrics?.ebit ?? null;
  const ebitdaTtm = ttm?.metrics?.ebitda ?? latest?.metrics?.ebitda ?? null;
  const daTtm =
    ebitdaTtm != null && ebitTtm != null && ebitdaTtm >= ebitTtm
      ? ebitdaTtm - ebitTtm
      : null;
  const capexTtm =
    ttm?.metrics?.capex != null
      ? Math.abs(ttm.metrics.capex)
      : latest?.metrics?.capex != null
        ? Math.abs(latest.metrics.capex)
        : null;
  const preTax = latest?.metrics?.profitBeforeTax ?? null;
  const taxExp = latest?.metrics?.taxExpense ?? null;
  const taxRate =
    taxExp != null && preTax != null && preTax !== 0
      ? Math.min(0.4, Math.max(0, taxExp / preTax))
      : 0.2;
  const debt = (x: typeof latest) => {
    const st = x?.metrics?.shortTermDebt;
    const lt = x?.metrics?.longTermDebt;
    return st != null || lt != null ? (st ?? 0) + (lt ?? 0) : null;
  };
  const operatingNwc = (x: typeof latest) => {
    const ca = x?.metrics?.currentAssets;
    const cl = x?.metrics?.currentLiabilities;
    if (ca == null || cl == null) return null;
    const cash = x?.metrics?.cash ?? 0;
    const sti = x?.metrics?.shortTermInvestments ?? 0;
    const stDebt = x?.metrics?.shortTermDebt ?? 0;
    return ca - cash - sti - (cl - stDebt);
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

  const fsP = cached(`fv:fs:${symbol}:v5`, {
    ttlMs: 15 * 60_000,
    staleMs: 2 * 3_600_000,
    producer: async () => {
      const multi = await fetchFinancialStatementsMulti(symbol);
      if (!multi?.periods?.length) {
        throw new Error(`financial statements unavailable: ${symbol}`);
      }
      return multi;
    },
  })
    .then((r) => r.value)
    .catch(() => null);

  const quoteP = getVnQuotes([symbol]).catch(() => null);

  const equityP = cached(`fv:equity:${symbol}:v3`, {
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

  const vietcapP = cached(`fv:vietcap:${symbol}:v1`, {
    ttlMs: 30 * 60_000,
    staleMs: 4 * 3_600_000,
    producer: async () => {
      const vc = await getVietcapCompany(symbol);
      if (!vc) throw new Error(`vietcap unavailable: ${symbol}`);
      return vc;
    },
  })
    .then((r) => r.value)
    .catch(() => null);

  const capmP = resolveCapmInputs(symbol, { skipBeta: !wantFull }).catch(() => null);

  const [fs, quotes, equity, vndRatios, peerPack, vietcap, capm] = await Promise.all([
    fsP, quoteP, equityP, ratiosP, peersP, vietcapP, capmP,
  ]);

  let priceQuote =
    quotes?.quotes?.[0]?.price && quotes.quotes[0].price > 0 ? quotes.quotes[0].price : 0;
  let priceSource: string | null =
    priceQuote > 0 ? (quotes?.meta?.source ? String(quotes.meta.source) : "quotes") : null;

  if (priceQuote <= 0 && vietcap?.price != null && vietcap.price > 0) {
    priceQuote = vietcap.price;
    priceSource = "vietcap";
  }

  const provisionalShares =
    (equity?.sharesOutstanding ?? equity?.totalShares ?? vietcap?.sharesOutstanding) || null;
  const provisionalMcap =
    (vndRatios?.marketCap && vndRatios.marketCap > 0 ? vndRatios.marketCap : null) ??
    (equity?.marketCapReported && equity.marketCapReported > 0 ? equity.marketCapReported : null) ??
    (vietcap?.marketCap && vietcap.marketCap > 0 ? vietcap.marketCap : null);
  if (priceQuote <= 0 && provisionalMcap && provisionalShares && provisionalShares > 0) {
    const vndPerShare = provisionalMcap / provisionalShares;
    priceQuote = vndPerShare >= 500 ? vndPerShare / 1000 : vndPerShare;
    priceSource = "implied-mcap/shares";
  }

  const priceVnd = priceQuoteToVnd(priceQuote) ?? 0;

  if (!fs?.periods?.length && priceQuote <= 0 && !vndRatios?.marketCap && !provisionalMcap) {
    return null;
  }

  const notes: string[] = [];
  notes.push("Pipeline độc lập — quote + ratios + BCTC đa nguồn + định giá đa phương pháp.");
  if (priceQuote > 0 && priceQuote < 500) {
    notes.push(`Giá quote ${priceQuote} → ${priceVnd.toLocaleString("vi-VN")} VND (×1000 nghìn đồng).`);
  }
  if (priceSource) notes.push(`Nguồn giá: ${priceSource}.`);

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
    const srcList = (fs as { sources?: string[] }).sources;
    notes.push(
      `BCTC: ${fs.periods.length} kỳ · latency ${fs.latencyMs ?? 0}ms · nguồn ${(srcList ?? [fs.periods[0]?.source ?? "financial-provider"]).join(" ∥ ")}`,
    );
  } else {
    health = computeFinancialHealth(
      { income: [], balance: [], cashflow: [] },
      { symbol },
    );
    notes.push("Không lấy được BCTC — chỉ dùng ratios/giá thị trường nếu có.");
  }

  let sharesOutstanding: number | null = health.anchors?.shares ?? null;
  let sharesSource: string | null = sharesOutstanding != null ? "financial-statements" : null;
  const eqShares = equity?.sharesOutstanding ?? equity?.totalShares ?? null;
  if (eqShares != null && eqShares > 0) {
    sharesOutstanding = eqShares;
    sharesSource = equity?.source ?? "vndirect-equity";
  }
  if ((sharesOutstanding == null || sharesOutstanding <= 0) && vietcap?.sharesOutstanding && vietcap.sharesOutstanding > 0) {
    sharesOutstanding = vietcap.sharesOutstanding;
    sharesSource = "vietcap";
  }
  if (sharesOutstanding != null && sharesOutstanding > 0 && health.anchors) {
    health = {
      ...health,
      anchors: { ...health.anchors, shares: sharesOutstanding },
    };
  }

  const ttm = fs?.periods?.length ? buildTtmPeriod(fs.periods) : null;
  const cfInputs = deriveValuationCashFlowInputs(fs?.periods, ttm);

  const industryFair = industryFairMultiples(symbol);
  if (industryFair.fairPe != null) {
    notes.push(
      `Ngành ${industryFair.labelVi}: fair PE hướng dẫn ~${industryFair.fairPe.toFixed(1)}x (khi thiếu peers/hist).`,
    );
  }

  const marketCapOverride =
    (vndRatios?.marketCap != null && vndRatios.marketCap > 0 ? vndRatios.marketCap : null) ??
    (equity?.marketCapReported != null && equity.marketCapReported > 0
      ? equity.marketCapReported
      : null) ??
    (vietcap?.marketCap != null && vietcap.marketCap > 0 ? vietcap.marketCap : null);

  if (capm?.notes?.length) notes.push(...capm.notes.slice(0, 4));

  const valuation = computeValuation({
    fairPe: industryFair.fairPe,
    fairPb: industryFair.fairPb,
    fairEvEbitda: industryFair.fairEvEbitda,
    price: priceQuote > 0 ? priceQuote : 1,
    priceVnd: priceVnd > 0 ? priceVnd : null,
    marketCapOverride,
    health,
    dividendYield: vndRatios?.dividendYield ?? null,
    ebitTtm: cfInputs.ebitTtm,
    taxRate: cfInputs.taxRate,
    daTtm: cfInputs.daTtm,
    capexTtm: cfInputs.capexTtm,
    deltaNwc: cfInputs.deltaNwc,
    netBorrowing: cfInputs.netBorrowing,
    riskFreeRate: capm?.riskFreeRate ?? null,
    beta: capm?.beta ?? null,
    equityRiskPremium: capm
      ? capm.equityRiskPremium + capm.countryRiskPremium
      : null,
    peerComparison: peerPack?.peers?.length
      ? {
          symbol,
          sector: peerPack.sector ?? sectorOf(symbol),
          subject: {
            symbol,
            pe: saneMultiple(vndRatios?.pe) ?? null,
            pb: saneMultiple(vndRatios?.pb) ?? null,
            ps: saneMultiple(vndRatios?.ps) ?? null,
            evEbitda: saneMultiple(vndRatios?.evEbitda) ?? null,
            pfcf: null,
            dividendYield: yieldRatioToPct(vndRatios?.dividendYield),
            marketCap: marketCapOverride,
          },
          peers: peerPack.peers,
        }
      : undefined,
    symbol,
    level: wantFull ? "full" : "basic",
  });

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
            pe: saneMultiple(vndRatios.pe),
            pb: saneMultiple(vndRatios.pb),
            ps: saneMultiple(vndRatios.ps),
            evEbitda: saneMultiple(vndRatios.evEbitda),
            dividendYield: yieldRatioToPct(vndRatios.dividendYield),
            marketCap: vndRatios.marketCap ?? null,
          }
        : { marketCap: null },
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
  const sourceParts = [
    priceQuote > 0 ? quotes?.meta?.source : null,
    fs?.periods?.length ? (fs as { sources?: string[] }).sources?.join("+") ?? "bctc" : null,
    equity?.source,
    vndRatios?.source,
    vietcap ? "vietcap" : null,
    capm ? `capm:${capm.sources.beta}+${capm.sources.riskFree}` : null,
    peerPack?.peers?.length ? "sector-peers" : null,
    industryFair.profileId,
  ].filter((part): part is string => Boolean(part));

  const capmPayload: CapmInputs | null = capm;
  const v = valuation;
  const p5 = v.phase5;

  const flatPrice = priceQuote > 0 ? priceQuote : v.price > 0 ? v.price : null;
  const flatMcap = v.marketCap ?? marketCapOverride;
  const flatMult = v.multiples;
  const multPe = flatMult.pe ?? saneMultiple(vndRatios?.pe) ?? null;
  const multPb = flatMult.pb ?? saneMultiple(vndRatios?.pb) ?? null;
  const multPs = flatMult.ps ?? saneMultiple(vndRatios?.ps) ?? null;
  const multEv = flatMult.evEbitda ?? saneMultiple(vndRatios?.evEbitda) ?? null;

  const data: Record<string, unknown> = {
    symbol,
    currentPrice: flatPrice,
    price: flatPrice,
    priceVnd: priceVnd > 0 ? priceVnd : null,
    priceSource,
    marketCap: flatMcap,
    enterpriseValue: v.enterpriseValue,
    sharesOutstanding,
    sharesSource,
    multiples: {
      pe: multPe,
      pb: multPb,
      ps: multPs,
      peg: flatMult.peg,
      pcf: flatMult.pcf,
      pfcf: flatMult.pfcf,
      evEbitda: multEv,
      evEbit: flatMult.evEbit,
      evSales: flatMult.evSales,
      evFcff: flatMult.evFcff,
      fcfYield: flatMult.fcfYield,
      dividendYield: flatMult.dividendYield ?? yieldRatioToPct(vndRatios?.dividendYield),
      earningsYield: flatMult.earningsYield,
    },
    fairValues: {
      blended: p5?.finalFairValue ?? v.fairValue?.blendedFairValue ?? null,
      dcfBase: v.fairValue?.methods?.dcfBase ?? null,
      dcfBear: v.fairValue?.methods?.dcfBear ?? null,
      dcfBull: v.fairValue?.methods?.dcfBull ?? null,
      peBased: v.fairValue?.methods?.peBased ?? null,
      pbBased: v.fairValue?.methods?.pbBased ?? null,
      evEbitdaBased: v.fairValue?.methods?.evEbitdaBased ?? null,
      pfcfBased: v.fairValue?.methods?.pfcfBased ?? null,
      status: v.fairValue?.valuationStatus ?? p5?.valuationStatus ?? null,
    },
    upsideDownside: p5?.score?.upsidePct ?? v.fairValue?.upsidePct ?? null,
    valuationScore: p5?.valuationScore ?? null,
    valuationGrade: p5?.grade ?? null,
    confidence: v.confidence,
    industryProfile: industryFair.labelVi,
    dcfDetail: v.phase3
      ? {
          scenarios: v.phase3.dcf,
          sensitivity: v.phase3.sensitivity ?? v.sensitivity ?? null,
          costOfCapital: v.phase3.costOfCapital,
        }
      : v.dcf
        ? { scenarios: v.dcf, sensitivity: v.sensitivity ?? null, costOfCapital: null }
        : null,
    health,
    valuation: v,
    detailedRatios,
    capm: capmPayload
      ? {
          riskFreeRate: capmPayload.riskFreeRate,
          beta: capmPayload.beta,
          equityRiskPremium: capmPayload.equityRiskPremium,
          countryRiskPremium: capmPayload.countryRiskPremium,
          costOfEquity: capmPayload.costOfEquity,
          sources: capmPayload.sources,
          betaMeta: capmPayload.betaMeta,
          notes: capmPayload.notes,
        }
      : null,
    industry: {
      id: industryFair.profileId,
      labelVi: industryFair.labelVi,
      fairPe: industryFair.fairPe,
      fairPb: industryFair.fairPb,
      fairEvEbitda: industryFair.fairEvEbitda,
    },
    marketRatios: {
      pe: saneMultiple(vndRatios?.pe) ?? null,
      pb: saneMultiple(vndRatios?.pb) ?? null,
      ps: saneMultiple(vndRatios?.ps) ?? null,
      evEbitda: saneMultiple(vndRatios?.evEbitda) ?? null,
      dividendYield: yieldRatioToPct(vndRatios?.dividendYield),
      marketCap: marketCapOverride,
      marketCapSources: [
        vndRatios?.marketCap ? "vndirect-ratios" : null,
        equity?.marketCapReported ? "vndirect-equity" : null,
        vietcap?.marketCap ? "vietcap" : null,
      ].filter(Boolean),
    },
    vndirectRatios: {
      pe: saneMultiple(vndRatios?.pe) ?? null,
      pb: saneMultiple(vndRatios?.pb) ?? null,
      ps: saneMultiple(vndRatios?.ps) ?? null,
      evEbitda: saneMultiple(vndRatios?.evEbitda) ?? null,
      dividendYield: yieldRatioToPct(vndRatios?.dividendYield),
      marketCap: marketCapOverride,
    },
    peers: peerPack,
    notes: allNotes,
    ttmPeriod: ttm?.period ?? null,
  };

  const meta = buildMeta({
    source: sourceParts.join("+") || "fundamental-valuation",
    sourceTimestampMs: Date.now(),
    partial: !fs?.periods?.length || priceQuote <= 0,
    note: allNotes[0],
  });

  return { symbol, data, meta, health };
}
