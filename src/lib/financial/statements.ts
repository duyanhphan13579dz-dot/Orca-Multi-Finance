import "server-only";
import type { NormalizedMetrics, NormalizedPeriod } from "./types";
import {
  BALANCE_METRIC_ORDER,
  CASHFLOW_METRIC_ORDER,
  INCOME_METRIC_ORDER,
  labelForMetric,
  orderedKeysForProfile,
  type MetricKey,
  type MetricProfile,
} from "./metric-dictionary";

/**
 * Phase 3 — Statement normalizers + bank/non-bank label sets.
 */

export function normalizeIncomeMetrics(m: NormalizedMetrics): NormalizedMetrics {
  const out: NormalizedMetrics = { ...m };
  if (out.netRevenue == null && out.revenue != null) out.netRevenue = out.revenue;
  if (out.revenue == null && out.netRevenue != null) out.revenue = out.netRevenue;
  if (out.grossProfit == null && out.netRevenue != null && out.cogs != null) {
    out.grossProfit = out.netRevenue - out.cogs;
  }
  if (out.ebit == null && out.operatingProfit != null) out.ebit = out.operatingProfit;
  if (out.operatingProfit == null && out.ebit != null) out.operatingProfit = out.ebit;
  if (out.netIncome == null && out.netIncomeParent != null) out.netIncome = out.netIncomeParent;
  if (out.netIncomeParent == null && out.netIncome != null) out.netIncomeParent = out.netIncome;
  return out;
}

export function normalizeBalanceMetrics(m: NormalizedMetrics): NormalizedMetrics {
  const out: NormalizedMetrics = { ...m };
  if (out.totalAssets == null && out.currentAssets != null && out.longTermAssets != null) {
    out.totalAssets = out.currentAssets + out.longTermAssets;
  }
  if (out.equity == null && out.totalAssets != null && out.totalLiabilities != null) {
    out.equity = out.totalAssets - out.totalLiabilities;
  }
  return out;
}

export function normalizeCashflowMetrics(m: NormalizedMetrics): NormalizedMetrics {
  const out: NormalizedMetrics = { ...m };
  if (out.freeCashFlow == null && out.operatingCashFlow != null) {
    const cap = out.capex != null ? Math.abs(out.capex) : 0;
    out.freeCashFlow = out.operatingCashFlow - cap;
  }
  return out;
}

export function normalizePeriodMetrics(metrics: NormalizedMetrics): NormalizedMetrics {
  let m = normalizeIncomeMetrics(metrics);
  m = normalizeBalanceMetrics(m);
  m = normalizeCashflowMetrics(m);
  return m;
}

export function normalizePeriods(periods: NormalizedPeriod[]): NormalizedPeriod[] {
  return periods.map((p) => ({
    ...p,
    metrics: normalizePeriodMetrics(p.metrics),
  }));
}

function labeledMap(
  keys: MetricKey[],
  profile: MetricProfile,
): { metricLabelsVi: Record<string, string>; metricLabelsEn: Record<string, string>; metricProfile: MetricProfile } {
  const labels: Record<string, string> = {};
  const labelsEn: Record<string, string> = {};
  for (const k of keys) {
    labels[k] = labelForMetric(k, "vi", profile);
    labelsEn[k] = labelForMetric(k, "en", profile);
  }
  return { metricLabelsVi: labels, metricLabelsEn: labelsEn, metricProfile: profile };
}

/** Split normalized periods into classic statement row arrays (legacy UI/API). */
export function periodsToStatementTables(
  periods: NormalizedPeriod[],
  profile: MetricProfile = "nonbank",
): {
  income: Record<string, unknown>[];
  balance: Record<string, unknown>[];
  cashflow: Record<string, unknown>[];
  ratios: Record<string, unknown>[];
} {
  const income: Record<string, unknown>[] = [];
  const balance: Record<string, unknown>[] = [];
  const cashflow: Record<string, unknown>[] = [];
  const ratios: Record<string, unknown>[] = [];

  const incomeKeys = orderedKeysForProfile("income", profile);
  const balanceKeys = orderedKeysForProfile("balance", profile);
  const cfKeys = orderedKeysForProfile("cashflow", profile);

  for (const p of periods) {
    if (p.periodType === "ttm") continue;
    const m = p.metrics;
    const base = {
      period: p.period,
      year: p.year,
      quarter: p.quarter,
      fiscalDate: p.fiscalDate,
      source: p.source,
      periodType: p.periodType,
      metricProfile: profile,
    };

    const rev = m.netRevenue ?? m.revenue ?? null;
    const ni = m.netIncome ?? m.netIncomeParent ?? null;
    const gp = m.grossProfit ?? null;
    const op = m.operatingProfit ?? m.ebit ?? null;

    income.push({
      ...base,
      ...labeledMap(incomeKeys.length ? incomeKeys : INCOME_METRIC_ORDER, profile),
      revenue: m.revenue ?? rev,
      netRevenue: m.netRevenue ?? rev,
      cogs: m.cogs ?? null,
      grossProfit: gp,
      operatingProfit: op,
      ebit: m.ebit ?? op,
      ebitda: m.ebitda ?? null,
      interestExpense: m.interestExpense ?? null,
      profitBeforeTax: m.profitBeforeTax ?? null,
      taxExpense: m.taxExpense ?? null,
      netProfit: ni,
      netIncome: ni,
      netIncomeParent: m.netIncomeParent ?? ni,
    });

    balance.push({
      ...base,
      ...labeledMap(balanceKeys.length ? balanceKeys : BALANCE_METRIC_ORDER, profile),
      cash: m.cash ?? null,
      shortTermInvestments: m.shortTermInvestments ?? null,
      receivables: m.receivables ?? null,
      inventory: profile === "bank" ? null : m.inventory ?? null,
      currentAssets: m.currentAssets ?? null,
      fixedAssets: m.fixedAssets ?? null,
      longTermAssets: m.longTermAssets ?? null,
      totalAssets: m.totalAssets ?? null,
      shortTermDebt: m.shortTermDebt ?? null,
      longTermDebt: m.longTermDebt ?? null,
      currentLiabilities: m.currentLiabilities ?? null,
      totalLiabilities: m.totalLiabilities ?? null,
      equity: m.equity ?? null,
      retainedEarnings: m.retainedEarnings ?? null,
    });

    cashflow.push({
      ...base,
      ...labeledMap(cfKeys.length ? cfKeys : CASHFLOW_METRIC_ORDER, profile),
      operatingCashFlow: m.operatingCashFlow ?? null,
      investingCashFlow: m.investingCashFlow ?? null,
      financingCashFlow: m.financingCashFlow ?? null,
      capex: m.capex ?? null,
      freeCashFlow: m.freeCashFlow ?? null,
      cashBegin: m.cashBegin ?? null,
      cashEnd: m.cashEnd ?? null,
    });

    ratios.push({
      ...base,
      grossMargin: rev && gp != null ? gp / rev : null,
      operatingMargin: rev && op != null ? op / rev : null,
      netMargin: rev && ni != null ? ni / rev : null,
      roe: m.equity && ni != null && m.equity !== 0 ? ni / m.equity : null,
      roa: m.totalAssets && ni != null && m.totalAssets !== 0 ? ni / m.totalAssets : null,
      debtToEquity:
        m.equity && m.totalLiabilities != null && m.equity !== 0
          ? m.totalLiabilities / m.equity
          : null,
      currentRatio:
        profile === "bank"
          ? null
          : m.currentLiabilities && m.currentAssets != null && m.currentLiabilities !== 0
            ? m.currentAssets / m.currentLiabilities
            : null,
      ocfToNi: ni && m.operatingCashFlow != null && ni !== 0 ? m.operatingCashFlow / ni : null,
    });
  }

  return { income, balance, cashflow, ratios };
}
