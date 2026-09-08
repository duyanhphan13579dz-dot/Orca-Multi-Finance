import "server-only";
import { env } from "../env";
import { buildMeta, worstFreshness } from "../freshness";
import { getCryptoDetail } from "./crypto";
import { getForexDetail, fmtRate } from "./forex";
import { getCommodityMarket } from "./commodities";
import { vnstockConfigured } from "./stocks";
import { getNews } from "./news";
import { buildMarketSnapshot } from "./market";
import { buildStockAnalysis, computeConfidence, type Confidence } from "./intelligence";
import { llmChat, llmConfigured, type LlmResult } from "../ai/gateway";
import { collectFactNumbers, extractNumericClaims, validateOutput } from "../ai/validate";
import { qualityToLabel } from "../quality";
import { VN_TICKERS } from "../providers/news";
import type { FreshnessStatus, Meta } from "../types";

type Intent =
  | { kind: "crypto"; symbol: string }
  | { kind: "forex"; pair: string }
  | { kind: "vn-stock"; symbol: string }
  | { kind: "commodity"; query: string }
  | { kind: "market" }
  | { kind: "compare"; a: string; b: string }
  | { kind: "news"; query?: string }
  | { kind: "personal_finance" }
  | { kind: "wealth" }
  | { kind: "general" };

type Persona = "stock_analyst" | "personal_finance" | "wealth";

const KNOWN_CRYPTO = new Set(["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","TON","AVAX","LINK","DOT","TRX","LTC","BCH","NEAR","SUI","APT","ARB","OP","INJ","TIA","SEI","PEPE","SHIB","UNI","ATOM","FIL","ETC","AAVE","MKR","ALGO","VET","ICP","FET","RENDER","WLD","JUP","ENA","ONDO","POL","XLM","HBAR","KAS","TAO","IP","PI","ZEC","STRK","PAXG"]);
const FX_PAIRS = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURJPY","EURGBP","GBPJPY","AUDJPY","USDVND"];
const COMMODITY_WORDS: [RegExp, string][] = [[/vàng|gold/i, "gold"], [/bạc|silver/i, "silver"], [/dầu|oil|wti|brent/i, "oil"], [/cà phê|coffee/i, "coffee"], [/thép|steel/i, "steel"], [/đường|sugar/i, "sugar"], [/khí|gas|natgas/i, "natgas"], [/đồng\b|copper/i, "copper"]];

const PF_RE = /(?:còn|coa|còn lại)\s*[\d.,]+\s*k?|sống\s*\d+\s*tuần|sống\s*\d+\s*ngày|ngân sách|chi tiêu|tiết kiệm|quỹ dự phòng|mất việc|nợ thẻ|nợ xấu|trả nợ|vay tiêu dùng|DTI|lãi suất thẻ|tiền nhà trọ|lương|thu nhập cá nhân|bảo hiểm nhân thọ|thuế TNCN|thuế chứng khoán|nghỉ hưu|kết hôn.*tài chính|ly hôn.*tài chính|500k|triệu.*tháng|chi phí sinh hoạt|phân bổ.*tiền|còn lại.*đồng|tiêu trong\s*\d+\s*tháng|tiêu như thế nào/i;
const WEALTH_RE = /gia sản|danh mục.*tỷ|phân bổ tài sản|private wealth|family office|truyền thừa|thừa kế|tái cân bằng|rủi ro tập trung|định cư.*tài sản|đa tiền tệ|quỹ gia đình|exit.*công ty|80%\s*tài sản|tài sản ròng|net worth|asset allocation/i;

export interface AgentPrefs {
  depth?: "concise" | "standard" | "deep";
  style?: "analyst" | "technical" | "brief";
  language?: "vi" | "en";
  riskDisclosure?: "standard" | "detailed" | "off";
}

interface AgentAnswer {
  answer: string;
  mode: "deterministic" | "llm";
  intent: string;
  persona: Persona;
  model: string | null;
  confidence: Confidence;
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  dataFreshness: FreshnessStatus;
  context: { sectionsUsed: string[]; symbols: string[] };
}

interface Built {
  narrative: string;
  contract: Record<string, unknown>;
  sectionsUsed: string[];
  symbols: string[];
  freshnesses: FreshnessStatus[];
  unavailable?: boolean;
  persona: Persona;
}

function detectIntent(q: string): Intent {
  const upper = q.toUpperCase();
  if (WEALTH_RE.test(q)) return { kind: "wealth" };
  if (PF_RE.test(q)) return { kind: "personal_finance" };
  if (/so sánh|compare|\bvs\b|\bversus\b/i.test(q)) {
    const tokens = upper.match(/\b[A-Z]{2,10}\b/g) ?? [];
    const meaningful = tokens.filter((t) => KNOWN_CRYPTO.has(t) || VN_TICKERS.includes(t) || FX_PAIRS.includes(t));
    if (meaningful.length >= 2) return { kind: "compare", a: meaningful[0], b: meaningful[1] };
  }
  const usdt = upper.match(/\b([A-Z]{2,12})USDT\b/);
  if (usdt) return { kind: "crypto", symbol: `${usdt[1]}USDT` };
  const fxMatch = upper.match(/\b(EUR|GBP|USD|JPY|CHF|AUD|CAD|NZD|VND)[\s/]?(USD|JPY|CHF|CAD|NZD|EUR|GBP|AUD|VND)\b/);
  if (fxMatch) {
    const pair = (fxMatch[1] + fxMatch[2]).toUpperCase();
    if (FX_PAIRS.includes(pair)) return { kind: "forex", pair };
  }
  for (const t of upper.match(/\b[A-Z]{2,5}\b/g) ?? []) if (KNOWN_CRYPTO.has(t)) return { kind: "crypto", symbol: `${t}USDT` };
  for (const t of upper.match(/\b[A-Z]{3}\b/g) ?? []) if (VN_TICKERS.includes(t)) return { kind: "vn-stock", symbol: t };
  for (const [re, key] of COMMODITY_WORDS) if (re.test(q)) return { kind: "commodity", query: key };
  if (/thị trường|market|tổng quan|hôm nay|tình hình|đánh giá chung|bức tranh/i.test(q)) return { kind: "market" };
  if (/tin tức|news|sự kiện/i.test(q)) return { kind: "news" };
  return { kind: "general" };
}

function collectUserNumbers(question: string): Set<number> {
  const acc = new Set<number>();
  for (const c of extractNumericClaims(question)) if (Number.isFinite(c.value)) acc.add(Number(c.value.toPrecision(8)));
  for (const m of question.matchAll(/(\d+(?:[.,]\d+)?)\s*k\b/gi)) { const n = Number(String(m[1]).replace(",", ".")); if (Number.isFinite(n)) acc.add(Number((n * 1_000).toPrecision(8))); }
  for (const m of question.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:tr|triệu)\b/gi)) { const n = Number(String(m[1]).replace(",", ".")); if (Number.isFinite(n)) acc.add(Number((n * 1_000_000).toPrecision(8))); }
  for (const m of question.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:tỷ|ty|billion)\b/gi)) { const n = Number(String(m[1]).replace(",", ".")); if (Number.isFinite(n)) acc.add(Number((n * 1_000_000_000).toPrecision(8))); }
  return acc;
}

function parseMoneyHints(q: string): Record<string, number | null> {
  const out: Record<string, number | null> = { amount_vnd: null, days: null, weeks: null, months: null };
  const k = q.match(/(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (k) out.amount_vnd = Number(String(k[1]).replace(",", ".")) * 1_000;
  const plain = q.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:đồng|vnd|vnđ)?/i);
  if (out.amount_vnd == null && plain) { const n = Number(String(plain[1]).replace(/\./g, "").replace(",", "")); if (Number.isFinite(n) && n >= 1000) out.amount_vnd = n; }
  const tr = q.match(/(\d+(?:[.,]\d+)?)\s*(?:tr|triệu)/i);
  if (tr) out.amount_vnd = Number(String(tr[1]).replace(",", ".")) * 1_000_000;
  const ty = q.match(/(\d+(?:[.,]\d+)?)\s*(?:tỷ|ty)/i);
  if (ty) out.amount_vnd = Number(String(ty[1]).replace(",", ".")) * 1_000_000_000;
  const days = q.match(/(\d+)\s*ngày/i); if (days) out.days = Number(days[1]);
  const weeks = q.match(/(\d+)\s*tuần/i); if (weeks) out.weeks = Number(weeks[1]);
  const months = q.match(/(\d+)\s*tháng/i); if (months) out.months = Number(months[1]);
  return out;
}

const SYS_BASE = `Bạn là chuyên viên của ORCA Financial.
- CHỈ dùng số liệu trong STRUCTURED CONTEXT (gồm user_inputs/plan). Không dùng giá cũ từ model.
- Phân biệt FACT / INTERPRETATION / SCENARIO. Thiếu dữ liệu thì nói rõ.
- Văn phong tự nhiên, đủ ý; không nhãn máy móc.
- Tài chính cá nhân/gia sản: không dòng nguồn hay disclaimer dài.`;

const SYS_STOCK = `${SYS_BASE}

Vai trò: Chuyên gia phân tích cổ phiếu VN. Luận điểm → bằng chứng → rủi ro → theo dõi. Không khuyến nghị mua/bán tuyệt đối.`;

const SYS_PF = `${SYS_BASE}

Vai trò: Chuyên gia tài chính cá nhân tại Việt Nam. Dùng đúng số user_inputs/plan.
Khi có số dư + thời hạn phải:
1) Nêu trần chi /ngày và /tuần.
2) Chia nhóm ăn uống, đi lại, nhà-tiện ích, quỹ đệm, linh hoạt (kèm số).
3) Hướng dẫn phong bì tuần, trừ trước khoản cố định.
4) Cảnh báo tiêu sớm / vay nóng.
5) Hỏi thêm tối đa 2–3 thông tin để siết lịch.
Không disclaimer đầu tư. Không dòng "Nguồn:". Trả lời đủ ý, không sơ sài 2–3 câu.`;

const SYS_WEALTH = `${SYS_BASE}

Vai trò: Quản lý gia sản. Hỏi khẩu vị rủi ro / thời gian / thanh khoản / truyền thừa trước khi chốt %. Không one-size-fits-all. Pháp lý/thuế: nhắc luật sư.`;

function systemFor(persona: Persona): string {
  if (persona === "personal_finance") return SYS_PF;
  if (persona === "wealth") return SYS_WEALTH;
  return SYS_STOCK;
}

const trendVi: Record<string, string> = { "strong-up": "tăng mạnh", up: "tăng", sideways: "đi ngang tích lũy", down: "giảm", "strong-down": "giảm mạnh" };

async function buildPersonalFinance(question: string): Promise<Built> {
  const hints = parseMoneyHints(question);
  const days = hints.days ?? (hints.weeks != null ? hints.weeks * 7 : null);
  const amount = hints.amount_vnd;
  const horizonDays = days ?? (hints.months != null ? Math.round(hints.months * 30.4) : null);
  const perDay = amount != null && horizonDays != null && horizonDays > 0 ? Math.floor(amount / horizonDays) : null;
  const isEmergency = /còn\s*[\d.,]+\s*k|sống\s*\d+|mất việc|không còn thu nhập|chưa có tiền|hết tiền|nợ thẻ|không trả nổi/i.test(question);
  const weeks = horizonDays != null ? Math.max(1, Math.round(horizonDays / 7)) : null;
  const weekly = amount != null && weeks != null ? Math.floor(amount / weeks) : null;
  const foodDay = perDay != null ? Math.round(perDay * 0.55) : null;
  const transitDay = perDay != null ? Math.round(perDay * 0.12) : null;
  const utilDay = perDay != null ? Math.round(perDay * 0.13) : null;
  const bufferDay = perDay != null ? Math.round(perDay * 0.12) : null;
  const flexDay = perDay != null && foodDay != null && transitDay != null && utilDay != null && bufferDay != null ? Math.max(0, perDay - foodDay - transitDay - utilDay - bufferDay) : null;

  const contract: Record<string, unknown> = {
    scope: "personal_finance",
    persona: "personal_finance",
    user_inputs: { raw_question: question, amount_vnd: amount, days: horizonDays, weeks: hints.weeks ?? weeks, months: hints.months, per_day_budget_vnd: perDay, per_week_budget_vnd: weekly },
    plan: perDay != null ? { food_day: foodDay, transit_day: transitDay, utilities_day: utilDay, buffer_day: bufferDay, flexible_day: flexDay, weekly_envelope: weekly } : null,
    data_meta: { source: "user_question + orca-personal-finance-framework", freshness: "LIVE", fetched_at: new Date().toISOString() },
  };

  let narrative: string;
  if (isEmergency && amount != null && horizonDays != null && perDay != null) {
    narrative = [
      `Tình huống eo hẹp: ${amount.toLocaleString("vi-VN")}đ cho khoảng ${horizonDays} ngày → trần chi ~${perDay.toLocaleString("vi-VN")}đ/ngày (khoảng ${weekly?.toLocaleString("vi-VN") ?? "—"}đ/tuần).`,
      `Thứ tự ưu tiên:\n• Ăn uống tối thiểu — khoảng ${foodDay?.toLocaleString("vi-VN") ?? "—"}đ/ngày (tự nấu / suất rẻ, tránh order).\n• Đi lại cần thiết — khoảng ${transitDay?.toLocaleString("vi-VN") ?? "—"}đ/ngày; gom việc cùng tuyến.\n• Quỹ đệm — ~${bufferDay?.toLocaleString("vi-VN") ?? "—"}đ/ngày (gộp cả kỳ khoảng ${((bufferDay ?? 0) * horizonDays).toLocaleString("vi-VN")}đ) cho sự cố; không đụng trừ khi thật cần.\n• Giải trí / mua sắm / trả góp không đến hạn: tạm dừng.`,
      `Hóa đơn đến hạn (nhà, điện, thẻ): xin gia hạn hoặc trả tối thiểu trước khi chi linh hoạt. Tránh vay app lãi cao.`,
      `Bạn còn khoản thu nào trong ${horizonDays} ngày tới không? Có thì cộng vào ngân sách tuần, không chi hết số dư hiện tại.`,
    ].join("\n\n");
  } else if (amount != null && horizonDays != null && perDay != null && weekly != null) {
    const foodWeek = (foodDay ?? 0) * 7;
    const transitWeek = (transitDay ?? 0) * 7;
    const utilWeek = (utilDay ?? 0) * 7;
    const bufferWeek = (bufferDay ?? 0) * 7;
    const flexWeek = (flexDay ?? 0) * 7;
    const monthsLabel = hints.months ?? Math.round(horizonDays / 30);
    const nWeeks = Math.max(1, Math.round(horizonDays / 7));
    narrative = [
      `Bạn có ${amount.toLocaleString("vi-VN")}đ để xoay trong ~${horizonDays} ngày (${monthsLabel} tháng). Mức an toàn trung bình khoảng ${perDay.toLocaleString("vi-VN")}đ/ngày hoặc ${weekly.toLocaleString("vi-VN")}đ/tuần. Nên chi theo “phong bì tuần” thay vì xài tự do rồi siết cuối tháng.`,
      `Gợi ý chia theo tuần (lặp ${nWeeks} tuần):\n• Ăn uống: ~${foodWeek.toLocaleString("vi-VN")}đ/tuần (~${foodDay?.toLocaleString("vi-VN")}đ/ngày) — tự nấu, chợ theo danh sách, hạn chế đồ uống mang đi.\n• Đi lại: ~${transitWeek.toLocaleString("vi-VN")}đ/tuần — gom việc, tiết kiệm xăng/xe buýt.\n• Nhà cửa & tiện ích (nếu chưa trả riêng): ~${utilWeek.toLocaleString("vi-VN")}đ/tuần. Đã đóng đủ tiền nhà thì cộng khoản này vào quỹ đệm.\n• Quỹ đệm sự cố: ~${bufferWeek.toLocaleString("vi-VN")}đ/tuần (để riêng, không tiêu mua sắm).\n• Linh hoạt (xã giao tối thiểu, đồ dùng cần): ~${flexWeek.toLocaleString("vi-VN")}đ/tuần — hết phong bì là dừng.`,
      `Việc nên làm ngay:\n1) Chuyển đúng ${weekly.toLocaleString("vi-VN")}đ sang ví/tài khoản “chi tiêu tuần”, phần còn lại để nguyên.\n2) Ghi các khoản cố định sắp tới (nhà, điện, internet, trả góp) và trừ trước khỏi ${amount.toLocaleString("vi-VN")}đ nếu chưa trả.\n3) Tắt các lỗ thủng dễ phình: order đồ ăn, chuyển khoản xã giao lớn, mua online trả sau.\n4) Có thu nhập phụ thì cộng vào tuần hiện tại, không tăng chuẩn chi lâu dài ngay.`,
      `Rủi ro cần tránh: tiêu 40–50% trong 2 tuần đầu rồi “nhịn” tuần sau — dễ dẫn tới vay nóng. Giữ nhịp đều theo tuần sẽ ổn định hơn.\n\nNếu bạn cho biết (1) tiền nhà/điện đã trả chưa, (2) còn nợ thẻ/trả góp không, (3) có thu nhập trong kỳ — mình chỉnh lịch sát hơn, có thể chi tiết từng tuần.`,
    ].join("\n\n");
  } else if (amount != null) {
    narrative = `Bạn nêu khoảng ${amount.toLocaleString("vi-VN")}đ nhưng chưa rõ dùng trong bao lâu. Cho thêm khung thời gian (2 tuần / 1–2 tháng) và khoản đã chốt (tiền nhà, trả góp) để dựng lịch chi theo tuần.`;
  } else {
    narrative = "Để lập kế hoạch cụ thể cần: số tiền hiện có, khoảng thời gian xoay, và vài khoản cố định (nhà, điện, nợ). Bạn gửi ba ý đó giúp mình nhé.";
  }

  return { narrative, contract, sectionsUsed: ["personal-finance", "user-inputs"], symbols: [], freshnesses: ["LIVE"], persona: "personal_finance" };
}

async function buildWealth(question: string): Promise<Built> {
  const hints = parseMoneyHints(question);
  const amount = hints.amount_vnd;
  const contract: Record<string, unknown> = {
    scope: "wealth",
    persona: "wealth",
    user_inputs: { raw_question: question, amount_vnd: amount },
    framework: { requires_before_allocation: ["khẩu vị rủi ro", "khung thời gian", "nhu cầu thanh khoản", "mục tiêu truyền thừa"], concentration_risk_flag_pct: 30, rebalance_band_pct: 5 },
    data_meta: { source: "user_question + orca-wealth-framework", freshness: "LIVE", fetched_at: new Date().toISOString() },
  };
  const narrative = [
    amount != null ? `Quy mô khoảng ${amount.toLocaleString("vi-VN")}đ — không có danh mục chuẩn cho mọi người.` : "Câu hỏi quản lý gia sản — chưa có quy mô tài sản cụ thể.",
    "Trước khi đề xuất tỷ trọng cần: khẩu vị rủi ro, khung thời gian, nhu cầu thanh khoản gần nhất, mục tiêu truyền thừa (nếu có).",
    "Nguyên tắc: giảm tập trung; tái cân bằng khi lệch mục tiêu (~±5 điểm %); thuế/thừa kế/định cư — xác nhận với luật sư/chuyên gia thuế.",
  ].join("\n\n");
  return { narrative, contract, sectionsUsed: ["wealth", "user-inputs"], symbols: [], freshnesses: ["LIVE"], persona: "wealth" };
}

async function buildCrypto(sym: string): Promise<Built> {
  const sectionsUsed = ["crypto-detail", "technical"];
  const symbols = [sym];
  const freshnesses: FreshnessStatus[] = [];
  const r = await getCryptoDetail(sym, "1h");
  if (!r) return { narrative: `${sym}: dữ liệu không khả dụng từ Binance.`, contract: { asset: { symbol: sym, asset_type: "crypto" }, error: "unavailable" }, sectionsUsed, symbols, freshnesses, unavailable: true, persona: "stock_analyst" };
  freshnesses.push(r.meta.freshness);
  const { ticker, technical, funding, openInterest, fundingStatus } = r.detail;
  const news = await getNews({ symbol: sym.replace(/USDT$/, ""), limit: 3 });
  if (news?.articles.length) freshnesses.push(news.meta.freshness);
  const contract = {
    asset: { symbol: sym, asset_type: "crypto" },
    market_data: { price: ticker.price, change_24h_pct: ticker.changePercent, range_24h: { low: ticker.low, high: ticker.high }, quote_volume_24h_usd: ticker.quoteVolume },
    technical_state: technical ? { trend: technical.trend.label, trend_score: technical.trend.score, rsi14: technical.rsi14 != null ? Number(technical.rsi14.toFixed(1)) : null, returns: technical.returns, support: technical.support, resistance: technical.resistance, signals: technical.signals } : null,
    futures_state: funding ? { funding_rate_pct: Number((funding.fundingRate * 100).toFixed(4)), mark_price: funding.markPrice, open_interest: openInterest?.openInterest ?? null } : { status: "unavailable", what_is_known: fundingStatus },
    patterns: r.detail.patterns.map((p) => p.nameVi),
    news_context: (news?.articles ?? []).map((a) => ({ title: a.title, source: a.source })),
    data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() },
  };
  const t = technical;
  const narrative = [`${sym} — giá ${ticker.price.toLocaleString("en-US")} USDT, 24h ${ticker.changePercent != null ? ticker.changePercent.toFixed(2) + "%" : "?"}.`, t ? `Kỹ thuật: xu hướng ${trendVi[t.trend.label]}, RSI14 ${t.rsi14?.toFixed(1) ?? "?"}.` : "Chưa đủ chuỗi chỉ báo.", funding ? `Futures: funding ${(funding.fundingRate * 100).toFixed(4)}%.` : "Futures: không khả dụng."];
  return { narrative: narrative.filter(Boolean).join("\n\n"), contract, sectionsUsed, symbols, freshnesses, persona: "stock_analyst" };
}

async function buildForex(pair: string): Promise<Built> {
  const r = await getForexDetail(pair);
  if (!r) return { narrative: `Không lấy được dữ liệu ${pair}.`, contract: { asset: { symbol: pair, asset_type: "forex" }, error: "unavailable" }, sectionsUsed: [], symbols: [pair], freshnesses: [], unavailable: true, persona: "stock_analyst" };
  const d = r.detail;
  const contract = { asset: { symbol: d.pair, asset_type: "forex" }, market_data: d.current ? { price: d.current.price, change_pct_vs_prev_fix: d.current.changePercent } : null, technical_state: d.technical ? { trend: d.technical.trend.label, rsi14: d.technical.rsi14, returns: d.technical.returns, support: d.technical.support, resistance: d.technical.resistance, signals: d.technical.signals } : null, data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() } };
  const narrative = [d.current ? `${d.base}/${d.quote}: ${fmtRate(d.current.price)}.` : `${d.base}/${d.quote}: chỉ có chuỗi tham chiếu.`, d.technical ? `Kỹ thuật: xu hướng ${trendVi[d.technical.trend.label]}, RSI14 ${d.technical.rsi14?.toFixed(1) ?? "?"}.` : ""];
  return { narrative: narrative.filter(Boolean).join("\n\n"), contract, sectionsUsed: ["forex-detail", "technical"], symbols: [pair], freshnesses: [r.meta.freshness], persona: "stock_analyst" };
}

async function buildCommodity(kw: string): Promise<Built> {
  const r = await getCommodityMarket();
  const kwSymbols: Record<string, string[]> = { gold: ["XAUUSD", "SJC"], silver: ["XAGUSD"], oil: ["CL", "BZ"], natgas: ["NG"], copper: ["HG"], steel: ["HRC"], coffee: ["KC"], sugar: ["SB"] };
  const wanted = kwSymbols[kw] ?? [];
  if (!r) return { narrative: "Nguồn hàng hóa tạm không khả dụng.", contract: { error: "unavailable" }, sectionsUsed: [], symbols: [], freshnesses: [], unavailable: true, persona: "stock_analyst" };
  const rows = r.data.rows.filter((c) => wanted.includes(c.symbol));
  const contract = { asset: { symbol: kw, asset_type: "commodity" }, market_data: rows.map((c) => ({ name: c.commodity, symbol: c.symbol, price: c.price, unit: c.unit, change_pct: c.changePercent, sources: c.sourceRecords })), data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() } };
  const narrative = rows.length ? rows.map((c) => `${c.commodity}: ${c.price.toLocaleString("vi-VN")} ${c.unit ?? ""}`).join("\n\n") : `Nhóm "${kw}" chưa có nguồn khả dụng.`;
  return { narrative, contract, sectionsUsed: ["commodities"], symbols: rows.map((x) => x.symbol), freshnesses: [r.meta.freshness], persona: "stock_analyst" };
}

async function buildVn(symbol: string, deep: boolean): Promise<Built> {
  if (!vnstockConfigured()) {
    const news = await getNews({ symbol, limit: 3 });
    const ctx: Record<string, unknown> = { asset: { symbol, asset_type: "stock" }, status: "vnstock_not_configured" };
    if (news?.articles.length) ctx.news_context = news.articles.map((a) => ({ title: a.title, source: a.source }));
    return { narrative: `${symbol}: chưa có VNSTOCK_API_KEY — không suy diễn số liệu.` + (news?.articles.length ? `\n\nTin: ${news.articles.map((a) => a.title).join("; ")}.` : ""), contract: ctx, sectionsUsed: news?.articles.length ? ["news"] : [], symbols: [symbol], freshnesses: news ? [news.meta.freshness] : [], unavailable: true, persona: "stock_analyst" };
  }
  const analysis = await buildStockAnalysis(symbol);
  if (!analysis) return { narrative: `Không lấy được dữ liệu ${symbol}.`, contract: { asset: { symbol, asset_type: "stock" }, error: "provider_unavailable" }, sectionsUsed: [], symbols: [symbol], freshnesses: [], unavailable: true, persona: "stock_analyst" };
  const c = analysis.contract;
  const ms = c.market_state;
  const fh = c.fundamental_state?.financial_health;
  const v = c.fundamental_state?.valuation;
  const lines = [c.market_data ? `${symbol}: giá ${(c.market_data.price as number).toLocaleString("vi-VN")} (${(c.market_data.change_percent as number)?.toFixed(2) ?? "?"}%).` : `${symbol}.`, ms ? `Market state: ${ms.labelVi} — strength ${ms.strength}/100.` : "", fh && fh.scores.overall != null ? `Financial Health: ${fh.scores.overall}/100.` : "", v ? `Định giá: P/E ${v.multiples.pe ?? "—"}x · P/B ${v.multiples.pb ?? "—"}x.` : ""];
  return { narrative: lines.filter(Boolean).join("\n\n"), contract: c as unknown as Record<string, unknown>, sectionsUsed: ["vn-stock", "market-state-engine", "financial-health-engine", "valuation-engine"], symbols: [symbol], freshnesses: [analysis.meta.freshness], persona: "stock_analyst" };
}

async function buildMarket(): Promise<Built> {
  const snap = await buildMarketSnapshot();
  const p = snap.snapshot.pulse;
  const contract = { scope: "market_snapshot", pulse: { score: p.score, headline: p.headline, drivers: p.drivers }, sections_freshness: snap.meta.sections, indices: snap.snapshot.indices?.slice(0, 4) ?? null, crypto_summary: snap.snapshot.crypto?.summary ?? null, forex_note: snap.snapshot.forex?.usdStrengthNote ?? null, commodities: snap.snapshot.commodities?.filter((x) => ["XAUUSD", "CL", "SJC"].includes(x.symbol)) ?? null, news_top: snap.snapshot.news?.slice(0, 5).map((n) => ({ title: n.title, source: n.source })) ?? null, data_meta: { source: snap.meta.source, freshness: snap.meta.freshness, fetched_at: new Date().toISOString(), note: snap.meta.note } };
  return { narrative: `${p.headline}.\n\n${p.body.join("\n\n")}`, contract, sectionsUsed: ["market-snapshot", "pulse-engine"], symbols: [], freshnesses: Object.values(snap.meta.sections ?? {}), persona: "stock_analyst" };
}

export async function answerQuestion(question: string, prefs: AgentPrefs = {}): Promise<{ result: AgentAnswer; meta: Meta }> {
  const intent = detectIntent(question);
  const deep = prefs.depth === "deep";
  let built: Built;
  if (intent.kind === "personal_finance") built = await buildPersonalFinance(question);
  else if (intent.kind === "wealth") built = await buildWealth(question);
  else if (intent.kind === "crypto") built = await buildCrypto(intent.symbol);
  else if (intent.kind === "forex") built = await buildForex(intent.pair);
  else if (intent.kind === "commodity") built = await buildCommodity(intent.query);
  else if (intent.kind === "vn-stock") built = await buildVn(intent.symbol, deep);
  else if (intent.kind === "market" || intent.kind === "news" || intent.kind === "general") {
    built = await buildMarket();
    if (intent.kind === "news" && built.contract.news_top) {
      const tops = (built.contract as { news_top?: { title: string; source: string }[] }).news_top ?? [];
      built = { ...built, narrative: tops.length ? tops.map((a, i) => `${i + 1}. ${a.title} — ${a.source}`).join("\n") : "Chưa có tin nào trong luồng phù hợp." };
    }
  } else {
    const aIsCrypto = KNOWN_CRYPTO.has(intent.a.replace(/USDT$/, "")) || intent.a.endsWith("USDT");
    const bIsCrypto = KNOWN_CRYPTO.has(intent.b.replace(/USDT$/, "")) || intent.b.endsWith("USDT");
    const buildSide = async (s: string, crypto: boolean) => crypto ? buildCrypto(s.endsWith("USDT") ? s : `${s}USDT`) : FX_PAIRS.includes(s) ? buildForex(s) : buildVn(s, false);
    const [A, B] = await Promise.all([buildSide(intent.a, aIsCrypto), buildSide(intent.b, bIsCrypto)]);
    built = { narrative: `Đối chiếu:\n\n${A.narrative}\n\n${B.narrative}`, contract: { compare: [{ ...A.contract }, { ...B.contract }] }, sectionsUsed: [...new Set([...A.sectionsUsed, ...B.sectionsUsed])], symbols: [intent.a, intent.b], freshnesses: [...A.freshnesses, ...B.freshnesses], persona: "stock_analyst" };
  }

  let narrative = built.narrative;
  if (prefs.depth === "concise") narrative = narrative.split("\n\n").slice(0, 2).join("\n\n");
  const sys = systemFor(built.persona);
  let mode: AgentAnswer["mode"] = "deterministic";
  let model: string | null = null;
  let finalAnswer = narrative;
  let outputValidation: Meta["outputValidation"];
  const factNums = collectFactNumbers(built.contract);
  for (const n of collectUserNumbers(question)) factNums.add(n);
  const canLlm = llmConfigured() && !(built.unavailable && built.persona === "stock_analyst");
  if (canLlm) {
    const role = intent.kind === "compare" || intent.kind === "market" || intent.kind === "wealth" ? "reasoning" : "analysis";
    const styleVi = prefs.style === "technical" ? "súc tích, nhấn chỉ báo kỹ thuật" : prefs.style === "brief" ? "rất ngắn gọn (3-5 câu)" : "phân tích chuyên sâu, 2-4 đoạn mạch lạc";
    const user = built.persona === "personal_finance" || built.persona === "wealth"
      ? `CÂU HỎI: ${question}\n\nSTRUCTURED CONTEXT:\n${JSON.stringify(built.contract, null, 1).slice(0, 11_000)}\n\nYêu cầu: trả lời đủ ý, dùng đúng số user_inputs/plan, lịch chi theo ngày/tuần, có bước hành động. Không template 50/30/20 suông. Không dòng Nguồn/disclaimer.`
      : `CÂU HỎI: ${question}\n\nSTRUCTURED CONTEXT:\n${JSON.stringify(built.contract, null, 1).slice(0, 11_000)}\n\nTrả lời — phong cách: ${styleVi}.`;
    const first = await llmChat(role, { system: sys, user, temperature: 0.35, maxTokens: prefs.depth === "deep" ? 1400 : 1100 });
    if (first) {
      const use = await validateMaybeRepair(first, user, factNums, role, sys);
      if (use.text) { finalAnswer = use.text; mode = "llm"; model = first.model; outputValidation = use.validation; }
      else outputValidation = use.validation;
    }
  }
  if (built.persona === "stock_analyst") {
    if (prefs.riskDisclosure === "standard" && mode === "deterministic") finalAnswer += "\n\n— Phân tích định lượng từ dữ liệu thật, phục vụ nghiên cứu; không phải khuyến nghị đầu tư.";
    else if (prefs.riskDisclosure === "detailed") finalAnswer += "\n\n— Lưu ý rủi ro: nội dung sinh ra từ dữ liệu tại thời điểm trả lời; không phải khuyến nghị đầu tư.";
  }
  const dataFreshness = built.freshnesses.length ? worstFreshness(built.freshnesses) : built.unavailable ? "UNAVAILABLE" : "LIVE";
  const confidence = computeConfidence({ freshness: built.freshnesses, coverage: built.unavailable ? 0 : 1 });
  const meta = buildMeta({ source: mode === "llm" ? `orca-agent + ${model}` : "orca-agent (deterministic)", sourceTimestampMs: Date.now(), note: `Persona: ${built.persona}` });
  meta.freshness = dataFreshness;
  meta.outputValidation = outputValidation;
  meta.qualityStatus = built.unavailable ? "STALE" : "VALID";
  return { result: { answer: finalAnswer, mode, intent: intent.kind, persona: built.persona, model, confidence, dataQuality: qualityToLabel(meta.qualityStatus), dataFreshness, context: { sectionsUsed: built.sectionsUsed, symbols: built.symbols } }, meta };
}

async function validateMaybeRepair(first: LlmResult, user: string, facts: Set<number>, role: "reasoning" | "analysis", sys: string): Promise<{ text: string | null; model: string; validation: Meta["outputValidation"] }> {
  let val = validateOutput(first.text, facts);
  if (val.ok) return { text: first.text, model: first.model, validation: { validated: true, unsupportedClaims: 0 } };
  const regen = await llmChat(role, { system: `${sys}\nSTRICT: chỉ dùng số trong context (gồm user_inputs). Số không hợp lệ trước: ${val.unsupported.slice(0, 5).map((u) => u.raw).join(", ")}.`, user, temperature: 0.2, maxTokens: 1100 });
  if (!regen) return { text: null, model: first.model, validation: { validated: false, unsupportedClaims: val.unsupported.length, recovered: "deterministic" } };
  val = validateOutput(regen.text, facts);
  if (val.ok) return { text: regen.text, model: first.model, validation: { validated: true, unsupportedClaims: 0, recovered: "regenerated" } };
  return { text: null, model: first.model, validation: { validated: false, unsupportedClaims: val.unsupported.length, recovered: "deterministic-fallback" } };
}

export { env };
