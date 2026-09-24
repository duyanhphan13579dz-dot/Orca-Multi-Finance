/**
 * Financial statement forecasting + period-end valuation projection.
 *
 * Methods (research-backed, conservative for VN equities):
 * 1) Revenue / NI: historical CAGR + mean YoY growth, capped; mean-reverting margins
 * 2) Quarterly: last 4 quarters run-rate → next 4 quarters (seasonality light)
 * 3) Yearly: next 2–3 fiscal years from annualized series
 * 4) Valuation projection:
 *    - Forward P/E: FV = EPS_fwd × PE_target
 *    - PEG: PE_target ≈ min(max(g×100, 8), 25) when growth available
 *    - Residual income (light): BVPS + (ROE − r) × BVPS / (r − g)
 *    - Blended fair value for year-end / quarter-end
 */

export type ForecastHorizon = "quarter" | "year";

export interface HistPoint {
  period: string;
  periodType: "quarter" | "year" | "ttm" | string;
  year: number | null;
  quarter: number | null;
  revenue: number | null;
  netIncome: number | null;
  equity: number | null;
  grossMargin?: number | null;
  netMargin?: number | null;
}

export interface ForecastAssumptions {
  revenueGrowthYoy: number;
  netMargin: number;
  peTarget: number;
  costOfEquity: number;
  terminalGrowth: number;
  sharesOutstanding: number | null;
  method: string;
}

export interface ForecastRow {
  label: string;
  horizon: ForecastHorizon;
  year: number;
  quarter: number | null;
  revenue: number | null;
  netIncome: number | null;
  netMargin: number | null;
  eps: number | null;
  fairValue: number | null;
  upsidePct: number | null;
  methods: {
    forwardPe: number | null;
    peg: number | null;
    residualIncome: number | null;
    blended: number | null;
  };
}

export interface FinancialForecastResult {
  symbol: string;
  asOf: string;
  currentPrice: number | null;
  assumptions: ForecastAssumptions;
  historical: {
    periodsUsed: number;
    revenueCagr: number | null;
    niCagr: number | null;
    avgNetMargin: number | null;
    lastRevenue: number | null;
    lastNetIncome: number | null;
    lastEquity: number | null;
    lastEpsTtm: number | null;
  };
  quarterly: ForecastRow[];
  yearly: ForecastRow[];
  notes: string[];
  confidence: "high" | "medium" | "low";
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function cagr(first: number, last: number, intervals: number): number | null {
  if (intervals <= 0 || first <= 0 || last <= 0) return null;
  return Math.pow(last / first, 1 / intervals) - 1;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function yoyGrowths(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev > 0 && cur > 0) out.push(cur / prev - 1);
  }
  return out;
}

function blendGrowth(cagrVal: number | null, meanYoy: number | null): number {
  const parts: number[] = [];
  if (cagrVal != null) parts.push(cagrVal);
  if (meanYoy != null) parts.push(meanYoy);
  if (!parts.length) return 0.06;
  const raw = parts.reduce((a, b) => a + b, 0) / parts.length;
  const blended = raw * 0.7 + 0.06 * 0.3;
  return clamp(blended, -0.25, 0.35);
}

function marginFrom(rev: number | null, ni: number | null): number | null {
  if (!finite(rev) || !finite(ni) || rev <= 0) return null;
  return ni / rev;
}

function targetPe(growth: number, trailingPe: number | null): number {
  const gPct = growth * 100;
  let pegPe = clamp(gPct, 8, 22);
  if (growth < 0.03) pegPe = 10;
  if (growth > 0.2) pegPe = clamp(gPct * 0.9, 12, 25);
  if (trailingPe != null && trailingPe > 0 && trailingPe < 80) {
    return clamp(trailingPe * 0.55 + pegPe * 0.45, 6, 30);
  }
  return pegPe;
}

function residualIncomeFv(
  bvps: number | null,
  roe: number | null,
  r: number,
  g: number,
): number | null {
  if (!finite(bvps) || bvps <= 0) return null;
  if (!finite(roe)) return bvps;
  const excess = roe - r;
  if (r <= g + 0.005) return bvps;
  const ri = (excess * bvps) / (r - g);
  return bvps + ri;
}

function nextQuarter(year: number, quarter: number): { year: number; quarter: number } {
  if (quarter >= 4) return { year: year + 1, quarter: 1 };
  return { year, quarter: quarter + 1 };
}

export function buildFinancialForecast(input: {
  symbol: string;
  history: HistPoint[];
  currentPrice: number | null;
  sharesOutstanding: number | null;
  trailingPe?: number | null;
  costOfEquity?: number;
}): FinancialForecastResult {
  const notes: string[] = [];
  const symbol = input.symbol.toUpperCase();
  const r = input.costOfEquity ?? 0.12;
  const terminalG = 0.03;
  const shares =
    input.sharesOutstanding != null && input.sharesOutstanding > 0
      ? input.sharesOutstanding
      : null;

  const annual = input.history
    .filter((h) => h.periodType === "year" && finite(h.revenue))
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  const quarterly = input.history
    .filter((h) => h.periodType === "quarter" && finite(h.revenue))
    .sort((a, b) => {
      const ya = (a.year ?? 0) * 10 + (a.quarter ?? 0);
      const yb = (b.year ?? 0) * 10 + (b.quarter ?? 0);
      return ya - yb;
    });

  const series = annual.length >= 2 ? annual : quarterly;
  const revSeries = series.map((h) => h.revenue!).filter((v) => v > 0);
  const niSeries = series.map((h) => h.netIncome).filter(finite) as number[];

  const revenueCagr =
    revSeries.length >= 2
      ? cagr(revSeries[0], revSeries[revSeries.length - 1], revSeries.length - 1)
      : null;
  const niCagr =
    niSeries.length >= 2
      ? cagr(
          Math.abs(niSeries[0]) || 1,
          Math.abs(niSeries[niSeries.length - 1]) || 1,
          niSeries.length - 1,
        )
      : null;

  const meanRevYoy = avg(yoyGrowths(revSeries));
  const growth = blendGrowth(revenueCagr, meanRevYoy);

  const margins = series
    .map((h) => marginFrom(h.revenue, h.netIncome))
    .filter(finite) as number[];
  const avgNetMargin = avg(margins);
  const last =
    series[series.length - 1] ??
    quarterly[quarterly.length - 1] ??
    annual[annual.length - 1];
  const lastMargin = last ? marginFrom(last.revenue, last.netIncome) : null;
  const netMargin =
    lastMargin != null && avgNetMargin != null
      ? clamp(lastMargin * 0.6 + avgNetMargin * 0.4, -0.3, 0.45)
      : (lastMargin ?? avgNetMargin ?? 0.1);

  const lastRevenue = last?.revenue ?? null;
  const lastNi = last?.netIncome ?? null;
  const lastEquity =
    [...series].reverse().find((h) => finite(h.equity))?.equity ?? null;

  let ttmNi: number | null = null;
  if (quarterly.length >= 4) {
    const last4 = quarterly.slice(-4);
    if (last4.every((q) => finite(q.netIncome))) {
      ttmNi = last4.reduce((s, q) => s + (q.netIncome as number), 0);
    }
  }
  if (ttmNi == null && annual.length) {
    ttmNi = annual[annual.length - 1].netIncome;
  }

  const lastEpsTtm = shares != null && ttmNi != null ? ttmNi / shares : null;

  const price = input.currentPrice;
  const priceIsThousands = price != null && price > 0 && price < 500;
  const niToEps = (ni: number): number | null => {
    if (shares == null || shares <= 0) return null;
    const raw = ni / shares;
    return priceIsThousands ? raw / 1000 : raw;
  };
  const equityToBvps = (eq: number): number | null => {
    if (shares == null || shares <= 0) return null;
    const raw = eq / shares;
    return priceIsThousands ? raw / 1000 : raw;
  };

  const peTarget = targetPe(growth, input.trailingPe ?? null);
  if (revenueCagr != null) {
    notes.push(
      `CAGR doanh thu lịch sử ${(revenueCagr * 100).toFixed(1)}%/năm (đã blend mean-revert).`,
    );
  }
  notes.push(
    `Tăng trưởng DT dự phóng ${(growth * 100).toFixed(1)}%; biên LNST ${(netMargin * 100).toFixed(1)}%; PE mục tiêu ${peTarget.toFixed(1)}x.`,
  );
  if (!shares)
    notes.push("Thiếu số CP lưu hành — EPS và FV chỉ mang tính tham khảo khi có shares.");
  notes.push(
    "Mô hình đơn giản (historical + mean-reversion), không thay thế phân tích chuyên sâu / DCF đầy đủ.",
  );

  const peFv = (eps: number | null): number | null =>
    eps != null && eps > 0 ? eps * peTarget : null;
  const pegFv = (eps: number | null): number | null => {
    if (eps == null || eps <= 0 || growth <= 0) return null;
    const pegPe = clamp(growth * 100, 8, 25);
    return eps * pegPe;
  };

  function buildValuation(
    eps: number | null,
    equity: number | null,
  ): ForecastRow["methods"] & { blended: number | null } {
    const forwardPe = peFv(eps);
    const peg = pegFv(eps);
    const bvps = equity != null ? equityToBvps(equity) : null;
    const roe =
      equity != null && equity > 0 && ttmNi != null ? ttmNi / equity : null;
    const ri = residualIncomeFv(bvps, roe, r, terminalG);
    const parts = [forwardPe, peg, ri].filter(finite) as number[];
    const blended = parts.length
      ? parts.reduce((a, b) => a + b, 0) / parts.length
      : null;
    return { forwardPe, peg, residualIncome: ri, blended };
  }

  const qGrowth = Math.pow(1 + growth, 0.25) - 1;
  let qRev = quarterly.length
    ? quarterly[quarterly.length - 1].revenue!
    : lastRevenue != null
      ? lastRevenue / 4
      : null;
  let qYear = quarterly.length
    ? (quarterly[quarterly.length - 1].year ?? new Date().getFullYear())
    : new Date().getFullYear();
  let qQ = quarterly.length
    ? (quarterly[quarterly.length - 1].quarter ?? 4)
    : 4;
  let qEquity = lastEquity;

  const quarterlyRows: ForecastRow[] = [];
  if (qRev != null) {
    for (let i = 0; i < 4; i++) {
      const nq = nextQuarter(qYear, qQ);
      qYear = nq.year;
      qQ = nq.quarter;
      qRev = qRev * (1 + qGrowth);
      const qNi = qRev * netMargin;
      if (qEquity != null && qNi > 0) qEquity = qEquity + qNi * 0.5;
      const eps = niToEps(qNi);
      const methods = buildValuation(eps, qEquity);
      const fair = methods.blended;
      quarterlyRows.push({
        label: `Q${qQ}/${qYear}`,
        horizon: "quarter",
        year: qYear,
        quarter: qQ,
        revenue: qRev,
        netIncome: qNi,
        netMargin,
        eps,
        fairValue: fair,
        upsidePct:
          fair != null && price != null && price > 0
            ? (fair / price - 1) * 100
            : null,
        methods,
      });
    }
  } else {
    notes.push("Không đủ chuỗi doanh thu quý/năm để dự phóng quý.");
  }

  let yRev =
    annual.length && finite(annual[annual.length - 1].revenue)
      ? annual[annual.length - 1].revenue!
      : lastRevenue != null && last?.periodType === "quarter"
        ? lastRevenue * 4
        : lastRevenue;
  let yYear = annual.length
    ? (annual[annual.length - 1].year ?? new Date().getFullYear()) + 1
    : new Date().getFullYear() + 1;
  let yEquity = lastEquity;

  const yearlyRows: ForecastRow[] = [];
  if (yRev != null) {
    for (let i = 0; i < 3; i++) {
      yRev = yRev * (1 + growth);
      const yNi = yRev * netMargin;
      if (yEquity != null && yNi > 0) yEquity = yEquity + yNi * 0.5;
      const eps = niToEps(yNi);
      const methods = buildValuation(eps, yEquity);
      const fair = methods.blended;
      yearlyRows.push({
        label: `Năm ${yYear}`,
        horizon: "year",
        year: yYear,
        quarter: null,
        revenue: yRev,
        netIncome: yNi,
        netMargin,
        eps,
        fairValue: fair,
        upsidePct:
          fair != null && price != null && price > 0
            ? (fair / price - 1) * 100
            : null,
        methods,
      });
      yYear += 1;
    }
  } else {
    notes.push("Không đủ doanh thu để dự phóng năm.");
  }

  let confidence: FinancialForecastResult["confidence"] = "low";
  if (series.length >= 4 && shares) confidence = "high";
  else if (series.length >= 2) confidence = "medium";

  return {
    symbol,
    asOf: new Date().toISOString(),
    currentPrice: price,
    assumptions: {
      revenueGrowthYoy: growth,
      netMargin,
      peTarget,
      costOfEquity: r,
      terminalGrowth: terminalG,
      sharesOutstanding: shares,
      method: "hist-cagr+mean-reversion+forwardPE/PEG/RI",
    },
    historical: {
      periodsUsed: series.length,
      revenueCagr,
      niCagr,
      avgNetMargin,
      lastRevenue,
      lastNetIncome: lastNi,
      lastEquity,
      lastEpsTtm,
    },
    quarterly: quarterlyRows,
    yearly: yearlyRows,
    notes,
    confidence,
  };
}
