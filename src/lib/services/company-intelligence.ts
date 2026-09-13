import "server-only";
import { cached } from "../cache";
import { getNews } from "./news";
import { getVnOhlcv } from "./stocks";
import { fetchVndirectFinancials } from "../financial/vndirect-fs";
import type { NormalizedPeriod, NormalizedMetrics } from "../financial/types";

export type IntelligenceConfidence = "high" | "medium" | "low";
export interface IntelligenceItem {
  text: string;
  source: string;
  sourceTimestamp: string | null;
  confidence: IntelligenceConfidence;
  derived: boolean;
  reference?: string;
}
export interface CompanyIntelligence {
  symbol: string;
  swot: { strengths: IntelligenceItem[]; weaknesses: IntelligenceItem[]; opportunities: IntelligenceItem[]; threats: IntelligenceItem[] };
  catalysts: IntelligenceItem[];
  risks: IntelligenceItem[];
  valueChain: { input: string[]; process: string[]; output: string[]; source: string; derived: boolean } | null;
  analyzedAt: string;
  sources: string[];
  notes: string[];
}

const item = (text: string, source: string, date: string | null, confidence: IntelligenceConfidence = "medium", reference?: string): IntelligenceItem => ({ text, source, sourceTimestamp: date, confidence, derived: true, reference });
const latestDate = (periods: NormalizedPeriod[]) => periods[0]?.fiscalDate ?? null;
const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v);
const pct = (a: number | null, b: number | null) => a != null && b != null && b !== 0 ? (a / b) * 100 : null;

function financialItems(periods: NormalizedPeriod[]) {
  const latest = periods[0]?.metrics ?? {};
  const prior = periods[1]?.metrics ?? {};
  const date = latestDate(periods);
  const strengths: IntelligenceItem[] = [], weaknesses: IntelligenceItem[] = [], catalysts: IntelligenceItem[] = [], risks: IntelligenceItem[] = [];
  const margin = pct(n(latest.netIncome ?? latest.netIncomeParent), n(latest.netRevenue ?? latest.revenue));
  const priorMargin = pct(n(prior.netIncome ?? prior.netIncomeParent), n(prior.netRevenue ?? prior.revenue));
  const roe = pct(n(latest.netIncome ?? latest.netIncomeParent), n(latest.equity));
  const debt = (n(latest.shortTermDebt) ?? 0) + (n(latest.longTermDebt) ?? 0);
  const leverage = pct(debt, n(latest.equity));
  const currentRatio = latest.currentAssets != null && latest.currentLiabilities ? latest.currentAssets / latest.currentLiabilities : null;
  const revenueGrowth = pct((n(latest.netRevenue ?? latest.revenue) ?? 0) - (n(prior.netRevenue ?? prior.revenue) ?? 0), n(prior.netRevenue ?? prior.revenue));
  const fcf = latest.freeCashFlow ?? (latest.operatingCashFlow != null && latest.capex != null ? latest.operatingCashFlow - Math.abs(latest.capex) : null);
  const fcfMargin = pct(n(fcf), n(latest.netRevenue ?? latest.revenue));
  if (roe != null && roe >= 12) strengths.push(item(`ROE ${roe.toFixed(1)}% cho thấy hiệu quả sử dụng vốn tốt`, "financial-statements", date, "high", "roe"));
  if (margin != null && margin >= 10) strengths.push(item(`Biên lợi nhuận ròng ${margin.toFixed(1)}%`, "financial-statements", date, "high", "net-margin"));
  if (currentRatio != null && currentRatio >= 1.2) strengths.push(item(`Thanh khoản ngắn hạn an toàn, current ratio ${currentRatio.toFixed(2)}x`, "financial-statements", date, "high", "current-ratio"));
  if (leverage != null && leverage <= 100) strengths.push(item(`Đòn bẩy vừa phải, nợ/vốn chủ ${leverage.toFixed(1)}%`, "financial-statements", date, "high", "debt-equity"));
  if (roe != null && roe < 8) weaknesses.push(item(`ROE chỉ ${roe.toFixed(1)}%, hiệu quả vốn còn thấp`, "financial-statements", date, "high", "roe"));
  if (margin != null && priorMargin != null && margin < priorMargin) weaknesses.push(item(`Biên lợi nhuận giảm từ ${priorMargin.toFixed(1)}% xuống ${margin.toFixed(1)}%`, "financial-statements", date, "high", "net-margin-trend"));
  if (currentRatio != null && currentRatio < 1) risks.push(item(`Current ratio ${currentRatio.toFixed(2)}x dưới 1, rủi ro thanh khoản`, "financial-statements", date, "high", "current-ratio"));
  if (leverage != null && leverage > 150) risks.push(item(`Nợ/vốn chủ ${leverage.toFixed(1)}% tạo áp lực lãi vay`, "financial-statements", date, "high", "debt-equity"));
  if (fcfMargin != null && fcfMargin < 0) risks.push(item(`Dòng tiền tự do âm (${fcfMargin.toFixed(1)}% doanh thu)`, "financial-statements", date, "medium", "free-cash-flow"));
  if (revenueGrowth != null && revenueGrowth > 10) catalysts.push(item(`Doanh thu tăng ${revenueGrowth.toFixed(1)}% so với kỳ trước`, "financial-statements", date, "high", "revenue-growth"));
  if (fcfMargin != null && fcfMargin > 5) catalysts.push(item(`Dòng tiền tự do dương, hỗ trợ tái đầu tư và cổ tức`, "financial-statements", date, "medium", "free-cash-flow"));
  return { strengths, weaknesses, catalysts, risks };
}

function newsItems(articles: Awaited<ReturnType<typeof getNews>> extends infer T ? T extends { articles: infer A } ? A : never : never) {
  const opportunities: IntelligenceItem[] = [], threats: IntelligenceItem[] = [], catalysts: IntelligenceItem[] = [], risks: IntelligenceItem[] = [];
  for (const a of articles.slice(0, 15)) {
    const text = `${a.title}${a.summary ? ` — ${a.summary}` : ""}`;
    const positive = /tăng trưởng|lợi nhuận|ký kết|mở rộng|đầu tư|trúng thầu|xuất khẩu|cổ tức|tích cực/i.test(text);
    const negative = /giảm|lỗ|phạt|thanh tra|nợ|trì hoãn|rủi ro|suy giảm|kiện/i.test(text);
    const x = item(a.title, "news", a.publishedAt, "medium", a.url);
    if (positive && !negative) { opportunities.push(x); catalysts.push(x); }
    if (negative) { threats.push(x); risks.push(x); }
  }
  return { opportunities: opportunities.slice(0, 5), threats: threats.slice(0, 5), catalysts: catalysts.slice(0, 5), risks: risks.slice(0, 5) };
}

function valueChain(industry: string | null | undefined) {
  const text = (industry ?? "").toLowerCase();
  if (!text) return null;
  if (/ngân hàng|bank/.test(text)) return { input: ["Tiền gửi và vốn huy động", "Dữ liệu khách hàng"], process: ["Tín dụng", "Thanh toán và ngân hàng số", "Quản trị rủi ro"], output: ["Thu nhập lãi", "Phí dịch vụ", "Sản phẩm tài chính"], source: "industry-profile:banking", derived: true };
  if (/bất động sản|real estate/.test(text)) return { input: ["Quỹ đất", "Vốn và pháp lý"], process: ["Phát triển dự án", "Xây dựng", "Bán hàng và bàn giao"], output: ["Sản phẩm nhà ở", "Doanh thu chuyển nhượng", "Dòng tiền cho thuê"], source: "industry-profile:real-estate", derived: true };
  if (/chứng khoán|securit/.test(text)) return { input: ["Vốn chủ sở hữu", "Dữ liệu thị trường"], process: ["Môi giới", "Tự doanh", "Tư vấn và ngân hàng đầu tư"], output: ["Phí giao dịch", "Lãi tự doanh", "Phí tư vấn"], source: "industry-profile:securities", derived: true };
  if (/thép|steel|sản xuất|manufactur|hóa chất|chemical/.test(text)) return { input: ["Nguyên vật liệu", "Năng lượng", "Vốn lưu động"], process: ["Sản xuất", "Kiểm soát chất lượng", "Phân phối"], output: ["Sản phẩm thành phẩm", "Doanh thu bán hàng", "Phụ phẩm"], source: "industry-profile:manufacturing", derived: true };
  return { input: ["Vốn, nhân lực và nhà cung cấp"], process: ["Vận hành theo mô hình ngành", "Bán hàng và phân phối"], output: ["Sản phẩm/dịch vụ", "Doanh thu và dòng tiền"], source: "industry-profile:generic", derived: true };
}

export async function getOrGenerateCompanyIntelligence(symbol: string): Promise<CompanyIntelligence | null> {
  const sym = symbol.toUpperCase();
  const res = await cached(`company-intelligence:${sym}:v1`, { ttlMs: 30 * 24 * 3_600_000, staleMs: 90 * 24 * 3_600_000, producer: async () => generate(sym) });
  return res.value;
}

async function generate(sym: string): Promise<CompanyIntelligence | null> {
  const [fin, news, market] = await Promise.all([fetchVndirectFinancials(sym, { limitPeriods: 4 }), getNews({ symbol: sym, limit: 20 }), getVnOhlcv(sym, 250)]);
  if (!fin && !news?.articles.length) return null;
  const f = fin ? financialItems(fin.periods) : { strengths: [], weaknesses: [], catalysts: [], risks: [] };
  const ni = news ? newsItems(news.articles) : { opportunities: [], threats: [], catalysts: [], risks: [] };
  const opportunities = [...ni.opportunities];
  const threats = [...ni.threats];
  const bars = market?.bars ?? [];
  if (bars.length >= 30) {
    const first = bars[0].close, last = bars.at(-1)?.close ?? first;
    const change = ((last / first) - 1) * 100;
    (change > 10 ? opportunities : threats).push(item(`Giá cổ phiếu ${change >= 0 ? "tăng" : "giảm"} ${Math.abs(change).toFixed(1)}% trong kỳ quan sát`, "stock-history", new Date(bars.at(-1)?.time ?? Date.now()).toISOString(), "low", "12m-return"));
  }
  return { symbol: sym, swot: { strengths: f.strengths, weaknesses: f.weaknesses, opportunities, threats }, catalysts: [...f.catalysts, ...ni.catalysts].slice(0, 8), risks: [...f.risks, ...ni.risks].slice(0, 8), valueChain: null, analyzedAt: new Date().toISOString(), sources: [fin ? "vndirect-financials" : "", news ? "rss-news" : "", market ? market.meta.source : ""].filter(Boolean), notes: ["SWOT và catalyst là suy luận định lượng từ BCTC, tin tức và giá; không phải khuyến nghị đầu tư."] };
}

export function resolveValueChain(industry: string | null | undefined) { return valueChain(industry); }
