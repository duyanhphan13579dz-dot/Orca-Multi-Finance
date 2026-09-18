import "server-only";
import { buildMeta, worstFreshness } from "../freshness";
import { buildStockAnalysis } from "./intelligence";
import { getVnQuotes, getVnOhlcv } from "./stocks";
import { fetchVndDchartHistory } from "../providers/vndirect-dchart";
import { fetchVndirectFinancials, periodsToLegacyRows } from "../financial/vndirect-fs";
import {
  getVndCompanyProfile,
  getVndEquitySnapshot,
  getVndValuationRatios,
  getVndShareholders,
} from "../providers/vndirect-company";
import { computeFinancialHealth } from "../engines/fundamental";
import { analyzeSeries } from "../technical";
import { computeInvestmentPerformance } from "../financial/investment-performance";
import { buildDeterministicResearch } from "./company-research";
import { getOrGenerateCompanyIntelligence, resolveValueChain } from "./company-intelligence";
import { getNews } from "./news";
import type { FreshnessStatus, Meta, OhlcvBar } from "../types";

export type ChartPoint = { t: number; c: number };

export type CompanyAnalysisReport = {
  symbol: string;
  title: string;
  generatedAt: string;
  companyName: string | null;
  floor: string | null;
  companyLogo: string | null;
  sections: {
    intro: string[];
    moat: string[];
    industry: string[];
    valueChain: { input: string[]; process: string[]; output: string[] } | null;
    businessResults: string[];
    businessTable: {
      metric: string;
      current: string;
      prior: string;
      change: string;
    }[];
    businessTableMeta: {
      periodCurrent: string;
      periodPrior: string;
      compareMode: "QoQ" | "YoY" | "period";
    } | null;
    technical: string[];
    priceSeries: ChartPoint[];
    valuation: string[];
    projection: string[];
    catalysts: string[];
    risks: string[];
    vsIndustry: string[];
    macro: string[];
    overall: string[];
  };
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
};

function fmt(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN", { maximumFractionDigits: d });
}
function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}
function fmtTy(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)} nghìn tỷ`;
  return `${(v / 1e9).toFixed(1)} tỷ`;
}
function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function loadBars(symbol: string): Promise<OhlcvBar[]> {
  try {
    const o = await getVnOhlcv(symbol, 280);
    if (o?.bars?.length) return o.bars;
  } catch {
    /* */
  }
  try {
    return (await fetchVndDchartHistory(symbol, "D", 280)) ?? [];
  } catch {
    return [];
  }
}

type VC = { input: string[]; process: string[]; output: string[] };

function pickVc(
  v: { input?: string[]; process?: string[]; output?: string[] } | null | undefined,
): VC | null {
  if (!v) return null;
  return {
    input: Array.isArray(v.input) ? v.input : [],
    process: Array.isArray(v.process) ? v.process : [],
    output: Array.isArray(v.output) ? v.output : [],
  };
}

export async function generateCompanyAnalysisReport(
  symbol: string,
): Promise<{ report: CompanyAnalysisReport; meta: Meta } | null> {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(sym)) return null;

  const freshnesses: FreshnessStatus[] = [];

  const [analysis, quotePack, bars, fs, ratios, equity, profile, shareholders, intel, news, idxBars, foreignPack, indicesPack] =
    await Promise.all([
      buildStockAnalysis(sym).catch(() => null),
      getVnQuotes([sym]).catch(() => null),
      loadBars(sym),
      fetchVndirectFinancials(sym, { limitPeriods: 12 }).catch(() => null),
      getVndValuationRatios(sym).catch(() => null),
      getVndEquitySnapshot(sym).catch(() => null),
      getVndCompanyProfile(sym).catch(() => null),
      getVndShareholders(sym).catch(() => []),
      getOrGenerateCompanyIntelligence(sym).catch(() => null),
      getNews({ symbol: sym, limit: 8 }).catch(() => null),
      fetchVndDchartHistory("VNINDEX", "D", 280).catch(() => [] as OhlcvBar[]),
      import("../providers/vndirect").then((m) => m.getVndForeignFlow().catch(() => null)).catch(() => null),
      import("../providers/vndirect").then((m) => m.getVndIndices().catch(() => null)).catch(() => null),
    ]);

  if (analysis?.meta?.freshness) freshnesses.push(analysis.meta.freshness);
  if (quotePack?.meta?.freshness) freshnesses.push(quotePack.meta.freshness);

  const quote = analysis?.detail?.quote ?? quotePack?.quotes?.[0] ?? null;
  const name = profile?.vnName ?? profile?.enName ?? analysis?.detail?.name ?? quote?.name ?? null;
  const floor = profile?.floor ?? null;

  let income: Record<string, unknown>[] = [];
  let balance: Record<string, unknown>[] = [];
  let cashflow: Record<string, unknown>[] = [];
  if (fs?.periods?.length) {
    const rows = periodsToLegacyRows(fs.periods, sym);
    income = rows.income as Record<string, unknown>[];
    balance = rows.balance as Record<string, unknown>[];
    cashflow = rows.cashflow as Record<string, unknown>[];
  } else if (analysis?.detail?.financials) {
    income = (analysis.detail.financials.income as Record<string, unknown>[]) ?? [];
    balance = (analysis.detail.financials.balance as Record<string, unknown>[]) ?? [];
    cashflow = (analysis.detail.financials.cashflow as Record<string, unknown>[]) ?? [];
  }

  let health = analysis?.detail?.financialHealth ?? null;
  if (!health && income.length) {
    try {
      health = computeFinancialHealth({ income, balance, cashflow }, { symbol: sym });
    } catch {
      /* */
    }
  }

  const research = buildDeterministicResearch({
    symbol: sym,
    profile,
    shareholders: shareholders ?? [],
    income,
    balance,
    cashflow,
  });

  const industryHint =
    profile?.vnSummary?.slice(0, 80) ?? (floor ? `Niêm yết ${floor}` : null);

  const valueChain: VC | null =
    pickVc(research?.valueChain) ??
    pickVc(intel?.valueChain) ??
    pickVc(resolveValueChain(industryHint));

  let technical = analysis?.detail?.technical ?? null;
  if (!technical && bars.length >= 20) {
    try {
      technical = analyzeSeries(bars);
    } catch {
      /* */
    }
  }

  const closes = bars.map((b) => Number(b.close)).filter((c) => Number.isFinite(c) && c > 0);
  const indexCloses = (idxBars ?? []).map((b) => Number(b.close)).filter((c) => c > 0);
  const price = quote?.price ?? closes.at(-1) ?? null;
  const shares = equity?.sharesOutstanding ?? health?.anchors?.shares ?? null;

  const i0 = income[0] ?? {};
  const i1 = income[1] ?? {};
  const rev = n(i0.netRevenue) ?? n(i0.revenue);
  const revPrev = n(i1.netRevenue) ?? n(i1.revenue);
  const ni = n(i0.netIncome) ?? n(i0.netProfit) ?? n(i0.netIncomeParent);
  const niPrev = n(i1.netIncome) ?? n(i1.netProfit);
  const revYoy =
    rev != null && revPrev != null && revPrev !== 0 ? (rev - revPrev) / Math.abs(revPrev) : null;
  const niYoy =
    ni != null && niPrev != null && niPrev !== 0 ? (ni - niPrev) / Math.abs(niPrev) : null;

  const dy = ratios?.dividendYield ?? null;
  let annualDividendCash: number | null = null;
  if (dy != null && dy > 0 && price != null && shares != null && shares > 0) {
    const priceVnd = price < 500 ? price * 1000 : price;
    annualDividendCash = dy * priceVnd * shares;
  }
  const perf = computeInvestmentPerformance({
    closes,
    indexCloses,
    dividendYield: dy,
    netIncome: ni,
    annualDividendCash,
  });

  const intro: string[] = [];
  intro.push(
    name
      ? `**${sym}** — ${name}${floor ? ` · sàn ${floor}` : ""}.`
      : `**${sym}** — mã cổ phiếu trên thị trường Việt Nam.`,
  );
  if (profile?.foundDate) intro.push(`Thành lập / ghi nhận: ${profile.foundDate}.`);
  if (profile?.employees) intro.push(`Quy mô nhân sự (báo cáo): khoảng ${fmt(profile.employees, 0)} người.`);
  if (profile?.website) intro.push(`Website: ${profile.website}.`);
  if (profile?.vnSummary) {
    intro.push(profile.vnSummary.slice(0, 900) + (profile.vnSummary.length > 900 ? "…" : ""));
  } else {
    intro.push("Hồ sơ doanh nghiệp rút gọn từ nguồn VNDirect profile (nếu có).");
  }
  if (shareholders?.length) {
    intro.push(
      "Cổ đông lớn: " +
        shareholders
          .slice(0, 5)
          .map((s) => {
            const pct = s.ownershipPct;
            const pctLabel =
              pct == null ? "" : ` (${pct > 1 ? pct.toFixed(1) : (pct * 100).toFixed(1)}%)`;
            return `${s.name}${pctLabel}`;
          })
          .join("; ") +
        ".",
    );
  }

  const moat: string[] = [];
  if (research?.swot?.strengths?.length) {
    moat.push("Yếu tố tạo lợi thế cạnh tranh (từ BCTC/profile):");
    moat.push(...research.swot.strengths.slice(0, 6).map((s) => `• ${s}`));
  } else if (intel?.swot?.strengths?.length) {
    moat.push(...intel.swot.strengths.slice(0, 6).map((s) => `• ${s.text}`));
  } else {
    moat.push(
      "Chưa đủ dữ liệu định lượng để khẳng định moat bền vững — cần theo dõi biên lợi nhuận, ROE và thị phần ngành.",
    );
  }
  if (health?.scores?.profitability != null) {
    moat.push(`Điểm sinh lời (engine): ${Math.round(health.scores.profitability)}/100.`);
  }

  const industry: string[] = [];
  industry.push(
    floor
      ? `Doanh nghiệp niêm yết trên **${floor}**, chịu khung pháp lý và chu kỳ thanh khoản của sàn này.`
      : "Ngành hoạt động suy từ hồ sơ và mô hình doanh thu (khi có BCTC).",
  );
  if (rev != null)
    industry.push(`Quy mô doanh thu kỳ gần: **${fmtTy(rev)}** — phản ánh vị thế trong chuỗi cung ứng ngành.`);
  if (research?.swot?.opportunities?.length) {
    industry.push("Cơ hội ngành/doanh nghiệp: " + research.swot.opportunities.slice(0, 3).join("; ") + ".");
  }

  const businessResults: string[] = [];
  const businessTable: {
    metric: string;
    current: string;
    prior: string;
    change: string;
  }[] = [];

  const row0 = income[0] ?? {};
  const row1 = income[1] ?? {};
  const bal0 = balance[0] ?? {};
  const bal1 = balance[1] ?? {};
  const cf0 = cashflow[0] ?? {};
  const cf1 = cashflow[1] ?? {};

  const periodCurrent =
    (typeof row0.period === "string" && row0.period) ||
    (typeof row0.fiscalDate === "string" && row0.fiscalDate) ||
    "Kỳ gần";
  const periodPrior =
    (typeof row1.period === "string" && row1.period) ||
    (typeof row1.fiscalDate === "string" && row1.fiscalDate) ||
    "Kỳ trước";

  const q0 = typeof row0.quarter === "number" ? row0.quarter : null;
  const q1 = typeof row1.quarter === "number" ? row1.quarter : null;
  const y0 = typeof row0.year === "number" ? row0.year : null;
  const y1 = typeof row1.year === "number" ? row1.year : null;
  const pt0 = typeof row0.periodType === "string" ? row0.periodType : null;
  const pt1 = typeof row1.periodType === "string" ? row1.periodType : null;

  let compareMode: "QoQ" | "YoY" | "period" = "period";
  if (pt0 === "quarter" && pt1 === "quarter") {
    if (q0 != null && q1 != null && y0 != null && y1 != null && q0 === q1 && y0 === y1 + 1) {
      compareMode = "YoY";
    } else {
      compareMode = "QoQ";
    }
  } else if (pt0 === "year" && pt1 === "year") {
    compareMode = "YoY";
  }

  const chg = (cur: number | null, pri: number | null): string => {
    if (cur == null || pri == null || pri === 0) return "—";
    return fmtPct(((cur - pri) / Math.abs(pri)) * 100);
  };
  const cell = (v: number | null) => (v != null ? fmtTy(v) : "—");

  const rev0 = n(row0.netRevenue) ?? n(row0.revenue);
  const rev1 = n(row1.netRevenue) ?? n(row1.revenue);
  const ni0 = n(row0.netIncome) ?? n(row0.netProfit) ?? n(row0.netIncomeParent);
  const ni1 = n(row1.netIncome) ?? n(row1.netProfit) ?? n(row1.netIncomeParent);
  const gp0 = n(row0.grossProfit);
  const gp1 = n(row1.grossProfit);
  const op0 = n(row0.operatingProfit) ?? n(row0.ebit);
  const op1 = n(row1.operatingProfit) ?? n(row1.ebit);
  const eq0 = n(bal0.equity);
  const eq1 = n(bal1.equity);
  const as0 = n(bal0.totalAssets);
  const as1 = n(bal1.totalAssets);
  const ocf0 = n(cf0.operatingCashFlow);
  const ocf1 = n(cf1.operatingCashFlow);
  const fcf0 = n(cf0.freeCashFlow);
  const fcf1 = n(cf1.freeCashFlow);

  const pushRow = (metric: string, cur: number | null, pri: number | null) => {
    if (cur == null && pri == null) return;
    businessTable.push({
      metric,
      current: cell(cur),
      prior: cell(pri),
      change: chg(cur, pri),
    });
  };

  pushRow("Doanh thu thuần", rev0, rev1);
  pushRow("Lợi nhuận gộp", gp0, gp1);
  pushRow("LN hoạt động", op0, op1);
  pushRow("LNST", ni0, ni1);
  pushRow("Vốn chủ sở hữu", eq0, eq1);
  pushRow("Tổng tài sản", as0, as1);
  pushRow("OCF (HĐKD)", ocf0, ocf1);
  pushRow("FCF", fcf0, fcf1);

  if (health?.scores?.overall != null) {
    businessTable.push({
      metric: "Financial Health",
      current: `${Math.round(health.scores.overall)}/100`,
      prior: "—",
      change: "—",
    });
  }

  const businessTableMeta =
    businessTable.length > 0
      ? { periodCurrent, periodPrior, compareMode }
      : null;

  if (!businessTable.length) {
    businessResults.push("Chưa lấy được BCTC 2 kỳ từ VNDirect để so sánh.");
  }

  const technicalLines: string[] = [];
  if (quote?.price != null) {
    technicalLines.push(
      `Giá hiện tại: **${fmt(quote.price)}** (${fmtPct(quote.changePercent)})` +
        (quote.volume != null ? ` · KL ${fmt(quote.volume, 0)}` : "") +
        ".",
    );
  } else if (closes.length) {
    technicalLines.push(`Giá đóng gần nhất (chart): **${fmt(closes.at(-1)!)}**.`);
  }
  if (technical) {
    if (technical.trend?.label) technicalLines.push(`Xu hướng: **${technical.trend.label}**.`);
    if (technical.rsi14 != null) technicalLines.push(`RSI14: **${technical.rsi14.toFixed(1)}**.`);
    if (technical.macd?.histogram != null)
      technicalLines.push(`MACD hist: **${technical.macd.histogram.toFixed(3)}**.`);
    if (technical.sma) {
      const s = technical.sma;
      const ma: string[] = [];
      if (s.sma20 != null) ma.push(`SMA20 ${fmt(s.sma20)}`);
      if (s.sma50 != null) ma.push(`SMA50 ${fmt(s.sma50)}`);
      if (s.sma200 != null) ma.push(`SMA200 ${fmt(s.sma200)}`);
      if (ma.length) technicalLines.push(`MA: ${ma.join(" · ")}.`);
    }
    if (technical.support?.length)
      technicalLines.push(`Hỗ trợ: ${technical.support.slice(0, 2).map((x) => fmt(x)).join(", ")}.`);
    if (technical.resistance?.length)
      technicalLines.push(`Kháng cự: ${technical.resistance.slice(0, 2).map((x) => fmt(x)).join(", ")}.`);
  } else {
    technicalLines.push("Chưa đủ chuỗi nến để tính đầy đủ chỉ báo kỹ thuật.");
  }

  const priceSeries: ChartPoint[] = bars.slice(-180).map((b) => ({ t: b.time, c: b.close }));

  const valuation: string[] = [];
  if (ratios) {
    const bits: string[] = [];
    if (ratios.pe != null) bits.push(`P/E **${ratios.pe.toFixed(1)}x**`);
    if (ratios.pb != null) bits.push(`P/B **${ratios.pb.toFixed(2)}x**`);
    if (ratios.ps != null) bits.push(`P/S **${ratios.ps.toFixed(2)}x**`);
    if (ratios.eps != null) bits.push(`EPS **${fmt(ratios.eps)}**`);
    if (dy != null) bits.push(`DY **${(dy * 100).toFixed(2)}%**`);
    if (bits.length) valuation.push(bits.join(" · ") + ".");
  }
  if (price != null && shares != null) {
    const mcap = price * shares * (price < 500 ? 1000 : 1);
    valuation.push(`Vốn hóa ước tính: **${fmtTy(mcap)}** (SLCP ${fmt(shares, 0)}).`);
  }
  if (perf.beta != null)
    valuation.push(`Beta vs VNINDEX: **${perf.beta.toFixed(2)}** · Sharpe ${perf.sharpe != null ? perf.sharpe.toFixed(2) : "—"}.`);
  if (!valuation.length) valuation.push("Chưa đủ ratios định giá từ finfo VNDirect.");

  const projection: string[] = [];
  if (revYoy != null || niYoy != null) {
    projection.push(
      "Giả định xu hướng gần (không phải cam kết): " +
        (revYoy != null ? `DT YoY ${fmtPct(revYoy * 100)}` : "") +
        (revYoy != null && niYoy != null ? ", " : "") +
        (niYoy != null ? `LNST YoY ${fmtPct(niYoy * 100)}` : "") +
        ". Dự phóng cần cập nhật khi có BCTC mới / guidance.",
    );
  }
  if (ratios?.pe != null && ratios.eps != null && ratios.eps > 0) {
    const implied = ratios.pe * ratios.eps;
    projection.push(
      `Nếu giữ P/E hiện tại (~${ratios.pe.toFixed(1)}x) và EPS ổn định, mức giá hàm ý quanh **${fmt(implied)}** (minh họa, không phải mục tiêu).`,
    );
  }
  projection.push(
    "Kịch bản tích cực: biên lợi nhuận cải thiện + ngành phục hồi. Kịch bản thận trọng: tăng trưởng chậm / chi phí vốn cao hơn kỳ vọng.",
  );

  const catalysts: string[] = [];
  catalysts.push("**1. Kênh tác động doanh thu**");
  if (revYoy != null) {
    const dir =
      revYoy > 0.08
        ? "đà tăng mạnh — catalyst ngắn hạn là duy trì khối lượng × giá bán và thị phần"
        : revYoy > 0.02
          ? "tăng nhẹ — cần sản phẩm mới / mở rộng kênh để đẩy tốc độ cao hơn"
          : revYoy < -0.05
            ? "sụt giảm — catalyst phục hồi phụ thuộc cầu đầu cuối, giá bán và chu kỳ ngành"
            : "đi ngang — tăng trưởng hữu cơ hạn chế, catalyst cần đến M&A hoặc mở rộng thị trường";
    catalysts.push(
      `• Doanh thu kỳ gần nhất ${fmtPct(revYoy * 100)} so với kỳ so sánh (${compareMode}) — ${dir}.`,
    );
  } else {
    catalysts.push(
      "• Chưa có cặp kỳ BCTC đủ để đo tốc độ DT; quy mô DT phụ thuộc khối lượng × ASP và chu kỳ ngành.",
    );
  }
  if (gp0 != null && rev0 != null && rev0 !== 0) {
    const gpm = (gp0 / rev0) * 100;
    catalysts.push(
      `• Biên gộp kỳ gần ~**${gpm.toFixed(1)}%** — ${
        gpm >= 25
          ? "biên cao giúp DT tăng lan tỏa tốt sang LN"
          : gpm >= 15
            ? "biên trung bình; catalyst LN cần kiểm soát giá vốn"
            : "biên thấp; áp lực giá vốn/ASP là rủi ro chính khi DT tăng"
      }.`,
    );
  }
  if (research?.swot?.opportunities?.length) {
    catalysts.push("**Cơ hội từ hồ sơ / SWOT**");
    catalysts.push(...research.swot.opportunities.slice(0, 4).map((o) => `• ${o}`));
  }
  const catSrc = [
    ...(research?.catalysts ?? []),
    ...(intel?.catalysts?.map((c) => c.text) ?? []),
  ].filter(Boolean);
  if (catSrc.length) {
    catalysts.push("**Catalyst cụ thể (BCTC / tin / research)**");
    catalysts.push(...catSrc.slice(0, 6).map((c) => `• ${c}`));
  }

  catalysts.push("**2. Kênh tác động lợi nhuận**");
  if (niYoy != null) {
    catalysts.push(
      `• LNST ${fmtPct(niYoy * 100)} so với kỳ trước — mức lan tỏa từ DT sang LN phụ thuộc biên gộp, chi phí bán hàng/QLDN và chi phí lãi vay.`,
    );
  }
  if (op0 != null && rev0 != null && rev0 !== 0) {
    const opm = (op0 / rev0) * 100;
    catalysts.push(
      `• Biên hoạt động ~**${opm.toFixed(1)}%** — ${
        opm >= 12
          ? "đòn bẩy hoạt động tốt, DT tăng dễ đẩy LN"
          : "biên mỏng; cần kiểm soát chi phí vận hành trước khi kỳ vọng tăng trưởng LN bền"
      }.`,
    );
  }
  if (health?.scores?.profitability != null) {
    catalysts.push(
      `• Điểm sinh lời (engine) **${Math.round(health.scores.profitability)}/100** — ${
        health.scores.profitability >= 60
          ? "ROE/biên ủng hộ khả năng mở rộng LN khi DT phục hồi"
          : "sinh lời còn yếu; catalyst LN cần cải thiện biên trước"
      }.`,
    );
  }
  if (ocf0 != null) {
    catalysts.push(`• OCF kỳ gần **${fmtTy(ocf0)}** — chất lượng LN qua dòng tiền.`);
  }

  catalysts.push("**3. Catalyst định giá & dòng tiền thị trường**");
  if (ratios?.pe != null || ratios?.pb != null) {
    catalysts.push(
      `• Định giá hiện tại: ${ratios.pe != null ? `P/E ${ratios.pe.toFixed(1)}x` : ""}${ratios.pe != null && ratios.pb != null ? " · " : ""}${ratios.pb != null ? `P/B ${ratios.pb.toFixed(2)}x` : ""} — catalyst nới định giá khi LN tăng hoặc ngành re-rate.`,
    );
  }
  if (perf.alpha != null) {
    catalysts.push(
      `• Alpha 12T **${fmtPct(perf.alpha * 100)}** — ${
        perf.alpha > 0.05 ? "đã outperform; cần catalyst mới để duy trì" : "underperform; catalyst phục hồi phụ thuộc BCTC/tin ngành"
      }.`,
    );
  }
  if (foreignPack) {
    catalysts.push("• Dòng vốn ngoại / ETF (nếu có số liệu session) là catalyst ngắn hạn cho thanh khoản và valuation gap.");
  }

  const risks: string[] = [];
  const riskSrc = [
    ...(research?.risks ?? []),
    ...(intel?.risks?.map((r) => r.text) ?? []),
    ...(research?.swot?.threats ?? []),
  ].filter(Boolean);
  if (riskSrc.length) risks.push(...riskSrc.slice(0, 8).map((r) => `• ${r}`));
  else {
    risks.push("• Rủi ro ngành, lãi suất và thanh khoản thị trường.");
    risks.push("• Rủi ro thực thi chiến lược và biến động chi phí đầu vào.");
  }

  const vsIndustry: string[] = [];
  if (perf.tsr1y != null)
    vsIndustry.push(`Hiệu suất giá ~12 tháng của mã: **${fmtPct(perf.tsr1y * 100)}**.`);
  if (perf.alpha != null)
    vsIndustry.push(`Alpha (Jensen, năm): **${fmtPct(perf.alpha * 100)}**.`);
  if (health?.scores?.overall != null) {
    vsIndustry.push(
      health.scores.overall >= 60
        ? "Sức khỏe tài chính nghiêng trên trung bình so với mức trung tính."
        : "Sức khỏe tài chính trung bình/yếu hơn — thận trọng khi so peer.",
    );
  }
  vsIndustry.push("So sánh peer chi tiết cần P/E·ROE ngành; báo cáo dùng mã + benchmark VNINDEX.");

  const macro: string[] = [];
  macro.push("**1. Môi trường lãi suất & chi phí vốn**");
  macro.push(
    "• Mặt bằng lãi suất điều hành và lãi huy động quyết định chi phí vốn của doanh nghiệp — đặc biệt DN có tỷ lệ nợ vay/vốn chủ cao. Lãi suất tăng → chi phí lãi vay tăng → biên LN thu hẹp; lãi suất giảm → hỗ trợ đầu tư và tiêu dùng đầu cuối.",
  );
  const debtLike =
    n((bal0 as Record<string, unknown>).totalDebt) ??
    n((bal0 as Record<string, unknown>).longTermDebt) ??
    n((bal0 as Record<string, unknown>).shortTermDebt);
  const eqForLev = n((bal0 as Record<string, unknown>).equity) ?? eq0;
  if (debtLike != null && eqForLev != null && eqForLev > 0) {
    const lev = debtLike / eqForLev;
    macro.push(
      `• Ước tính đòn bẩy nợ/VCSH kỳ gần ~**${lev.toFixed(2)}x** — ${
        lev > 1.5
          ? "nhạy cao với lãi suất; chi phí vốn là rủi ro vĩ mô trọng yếu"
          : lev > 0.6
            ? "đòn bẩy trung bình; lãi suất ảnh hưởng có kiểm soát"
            : "đòn bẩy thấp; ít bị ảnh hưởng trực tiếp bởi chu kỳ lãi suất"
      }.`,
    );
  } else {
    macro.push(
      "• Chưa có số liệu nợ vay chi tiết trên BCTC gần nhất; mức độ nhạy lãi suất cần đối chiếu thêm từ thuyết minh BCTC.",
    );
  }
  macro.push(
    "• Nhu cầu tín dụng và tiêu dùng cuối cùng cũng phụ thuộc lãi suất: lãi thấp thường hỗ trợ DT các ngành bán lẻ, bất động sản, tiêu dùng lâu bền.",
  );

  macro.push("**2. Tỷ giá & chi phí đầu vào nhập khẩu**");
  macro.push(
    "• USD/VND và biến động tỷ giá ảnh hưởng DN xuất/nhập khẩu, nợ ngoại tệ và giá vốn hàng hóa đầu vào. Tỷ giá tăng (VND yếu) hỗ trợ xuất khẩu nhưng tăng chi phí nhập khẩu.",
  );

  macro.push("**3. Thị trường chứng khoán & thanh khoản**");
  if (indicesPack) {
    macro.push("• Chỉ số và thanh khoản thị trường chung ảnh hưởng định giá tương đối và appetite rủi ro với cổ phiếu beta cao.");
  }
  if (perf.alpha != null) {
    macro.push(
      `• Alpha mã vs VNINDEX ~**${fmtPct(perf.alpha * 100)}** — so với VNINDEX để đánh giá alpha thực tế trong bối cảnh vĩ mô hiện tại.`,
    );
  }

  macro.push("**4. Ngành & chu kỳ kinh tế**");
  if (floor) {
    macro.push(
      `• Mã niêm yết **${floor}** chịu khung giao dịch và tâm lý riêng của sàn. Chu kỳ ngành (tín dụng, tiêu dùng, xuất khẩu, đầu tư công, giá hàng hóa…) lọc trực tiếp qua DT và biên LN của DN.`,
    );
  }
  if (industryHint) {
    macro.push(`• Gợi ý ngành / mô tả: ${industryHint}.`);
  }
  if (research?.swot?.threats?.length) {
    macro.push(
      "• Rủi ro vĩ mô/ngành từ research: " +
        research.swot.threats.slice(0, 3).join("; ") +
        ".",
    );
  }
  macro.push(
    "• Các biến số vĩ mô cần theo dõi định kỳ: lãi suất điều hành, tăng trưởng tín dụng, PMI/sản xuất, xuất khẩu, giải ngân đầu tư công, và biến động hàng hóa đầu vào (nếu DN thuộc chuỗi giá trị đó).",
  );

  if (news?.articles?.length) {
    macro.push("**5. Tin / sự kiện đang được theo dõi**");
    for (const a of news.articles.slice(0, 5)) {
      macro.push(`• ${a.title}`);
    }
  } else {
    macro.push("**5. Tin / sự kiện**");
    macro.push(
      "• Chưa có tin gắn mã trong cửa sổ gần; nên theo dõi thêm kết quả kinh doanh, hướng dẫn và tin ngành.",
    );
  }

  const overall: string[] = [];
  let score = 50;
  let factors = 0;
  if (technical?.trend?.score != null) {
    score += Math.max(-15, Math.min(15, technical.trend.score * 6));
    factors++;
  }
  if (health?.scores?.overall != null) {
    score += (health.scores.overall - 50) * 0.3;
    factors++;
  }
  if (perf.alpha != null) {
    score += Math.max(-10, Math.min(10, perf.alpha * 40));
    factors++;
  }
  score = Math.round(Math.max(10, Math.min(90, score)));
  const stanceShort =
    score >= 65 ? "TÍCH CỰC" : score >= 45 ? "TRUNG LẬP" : "THẬN TRỌNG";
  const conviction = factors >= 3 && score >= 55 ? "Cao" : factors >= 2 ? "TB" : "Thấp";

  let targetLabel = "—";
  let upsideLabel = "";
  if (ratios?.pe != null && ratios.eps != null && ratios.eps > 0 && price != null) {
    const tgt = ratios.pe * ratios.eps;
    const up = price > 0 ? ((tgt - price) / price) * 100 : null;
    targetLabel = `${fmt(tgt, 0)}đ`;
    if (up != null) upsideLabel = ` (${up >= 0 ? "+" : ""}${up.toFixed(1)}%, 12T)`;
  } else if (price != null) {
    const mult = score >= 65 ? 1.1 : score >= 45 ? 1.05 : 0.95;
    const tgt = price * mult;
    targetLabel = `${fmt(tgt, 0)}đ`;
    upsideLabel = ` (${((mult - 1) * 100) >= 0 ? "+" : ""}${((mult - 1) * 100).toFixed(1)}%, 12T)`;
  }

  overall.push(
    `**${sym}** — quan điểm research: **${stanceShort}**, conviction ${conviction}. Giá mục tiêu minh họa ${targetLabel}${upsideLabel}.`,
  );

  const whyBits: string[] = [];
  if (niYoy != null) {
    whyBits.push(`LNST ${fmtPct(niYoy * 100)} ${compareMode === "period" ? "so kỳ trước" : compareMode}`);
  }
  if (ratios?.pb != null) whyBits.push(`P/B ${ratios.pb.toFixed(2)}x`);
  if (ratios?.pe != null) whyBits.push(`P/E ${ratios.pe.toFixed(1)}x`);
  if (technical?.trend?.label) whyBits.push(`xu hướng ${technical.trend.label}`);
  if (price != null && technical?.sma) {
    const s = technical.sma;
    const under: string[] = [];
    if (s.sma20 != null && price < s.sma20) under.push("SMA20");
    if (s.sma50 != null && price < s.sma50) under.push("SMA50");
    if (s.sma200 != null && price < s.sma200) under.push("SMA200");
    if (under.length === 3) whyBits.push("giá dưới cả 3 MA");
    else if (under.length) whyBits.push(`giá dưới ${under.join("/")}`);
  }
  if (perf.alpha != null) whyBits.push(`alpha 12T ${fmtPct(perf.alpha * 100)}`);
  if (health?.scores?.overall != null) {
    whyBits.push(`health ${Math.round(health.scores.overall)}/100`);
  }
  overall.push(
    whyBits.length
      ? `Cơ sở: ${whyBits.join("; ")}.`
      : "Cơ sở định lượng còn mỏng — ưu tiên đọc lại BCTC, định giá và kỹ thuật phía trên.",
  );

  let riskMain =
    (risks[0] ?? "").replace(/^•\s*/, "").trim() ||
    "Rủi ro ngành, lãi suất và thanh khoản thị trường";
  if (debtLike != null && eqForLev != null && eqForLev > 0) {
    const levPct = (debtLike / eqForLev) * 100;
    if (levPct >= 80) {
      riskMain = `Đòn bẩy nợ/VCSH ~${levPct.toFixed(0)}% — ${
        levPct >= 100 ? "sát/ vượt mức cao, dư địa vay mỏng" : "cao, nhạy lãi suất và thanh khoản"
      }`;
    }
  }
  overall.push(`Rủi ro chính: ${riskMain}.`);

  const sups = (technical?.support ?? []).slice(0, 2).map((x) => fmt(x, 0));
  const action =
    sups.length >= 2
      ? `Chờ về ${sups[0]}–${sups[1]} hoặc chờ BCTC/thị phần kỳ tới xác nhận trước khi giải ngân`
      : sups.length === 1
        ? `Chờ về vùng hỗ trợ ~${sups[0]} hoặc xác nhận kỹ thuật trước khi giải ngân`
        : "Chờ xác nhận độ rộng + thanh khoản và vùng hỗ trợ kỹ thuật trước khi giải ngân";
  overall.push(`Hành động: ${action}.`);

  const sma50v = technical?.sma?.sma50;
  const res1 = technical?.resistance?.[0];
  const upgrade =
    sma50v != null
      ? `nâng hạng nếu vượt SMA50 (${fmt(sma50v, 0)})${res1 != null ? ` hoặc ${fmt(res1, 0)}` : ""} kèm KL tăng`
      : res1 != null
        ? `nâng hạng nếu vượt kháng cự ${fmt(res1, 0)} kèm KL tăng`
        : "nâng hạng nếu giá vượt kháng cự gần kèm độ rộng/KL cải thiện";
  let downgrade = "hạ hạng nếu mất hỗ trợ chính kèm bán lan tỏa";
  if (debtLike != null && eqForLev != null && eqForLev > 0) {
    const levPct = (debtLike / eqForLev) * 100;
    if (levPct >= 60) {
      downgrade = `hạ hạng nếu nợ/VCSH >${Math.round(levPct + 10)}% hoặc mất hỗ trợ chính`;
    }
  }
  overall.push(`Theo dõi: ${upgrade}; ${downgrade}.`);

  overall.push(
    `Điểm tổng hợp ~**${score}**/100 từ ${factors} nhóm tín hiệu (kỹ thuật / health / alpha) — chỉ mang tính research, không phải khuyến nghị mua/bán.`,
  );

  const coverage = [quote, bars.length, income.length, ratios, profile].filter(Boolean).length;
  const dataQuality: CompanyAnalysisReport["dataQuality"] =
    coverage >= 4 ? "HIGH" : coverage >= 2 ? "MEDIUM" : "LOW";

  const report: CompanyAnalysisReport = {
    symbol: sym,
    title: `Báo cáo phân tích doanh nghiệp — ${sym}${name ? ` (${name})` : ""}`,
    generatedAt: new Date().toISOString(),
    companyName: name,
    floor,
    companyLogo: profile?.logo ?? null,
    sections: {
      intro,
      moat,
      industry,
      valueChain,
      businessResults,
      businessTable,
      businessTableMeta,
      technical: technicalLines,
      priceSeries,
      valuation,
      projection,
      catalysts,
      risks,
      vsIndustry,
      macro,
      overall,
    },
    dataQuality,
  };

  const meta = buildMeta({
    source: "orca-company-analysis-report",
    sourceTimestampMs: Date.now(),
    note: `${sym} · coverage ${coverage}/5 · bars ${bars.length}`,
  });
  meta.freshness = freshnesses.length ? worstFreshness(freshnesses) : "FRESH";

  return { report, meta };
}
