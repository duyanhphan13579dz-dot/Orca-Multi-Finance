/**
 * Detailed financial ratio engine — VN BCTC (NormalizedMetrics) + live quote.
 * Null-safe: missing inputs → null (UI: "Không đủ dữ liệu").
 * Units: BCTC = VND full; HOSE quote often nghìn đồng (price < 500 → ×1000).
 */
import type { NormalizedMetrics, NormalizedPeriod } from "./types";

export type RatioFormat = "pct" | "x" | "num" | "money" | "days";
export type RatioBand = "safe" | "ok" | "risk" | "na";

export interface RatioItem {
  key: string;
  labelVi: string;
  labelEn: string;
  value: number | null;
  format: RatioFormat;
  category: RatioCategory;
  band?: RatioBand;
  bandLabel?: string;
  formula?: string;
  note?: string;
}

export type RatioCategory =
  | "liquidity"
  | "leverage"
  | "profitability"
  | "efficiency"
  | "valuation"
  | "cash"
  | "dupont"
  | "perShare";

export interface RatioEngineInput {
  metrics: NormalizedMetrics | null;
  prior?: NormalizedMetrics | null;
  priceQuote: number | null;
  sharesOutstanding: number | null;
  marketMultiples?: {
    pe?: number | null;
    pb?: number | null;
    ps?: number | null;
    evEbitda?: number | null;
    dividendYield?: number | null;
    marketCap?: number | null;
  } | null;
  periodLabel?: string | null;
}

export interface RatioEngineResult {
  period: string | null;
  priceVnd: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  categories: Record<RatioCategory, RatioItem[]>;
  flat: RatioItem[];
  quality: { filled: number; total: number; score: number };
}

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function div(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function priceToVnd(price: number | null): number | null {
  if (price == null || !(price > 0)) return null;
  if (price < 500) return price * 1000;
  return price;
}

function bandCr(v: number | null): { band: RatioBand; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 1) return { band: "risk", label: "Thấp" };
  if (v < 1.5) return { band: "ok", label: "Chấp nhận" };
  return { band: "safe", label: "An toàn" };
}

function bandDe(v: number | null): { band: RatioBand; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 1) return { band: "safe", label: "An toàn" };
  if (v <= 2) return { band: "ok", label: "Chấp nhận" };
  return { band: "risk", label: "Rủi ro cao" };
}

function bandIc(v: number | null): { band: RatioBand; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 1.5) return { band: "risk", label: "Rủi ro" };
  if (v <= 3) return { band: "ok", label: "Chấp nhận" };
  return { band: "safe", label: "An toàn" };
}

function bandRoe(v: number | null): { band: RatioBand; label: string } {
  if (v == null) return { band: "na", label: "Không đủ dữ liệu" };
  if (v < 0.08) return { band: "risk", label: "Yếu" };
  if (v < 0.15) return { band: "ok", label: "Trung bình" };
  return { band: "safe", label: "Tốt" };
}

function item(
  key: string,
  labelVi: string,
  labelEn: string,
  value: number | null,
  format: RatioFormat,
  category: RatioCategory,
  extra?: Partial<RatioItem>,
): RatioItem {
  return { key, labelVi, labelEn, value, format, category, ...extra };
}

function saneMult(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (v > 500) return null;
  return v;
}

function saneYield(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v > 1 && v <= 80) return v / 100;
  if (v >= 0 && v <= 1) return v;
  return null;
}

export function computeDetailedRatios(input: RatioEngineInput): RatioEngineResult {
  const m = input.metrics ?? {};
  const prior = input.prior ?? null;
  const priceVnd = priceToVnd(input.priceQuote);
  const shares = input.sharesOutstanding;

  const revenue = n(m.netRevenue) ?? n(m.revenue);
  const cogs = n(m.cogs);
  const grossProfit =
    n(m.grossProfit) ?? (revenue != null && cogs != null ? revenue - cogs : null);
  const ebit = n(m.ebit) ?? n(m.operatingProfit);
  const ebitda = n(m.ebitda) ?? (ebit != null ? ebit * 1.12 : null);
  const ni = n(m.netIncome) ?? n(m.netIncomeParent);
  const interest = n(m.interestExpense) ?? n(m.financeExpense);

  const assets = n(m.totalAssets);
  const equity = n(m.equity);
  const cash = n(m.cash);
  const sti = n(m.shortTermInvestments);
  const receivables = n(m.receivables);
  const inventory = n(m.inventory);
  const currentAssets = n(m.currentAssets);
  const currentLiab = n(m.currentLiabilities);
  const std = n(m.shortTermDebt);
  const ltd = n(m.longTermDebt);
  const totalLiab = n(m.totalLiabilities);
  const totalDebt =
    std != null || ltd != null ? (std ?? 0) + (ltd ?? 0) : totalLiab != null ? totalLiab : null;
  const payables = n(m.payables) ?? n(m.accountsPayable);

  const ocf = n(m.operatingCashFlow);
  const capexRaw = n(m.capex);
  const capex = capexRaw != null ? Math.abs(capexRaw) : null;
  const fcf = n(m.freeCashFlow) ?? (ocf != null && capex != null ? ocf - capex : null);

  const mkt = input.marketMultiples;
  const marketCap =
    mkt?.marketCap != null && mkt.marketCap > 0
      ? mkt.marketCap
      : priceVnd != null && shares != null && shares > 0
        ? priceVnd * shares
        : null;
  const netDebt = totalDebt != null ? totalDebt - (cash ?? 0) - (sti ?? 0) : null;
  const enterpriseValue = marketCap != null ? marketCap + (netDebt ?? 0) : null;

  const currentRatio = div(currentAssets, currentLiab);
  const quickAssets =
    currentAssets != null && inventory != null
      ? currentAssets - inventory
      : cash != null || receivables != null
        ? (cash ?? 0) + (receivables ?? 0)
        : null;
  const quickRatio = div(quickAssets, currentLiab);
  const cashRatio = div(
    cash != null || sti != null ? (cash ?? 0) + (sti ?? 0) : null,
    currentLiab,
  );
  const crB = bandCr(currentRatio);
  const qrB = bandCr(quickRatio);

  const debtEquity = div(totalDebt, equity);
  const debtAssets = div(totalDebt, assets);
  const equityRatio = div(equity, assets);
  const netDebtEquity = div(netDebt, equity);
  const debtEbitda = div(totalDebt, ebitda);
  const netDebtEbitda = div(netDebt, ebitda);
  const interestCover = div(ebit, interest != null ? Math.abs(interest) : null);
  const deB = bandDe(debtEquity);
  const icB = bandIc(interestCover);

  const grossMargin = div(grossProfit, revenue);
  const ebitMargin = div(ebit, revenue);
  const ebitdaMargin = div(ebitda, revenue);
  const netMargin = div(ni, revenue);
  const roe = div(ni, equity);
  const roa = div(ni, assets);
  const nopat = ebit != null ? ebit * 0.8 : null;
  const investedCapital =
    equity != null || totalDebt != null
      ? (equity ?? 0) + (totalDebt ?? 0) - (cash ?? 0)
      : null;
  const roic = div(nopat, investedCapital != null && investedCapital > 0 ? investedCapital : null);
  const roeB = bandRoe(roe);

  const priorRev = prior ? n(prior.netRevenue) ?? n(prior.revenue) : null;
  const priorNi = prior ? n(prior.netIncome) ?? n(prior.netIncomeParent) : null;
  const revGrowth =
    priorRev != null && priorRev !== 0 && revenue != null
      ? (revenue - priorRev) / Math.abs(priorRev)
      : null;
  const niGrowth =
    priorNi != null && priorNi !== 0 && ni != null ? (ni - priorNi) / Math.abs(priorNi) : null;

  const assetTurnover = div(revenue, assets);
  const equityTurnover = div(revenue, equity);
  const invTurnover = div(cogs ?? revenue, inventory);
  const recvTurnover = div(revenue, receivables);
  const payTurnover = div(cogs ?? revenue, payables);
  const dio = invTurnover != null && invTurnover > 0 ? 365 / invTurnover : null;
  const dso = recvTurnover != null && recvTurnover > 0 ? 365 / recvTurnover : null;
  const dpo = payTurnover != null && payTurnover > 0 ? 365 / payTurnover : null;
  const ccc = dio != null || dso != null ? (dio ?? 0) + (dso ?? 0) - (dpo ?? 0) : null;

  const epsVnd = div(ni, shares);
  const bvpsVnd = div(equity, shares);
  const spsVnd = div(revenue, shares);
  const fcpsVnd = div(fcf, shares);

  const pe =
    saneMult(mkt?.pe) ??
    (priceVnd != null && epsVnd != null && epsVnd > 0 ? priceVnd / epsVnd : null);
  const pb =
    saneMult(mkt?.pb) ??
    (priceVnd != null && bvpsVnd != null && bvpsVnd > 0 ? priceVnd / bvpsVnd : null);
  const ps =
    saneMult(mkt?.ps) ??
    (marketCap != null && revenue != null && revenue > 0 ? marketCap / revenue : null);
  const pfcf = marketCap != null && fcf != null && fcf > 0 ? marketCap / fcf : null;
  const pocf = marketCap != null && ocf != null && ocf > 0 ? marketCap / ocf : null;
  const evEbitda =
    saneMult(mkt?.evEbitda) ??
    (enterpriseValue != null && ebitda != null && ebitda > 0 ? enterpriseValue / ebitda : null);
  const evEbit =
    enterpriseValue != null && ebit != null && ebit > 0 ? enterpriseValue / ebit : null;
  const evSales =
    enterpriseValue != null && revenue != null && revenue > 0 ? enterpriseValue / revenue : null;
  const earningsYield = pe != null && pe > 0 ? 1 / pe : null;
  const fcfYield = marketCap != null && fcf != null && marketCap > 0 ? fcf / marketCap : null;
  const divYield = saneYield(mkt?.dividendYield);
  const peg = pe != null && niGrowth != null && niGrowth > 0.01 ? pe / (niGrowth * 100) : null;

  const ocfNi = div(ocf, ni);
  const fcfEbit = div(fcf, ebit);
  const fcfConversion = div(fcf, ni);

  const taxBurden = ebit != null && ni != null && ebit !== 0 ? ni / ebit : null;
  const interestBurden =
    ebit != null && n(m.ebt) != null && ebit !== 0
      ? (n(m.ebt) as number) / ebit
      : ebit != null && interest != null
        ? (ebit - Math.abs(interest)) / ebit
        : null;
  const dupontRoe =
    netMargin != null && assetTurnover != null && equity != null && assets != null && equity !== 0
      ? netMargin * assetTurnover * (assets / equity)
      : null;

  const liquidity = [
    item("currentRatio", "Hệ số thanh toán hiện hành", "Current Ratio", currentRatio, "x", "liquidity", {
      band: crB.band,
      bandLabel: crB.label,
      formula: "Tài sản ngắn hạn / Nợ ngắn hạn",
    }),
    item("quickRatio", "Hệ số thanh toán nhanh", "Quick Ratio", quickRatio, "x", "liquidity", {
      band: qrB.band,
      bandLabel: qrB.label,
      formula: "(TSNH − Hàng tồn kho) / Nợ ngắn hạn",
    }),
    item("cashRatio", "Hệ số thanh toán tiền mặt", "Cash Ratio", cashRatio, "x", "liquidity", {
      formula: "(Tiền + Đầu tư NH) / Nợ ngắn hạn",
    }),
  ];

  const leverage = [
    item("debtEquity", "Nợ / Vốn chủ sở hữu", "Debt/Equity", debtEquity, "x", "leverage", {
      band: deB.band,
      bandLabel: deB.label,
      formula: "Tổng nợ vay / VCSH",
    }),
    item("netDebtEquity", "Nợ ròng / VCSH", "Net Debt/Equity", netDebtEquity, "x", "leverage"),
    item("debtAssets", "Nợ / Tổng tài sản", "Debt/Assets", debtAssets, "x", "leverage"),
    item("equityRatio", "Tỷ lệ VCSH", "Equity Ratio", equityRatio, "pct", "leverage"),
    item("debtEbitda", "Nợ / EBITDA", "Debt/EBITDA", debtEbitda, "x", "leverage"),
    item("netDebtEbitda", "Nợ ròng / EBITDA", "Net Debt/EBITDA", netDebtEbitda, "x", "leverage"),
    item("interestCover", "Khả năng thanh toán lãi", "Interest Coverage", interestCover, "x", "leverage", {
      band: icB.band,
      bandLabel: icB.label,
      formula: "EBIT / Chi phí lãi vay",
    }),
  ];

  const profitability = [
    item("grossMargin", "Biên LN gộp", "Gross Margin", grossMargin, "pct", "profitability"),
    item("ebitMargin", "Biên EBIT", "EBIT Margin", ebitMargin, "pct", "profitability"),
    item("ebitdaMargin", "Biên EBITDA", "EBITDA Margin", ebitdaMargin, "pct", "profitability"),
    item("netMargin", "Biên LN ròng", "Net Margin", netMargin, "pct", "profitability"),
    item("roe", "ROE", "ROE", roe, "pct", "profitability", {
      band: roeB.band,
      bandLabel: roeB.label,
      formula: "LNST / VCSH",
    }),
    item("roa", "ROA", "ROA", roa, "pct", "profitability", { formula: "LNST / Tổng tài sản" }),
    item("roic", "ROIC (ước tính)", "ROIC", roic, "pct", "profitability", {
      note: "NOPAT≈EBIT×(1−20%)",
      formula: "NOPAT / Vốn đầu tư",
    }),
    item("revGrowth", "Tăng trưởng DT YoY", "Revenue Growth YoY", revGrowth, "pct", "profitability"),
    item("niGrowth", "Tăng trưởng LNST YoY", "NI Growth YoY", niGrowth, "pct", "profitability"),
  ];

  const efficiency = [
    item("assetTurnover", "Vòng quay tài sản", "Asset Turnover", assetTurnover, "x", "efficiency"),
    item("equityTurnover", "Vòng quay VCSH", "Equity Turnover", equityTurnover, "x", "efficiency"),
    item("invTurnover", "Vòng quay tồn kho", "Inventory Turnover", invTurnover, "x", "efficiency"),
    item("recvTurnover", "Vòng quay phải thu", "Receivables Turnover", recvTurnover, "x", "efficiency"),
    item("dio", "Số ngày tồn kho (DIO)", "Days Inventory", dio, "days", "efficiency"),
    item("dso", "Số ngày phải thu (DSO)", "Days Sales Outstanding", dso, "days", "efficiency"),
    item("dpo", "Số ngày phải trả (DPO)", "Days Payable", dpo, "days", "efficiency"),
    item("ccc", "Chu kỳ chuyển đổi tiền (CCC)", "Cash Conversion Cycle", ccc, "days", "efficiency", {
      formula: "DIO + DSO − DPO",
    }),
  ];

  const valuation = [
    item("pe", "P/E", "P/E", pe, "x", "valuation", { formula: "Giá / EPS" }),
    item("pb", "P/B", "P/B", pb, "x", "valuation", { formula: "Giá / BVPS" }),
    item("ps", "P/S", "P/S", ps, "x", "valuation"),
    item("pfcf", "P/FCF", "P/FCF", pfcf, "x", "valuation"),
    item("pocf", "P/OCF", "P/OCF", pocf, "x", "valuation"),
    item("evEbitda", "EV/EBITDA", "EV/EBITDA", evEbitda, "x", "valuation"),
    item("evEbit", "EV/EBIT", "EV/EBIT", evEbit, "x", "valuation"),
    item("evSales", "EV/Sales", "EV/Sales", evSales, "x", "valuation"),
    item("peg", "PEG", "PEG", peg, "x", "valuation", {
      note: niGrowth != null ? "P/E ÷ (NI growth %)" : "Cần tăng trưởng LNST > 0",
    }),
    item("earningsYield", "Earnings Yield", "Earnings Yield", earningsYield, "pct", "valuation"),
    item("fcfYield", "FCF Yield", "FCF Yield", fcfYield, "pct", "valuation"),
    item("divYield", "Tỷ suất cổ tức", "Dividend Yield", divYield, "pct", "valuation"),
  ];

  const cash = [
    item("ocf", "CFO (HĐKD)", "Operating CF", ocf, "money", "cash"),
    item("fcf", "FCF", "Free Cash Flow", fcf, "money", "cash", { formula: "CFO − |Capex|" }),
    item("capex", "Capex", "Capex", capex != null ? -Math.abs(capex) : null, "money", "cash"),
    item("ocfNi", "CFO / LNST", "CFO/NI", ocfNi, "x", "cash"),
    item("fcfConversion", "FCF / LNST", "FCF/NI", fcfConversion, "x", "cash"),
    item("fcfEbit", "FCF / EBIT", "FCF/EBIT", fcfEbit, "x", "cash"),
  ];

  const dupont = [
    item("dupontMargin", "DuPont · Biên LN", "DuPont Net Margin", netMargin, "pct", "dupont"),
    item("dupontTurnover", "DuPont · Vòng quay TS", "DuPont Asset Turnover", assetTurnover, "x", "dupont"),
    item("dupontLeverage", "DuPont · Đòn bẩy TS/VCSH", "DuPont Equity Multiplier", div(assets, equity), "x", "dupont"),
    item("dupontRoe", "DuPont · ROE tổng hợp", "DuPont ROE", dupontRoe, "pct", "dupont", {
      formula: "Biên LN × Vòng quay TS × (TS/VCSH)",
    }),
    item("taxBurden", "Gánh nặng thuế", "Tax Burden", taxBurden, "x", "dupont"),
    item("interestBurden", "Gánh nặng lãi vay", "Interest Burden", interestBurden, "x", "dupont"),
  ];

  const perShare = [
    item("eps", "EPS (VND)", "EPS", epsVnd, "money", "perShare"),
    item("bvps", "Giá trị sổ sách / CP", "BVPS", bvpsVnd, "money", "perShare"),
    item("sps", "Doanh thu / CP", "Sales/Share", spsVnd, "money", "perShare"),
    item("fcps", "FCF / CP", "FCF/Share", fcpsVnd, "money", "perShare"),
    item("price", "Giá thị trường (VND)", "Price", priceVnd, "money", "perShare"),
    item("mcap", "Vốn hóa", "Market Cap", marketCap, "money", "perShare"),
    item("ev", "Enterprise Value", "EV", enterpriseValue, "money", "perShare"),
  ];

  const categories = {
    liquidity,
    leverage,
    profitability,
    efficiency,
    valuation,
    cash,
    dupont,
    perShare,
  };

  const flat = Object.values(categories).flat();
  const filled = flat.filter((r) => r.value != null && Number.isFinite(r.value)).length;
  const total = flat.length;

  return {
    period: input.periodLabel ?? null,
    priceVnd,
    marketCap,
    enterpriseValue,
    categories,
    flat,
    quality: { filled, total, score: total ? Math.round((filled / total) * 100) : 0 },
  };
}

export function pickMetricsFromPeriods(periods: NormalizedPeriod[]): {
  metrics: NormalizedMetrics | null;
  prior: NormalizedMetrics | null;
  label: string | null;
} {
  if (!periods?.length) return { metrics: null, prior: null, label: null };
  const ttm = periods.find((p) => p.periodType === "ttm");
  const nonTtm = periods.filter((p) => p.periodType !== "ttm");
  const head = ttm ?? nonTtm[0] ?? periods[0];
  const prior =
    nonTtm.length >= 2
      ? nonTtm[ttm ? 0 : 1]?.metrics ?? null
      : nonTtm.length >= 1 && ttm
        ? nonTtm[0]?.metrics ?? null
        : null;
  return {
    metrics: head?.metrics ?? null,
    prior,
    label: head?.period ?? null,
  };
}
