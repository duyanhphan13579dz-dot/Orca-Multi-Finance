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
import { getVnQuotes } from "./stocks";
import { sectorOf } from "../vn/master";
import { industryFairMultiples } from "../financial/industry-profiles";
import { fetchFinancialStatementsMulti } from "../financial/fs-multi";
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

function deriveValuationCashFlowInputs(
  periods: NormalizedPeriod[] | undefined,
  ttm: NormalizedPeriod | null | undefined,
): ValuationCashFlowInputs {
  const ordered = (periods ?? []).filter((p) => p.periodType !== "ttm");
  const latest = ordered[0];
  const prior = ordered[1];
  const ebitTtm = ttm?.ebit ?? latest?.ebit ?? null;
  const daTtm = ttm?.da ?? latest?.da ?? null;
  const capexTtm =
    ttm?.capex != null
      ? Math.abs(ttm.capex)
      : latest?.capex != null
        ? Math.abs(latest.capex)
        : null;
  const taxRate =
    latest?.taxExpense != null && latest?.preTaxIncome != null && latest.preTaxIncome !== 0
      ? Math.min(0.4, Math.max(0, latest.taxExpense / latest.preTaxIncome))
      : 0.2;
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
  const priceVnd = priceQuoteToVnd(priceQuote);

  if (!fs?.periods?.length && priceQuote <= 0 && !vndRatios?.marketCap) {
    return null;
  }

  const notes: string[] = [];
  notes.push("Pipeline độc lập — quote + ratios + BCTC đa nguồn + định giá đa phương pháp.");
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
  if (equity?.listedShare && equity.listedShare > 0) {
    sharesOutstanding = equity.listedShare;
    sharesSource = equity.source ?? "vndirect-equity";
  }

  const ttm = fs?.periods?.length ? buildTtmPeriod(fs.periods) : null;
  const cfInputs = deriveValuationCashFlowInputs(fs?.periods, ttm);

  const industryFair = industryFairMultiples(symbol);
  if (industryFair.fairPe != null) {
    notes.push(
      `Ngành ${industryFair.labelVi}: fair PE hướng dẫn ~${industryFair.fairPe.toFixed(1)}x (khi thiếu peers/hist).`,
    );
  }

  const valuation = computeValuation({
    fairPe: industryFair.fairPe,
    fairPb: industryFair.fairPb,
    fairEvEbitda: industryFair.fairEvEbitda,
    price: priceQuote > 0 ? priceQuote : 1,
    priceVnd: priceVnd > 0 ? priceVnd : null,
    marketCapOverride: vndRatios?.marketCap ?? null,
    health,
    dividendYield: vndRatios?.dividendYield ?? null,
    ebitTtm: cfInputs.ebitTtm,
    taxRate: cfInputs.taxRate,
    daTtm: cfInputs.daTtm,
    capexTtm: cfInputs.capexTtm,
    deltaNwc: cfInputs.deltaNwc,
    netBorrowing: cfInputs.netBorrowing,
    historicalRows: undefined,
    peerComparison: peerPack
      ? {
          symbol,
          sector: sectorOf(symbol),
          subject: peerPack.subject,
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
            dividendYield: saneYieldPct(vndRatios.dividendYield),
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
    peerPack?.peers?.length ? "sector-peers" : null,
    industryFair.profileId,
  ].filter((part): part is string => Boolean(part));

  const data: Record<string, unknown> = {
    symbol,
    sharesOutstanding,
    sharesSource,
    price: priceQuote > 0 ? priceQuote : null,
    priceVnd: priceVnd > 0 ? priceVnd : null,
    health,
    valuation,
    detailedRatios,
    industry: {
      id: industryFair.profileId,
      labelVi: industryFair.labelVi,
      fairPe: industryFair.fairPe,
      fairPb: industryFair.fairPb,
      fairEvEbitda: industryFair.fairEvEbitda,
    },
    marketRatios: vndRatios
      ? {
          pe: saneMultiple(vndRatios.pe),
          pb: saneMultiple(vndRatios.pb),
          ps: saneMultiple(vndRatios.ps),
          evEbitda: saneMultiple(vndRatios.evEbitda),
          dividendYield: yieldRatioToPct(vndRatios.dividendYield),
          marketCap: vndRatios.marketCap,
        }
      : null,
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
