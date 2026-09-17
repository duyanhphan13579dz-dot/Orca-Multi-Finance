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
  sections: {
    intro: string[];
    moat: string[];
    industry: string[];
    valueChain: { input: string[]; process: string[]; output: string[] } | null;
    businessResults: string[];
    businessTable: { metric: string; value: string; note?: string }[];
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

  const [analysis, quotePack, bars, fs, ratios, equity, profile, shareholders, intel, news, idxBars] =
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
  const businessTable: { metric: string; value: string; note?: string }[] = [];
  const b0 = balance[0] ?? {};
  const equityV = n(b0.equity);
  const assets = n(b0.totalAssets);
  const c0 = cashflow[0] ?? {};
  const ocf = n(c0.operatingCashFlow);
  const fcf = n(c0.freeCashFlow);

  if (rev != null) {
    businessTable.push({
      metric: "Doanh thu thuần",
      value: fmtTy(rev),
      note: revYoy != null ? `YoY ${fmtPct(revYoy * 100)}` : undefined,
    });
  }
  if (ni != null) {
    businessTable.push({
      metric: "LNST",
      value: fmtTy(ni),
      note: niYoy != null ? `YoY ${fmtPct(niYoy * 100)}` : undefined,
    });
  }
  if (equityV != null) businessTable.push({ metric: "Vốn chủ sở hữu", value: fmtTy(equityV) });
  if (assets != null) businessTable.push({ metric: "Tổng tài sản", value: fmtTy(assets) });
  if (ocf != null) businessTable.push({ metric: "OCF (HĐKD)", value: fmtTy(ocf) });
  if (fcf != null) businessTable.push({ metric: "FCF", value: fmtTy(fcf) });
  if (health?.scores?.overall != null) {
    businessTable.push({
      metric: "Financial Health",
      value: `${Math.round(health.scores.overall)}/100`,
      note: `Sinh lời ${health.scores.profitability ?? "—"} · Đòn bẩy ${health.scores.leverage ?? "—"} · Dòng tiền ${health.scores.cashflow ?? "—"}`,
    });
  }
  if (!businessTable.length) {
    businessResults.push("Chưa lấy được BCTC kỳ gần từ VNDirect.");
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
  const catSrc = [...(research?.catalysts ?? []), ...(intel?.catalysts?.map((c) => c.text) ?? [])].filter(Boolean);
  if (catSrc.length) catalysts.push(...catSrc.slice(0, 8).map((c) => `• ${c}`));
  else {
    catalysts.push("• Biến động doanh thu theo chu kỳ ngành và nhu cầu đầu cuối.");
    catalysts.push("• Biên lợi nhuận gộp / chi phí hoạt động ảnh hưởng LNST.");
  }
  catalysts.push(
    "Các yếu tố trên tác động trực tiếp tới **doanh thu** (khối lượng × giá bán) và **lợi nhuận** (biên × đòn bẩy chi phí).",
  );

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
  macro.push("Lãi suất và tỷ giá ảnh hưởng chi phí vốn và nhu cầu liên quan ngành.");
  macro.push("Thanh khoản TTCK và dòng vốn khối ngoại khuếch đại biến động giá ngắn hạn.");
  if (news?.articles?.length) {
    macro.push("Tin gần đây: " + news.articles.slice(0, 3).map((a) => a.title).join("; ") + ".");
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
  const stance =
    score >= 65 ? "Nghiêng tích cực (research)" : score >= 45 ? "Trung lập" : "Thận trọng (research)";
  overall.push(`**Nhận định tổng hợp:** ${stance} · điểm định lượng ~**${score}**/100 (${factors} nhóm tín hiệu).`);
  overall.push(
    "Báo cáo tổng hợp dữ liệu thị trường + BCTC + hồ sơ DN từ pipeline ORCA — phục vụ nghiên cứu, **không phải khuyến nghị mua/bán**.",
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
    sections: {
      intro,
      moat,
      industry,
      valueChain,
      businessResults,
      businessTable,
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
