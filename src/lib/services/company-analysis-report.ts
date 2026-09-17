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
import * as vndirect from "../providers/vndirect";

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
    businessTable: { metric: string; current: string; prior: string; change: string }[];
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
      vndirect.getVndForeignFlow().catch(() => null),
      vndirect.getVndIndices().catch(() => null),
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

  const industryHint = profile?.vnSummary?.slice(0, 80) ?? (floor ? `Niêm yết ${floor}` : null);
  const valueChain: VC | null =
    pickVc(research?.valueChain) ?? pickVc(intel?.valueChain) ?? pickVc(resolveValueChain(industryHint));

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
  const revYoy = rev != null && revPrev != null && revPrev !== 0 ? (rev - revPrev) / Math.abs(revPrev) : null;
  const niYoy = ni != null && niPrev != null && niPrev !== 0 ? (ni - niPrev) / Math.abs(niPrev) : null;

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
  intro.push(name ? `**${sym}** — ${name}${floor ? ` · sàn ${floor}` : ""}.` : `**${sym}** — mã cổ phiếu trên thị trường Việt Nam.`);
  if (profile?.foundDate) intro.push(`Thành lập / ghi nhận: ${profile.foundDate}.`);
  if (profile?.employees) intro.push(`Quy mô nhân sự (báo cáo): khoảng ${fmt(profile.employees, 0)} người.`);
  if (profile?.website) intro.push(`Website: ${profile.website}.`);
  if (profile?.vnSummary) intro.push(profile.vnSummary.slice(0, 900) + (profile.vnSummary.length > 900 ? "…" : ""));
  else intro.push("Hồ sơ doanh nghiệp rút gọn từ nguồn VNDirect profile (nếu có).");
  if (shareholders?.length) {
    intro.push(
      "Cổ đông lớn: " +
        shareholders
          .slice(0, 5)
          .map((s) => {
            const pct = s.ownershipPct;
            const pctLabel = pct == null ? "" : ` (${pct > 1 ? pct.toFixed(1) : (pct * 100).toFixed(1)}%)`;
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
    moat.push("Chưa đủ dữ liệu định lượng để khẳng định moat bền vững — cần theo dõi biên lợi nhuận, ROE và thị phần ngành.");
  }
  if (health?.scores?.profitability != null) moat.push(`Điểm sinh lời (engine): ${Math.round(health.scores.profitability)}/100.`);

  const industry: string[] = [];
  industry.push(floor ? `Doanh nghiệp niêm yết trên **${floor}**, chịu khung pháp lý và chu kỳ thanh khoản của sàn này.` : "Ngành hoạt động suy từ hồ sơ và mô hình doanh thu (khi có BCTC).");
  if (rev != null) industry.push(`Quy mô doanh thu kỳ gần: **${fmtTy(rev)}** — phản ánh vị thế trong chuỗi cung ứng ngành.`);
  if (research?.swot?.opportunities?.length) industry.push("Cơ hội ngành/doanh nghiệp: " + research.swot.opportunities.slice(0, 3).join("; ") + ".");

  const businessResults: string[] = [];
  const businessTable: { metric: string; current: string; prior: string; change: string }[] = [];
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
    compareMode = q0 != null && q1 != null && y0 != null && y1 != null && q0 === q1 && y0 === y1 + 1 ? "YoY" : "QoQ";
  } else if (pt0 === "year" && pt1 === "year") compareMode = "YoY";

  const chg = (cur: number | null, pri: number | null): string => {
    if (cur == null || pri == null || pri === 0) return "—";
    return fmtPct(((cur - pri) / Math.abs(pri)) * 100);
  };
  const cell = (v: number | null) => (v != null ? fmtTy(v) : "—");
  const pushRow = (metric: string, cur: number | null, pri: number | null) => {
    if (cur == null && pri == null) return;
    businessTable.push({ metric, current: cell(cur), prior: cell(pri), change: chg(cur, pri) });
  };
  pushRow("Doanh thu thuần", n(row0.netRevenue) ?? n(row0.revenue), n(row1.netRevenue) ?? n(row1.revenue));
  pushRow("Lợi nhuận gộp", n(row0.grossProfit), n(row1.grossProfit));
  pushRow("LN hoạt động", n(row0.operatingProfit) ?? n(row0.ebit), n(row1.operatingProfit) ?? n(row1.ebit));
  pushRow("LNST", n(row0.netIncome) ?? n(row0.netProfit) ?? n(row0.netIncomeParent), n(row1.netIncome) ?? n(row1.netProfit));
  pushRow("Vốn chủ sở hữu", n(bal0.equity), n(bal1.equity));
  pushRow("Tổng tài sản", n(bal0.totalAssets), n(bal1.totalAssets));
  pushRow("OCF (HĐKD)", n(cf0.operatingCashFlow), n(cf1.operatingCashFlow));
  pushRow("FCF", n(cf0.freeCashFlow), n(cf1.freeCashFlow));
  if (health?.scores?.overall != null) {
    businessTable.push({ metric: "Financial Health", current: `${Math.round(health.scores.overall)}/100`, prior: "—", change: "—" });
  }
  const businessTableMeta = businessTable.length ? { periodCurrent, periodPrior, compareMode } : null;
  if (!businessTable.length) businessResults.push("Chưa lấy được BCTC 2 kỳ từ VNDirect để so sánh.");

  const technicalLines: string[] = [];
  if (quote?.price != null) {
    technicalLines.push(`Giá hiện tại: **${fmt(quote.price)}** (${fmtPct(quote.changePercent)})${quote.volume != null ? ` · KL ${fmt(quote.volume, 0)}` : ""}.`);
  } else if (closes.length) technicalLines.push(`Giá đóng gần nhất (chart): **${fmt(closes.at(-1)!)}**.`);
  if (technical) {
    if (technical.trend?.label) technicalLines.push(`Xu hướng: **${technical.trend.label}**.`);
    if (technical.rsi14 != null) technicalLines.push(`RSI14: **${technical.rsi14.toFixed(1)}**.`);
    if (technical.macd?.histogram != null) technicalLines.push(`MACD hist: **${technical.macd.histogram.toFixed(3)}**.`);
    if (technical.sma) {
      const s = technical.sma;
      const ma: string[] = [];
      if (s.sma20 != null) ma.push(`SMA20 ${fmt(s.sma20)}`);
      if (s.sma50 != null) ma.push(`SMA50 ${fmt(s.sma50)}`);
      if (s.sma200 != null) ma.push(`SMA200 ${fmt(s.sma200)}`);
      if (ma.length) technicalLines.push(`MA: ${ma.join(" · ")}.`);
    }
    if (technical.support?.length) technicalLines.push(`Hỗ trợ: ${technical.support.slice(0, 2).map((x) => fmt(x)).join(", ")}.`);
    if (technical.resistance?.length) technicalLines.push(`Kháng cự: ${technical.resistance.slice(0, 2).map((x) => fmt(x)).join(", ")}.`);
  } else technicalLines.push("Chưa đủ chuỗi nến để tính đầy đủ chỉ báo kỹ thuật.");

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
  if (perf.beta != null) valuation.push(`Beta vs VNINDEX: **${perf.beta.toFixed(2)}** · Sharpe ${perf.sharpe != null ? perf.sharpe.toFixed(2) : "—"}.`);
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
    projection.push(`Nếu giữ P/E hiện tại (~${ratios.pe.toFixed(1)}x) và EPS ổn định, mức giá hàm ý quanh **${fmt(ratios.pe * ratios.eps)}** (minh họa).`);
  }
  projection.push("Kịch bản tích cực: biên LN cải thiện + ngành phục hồi. Kịch bản thận trọng: tăng trưởng chậm / chi phí vốn cao hơn kỳ vọng.");

  const catalysts: string[] = [];
  catalysts.push("**Kênh tác động doanh thu**");
  if (revYoy != null) {
    catalysts.push(
      `• Doanh thu kỳ gần ${fmtPct(revYoy * 100)} so với kỳ trước — ${revYoy > 0.05 ? "đà tăng có thể tiếp tục nếu cầu và giá bán ổn định" : revYoy < -0.05 ? "áp lực cầu/giá bán cần theo dõi" : "DT đi ngang; cần sản phẩm mới hoặc thị phần"}.`,
    );
  } else catalysts.push("• Quy mô DT phụ thuộc khối lượng × giá bán và chu kỳ ngành.");
  if (research?.swot?.opportunities?.length) catalysts.push(...research.swot.opportunities.slice(0, 3).map((o) => `• Cơ hội: ${o}`));
  const catSrc = [...(research?.catalysts ?? []), ...(intel?.catalysts?.map((c) => c.text) ?? [])].filter(Boolean);
  if (catSrc.length) {
    catalysts.push("**Catalyst cụ thể (BCTC / tin / research)**");
    catalysts.push(...catSrc.slice(0, 6).map((c) => `• ${c}`));
  }
  catalysts.push("**Kênh tác động lợi nhuận**");
  if (niYoy != null) catalysts.push(`• LNST ${fmtPct(niYoy * 100)} so với kỳ trước — biên LN và đòn bẩy chi phí quyết định lan tỏa từ DT sang LN.`);
  if (health?.scores?.profitability != null) {
    catalysts.push(`• Điểm sinh lời **${Math.round(health.scores.profitability)}/100** — ${health.scores.profitability >= 60 ? "biên/ROE ủng hộ mở rộng LN khi DT tăng" : "cần cải thiện biên trước khi kỳ vọng LN bền"}.`);
  }
  catalysts.push("• Chi phí đầu vào, lãi vay và thuế làm lệch LN so với DT; theo dõi OCF/FCF để xác nhận chất lượng lợi nhuận.");
  if (dy != null && dy > 0) catalysts.push(`• Tỷ suất cổ tức ~**${(dy * 100).toFixed(2)}%** — hỗ trợ tổng lợi nhuận NĐT khi giá đi ngang.`);

  const risks: string[] = [];
  const riskSrc = [...(research?.risks ?? []), ...(intel?.risks?.map((r) => r.text) ?? []), ...(research?.swot?.threats ?? [])].filter(Boolean);
  if (riskSrc.length) risks.push(...riskSrc.slice(0, 8).map((r) => `• ${r}`));
  else {
    risks.push("• Rủi ro ngành, lãi suất và thanh khoản thị trường.");
    risks.push("• Rủi ro thực thi chiến lược và biến động chi phí đầu vào.");
  }

  const vsIndustry: string[] = [];
  if (perf.tsr1y != null) vsIndustry.push(`Hiệu suất giá ~12 tháng: **${fmtPct(perf.tsr1y * 100)}**.`);
  if (perf.alpha != null) vsIndustry.push(`Alpha (Jensen, năm): **${fmtPct(perf.alpha * 100)}**.`);
  if (health?.scores?.overall != null) {
    vsIndustry.push(health.scores.overall >= 60 ? "Sức khỏe TC nghiêng trên trung bình." : "Sức khỏe TC trung bình/yếu hơn — thận trọng khi so peer.");
  }
  vsIndustry.push("So sánh peer chi tiết cần P/E·ROE ngành; báo cáo dùng mã + benchmark VNINDEX.");

  const macro: string[] = [];
  macro.push("**Môi trường lãi suất & chi phí vốn**");
  macro.push("• Mặt bằng lãi suất điều hành và lãi huy động ảnh hưởng chi phí vốn DN (đặc biệt DN nợ vay cao) và nhu cầu tín dụng/tiêu dùng đầu cuối.");
  macro.push("• Tỷ giá USD/VND làm thay đổi giá vốn nhập khẩu, DT xuất khẩu và đánh giá lại khoản mục ngoại tệ trên BCTC.");
  macro.push("**Thị trường chứng khoán & dòng vốn**");
  const vnIdx = indicesPack?.items?.find((x) => x.code === "VNINDEX");
  if (vnIdx && typeof vnIdx.value === "number") {
    macro.push(`• VN-Index quanh **${fmt(vnIdx.value)}** (${fmtPct(vnIdx.changePercent ?? null)}) — beta mã (${perf.beta != null ? perf.beta.toFixed(2) : "—"}) quyết định độ nhạy giá với chỉ số.`);
  } else if (indexCloses.length >= 2) {
    macro.push(`• VNINDEX đóng gần nhất ~**${fmt(indexCloses.at(-1)!)}** (phiên trước ${fmt(indexCloses.at(-2)!)}) — bối cảnh benchmark.`);
  }
  if (foreignPack && typeof foreignPack.netVal === "number") {
    const net = foreignPack.netVal;
    macro.push(`• Khối ngoại phiên gần **${net >= 0 ? "mua ròng" : "bán ròng"}** khoảng **${fmtTy(Math.abs(net))}**${foreignPack.sessionDate ? ` (${foreignPack.sessionDate})` : ""} — dòng vốn ngoại khuếch đại biến động mã vốn hóa lớn / thanh khoản cao.`);
  } else {
    macro.push("• Dòng vốn khối ngoại và thanh khoản phiên ảnh hưởng biên độ giá ngắn hạn.");
  }
  macro.push("**Ngành & chu kỳ kinh tế**");
  if (floor) macro.push(`• Mã niêm yết **${floor}**; chu kỳ ngành (tín dụng, tiêu dùng, xuất khẩu, đầu tư công…) lọc qua DT và biên LN.`);
  if (research?.swot?.threats?.length) macro.push("• Rủi ro vĩ mô/ngành: " + research.swot.threats.slice(0, 2).join("; ") + ".");
  if (news?.articles?.length) {
    macro.push("**Tin / sự kiện đang theo dõi**");
    for (const a of news.articles.slice(0, 4)) macro.push(`• ${a.title}`);
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
  const stance = score >= 65 ? "Nghiêng tích cực (research)" : score >= 45 ? "Trung lập" : "Thận trọng (research)";
  overall.push(`**Nhận định tổng hợp:** ${stance} · điểm định lượng ~**${score}**/100 (${factors} nhóm tín hiệu).`);
  overall.push("Báo cáo tổng hợp dữ liệu thị trường + BCTC + hồ sơ DN từ pipeline ORCA — phục vụ nghiên cứu, **không phải khuyến nghị mua/bán**.");

  const coverage = [quote, bars.length, income.length, ratios, profile].filter(Boolean).length;
  const dataQuality: CompanyAnalysisReport["dataQuality"] = coverage >= 4 ? "HIGH" : coverage >= 2 ? "MEDIUM" : "LOW";

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
