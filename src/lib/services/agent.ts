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
import {
  formatTopicMemory,
  isFollowUpCue,
  sameTopicFamily,
  type HistoryTurn,
  type TopicKey,
  type TopicSlot,
} from "./agent-memory";

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
const WEALTH_RE = /gia sản|danh mục.*tỷ|phân bổ tài sản|private wealth|family office|truyền thừa|thừa kế|tái cân bằng|rủi ro tập trung|định cư.*tài sản|đa tiền tệ|quỹ gia đình|exit.*công ty|80%\s*tài sản|tài sản ròng|net worth|asset allocation|phân bổ.*tài sản/i;

export interface AgentPrefs {
  depth?: "concise" | "standard" | "deep";
  style?: "analyst" | "technical" | "brief";
  language?: "vi" | "en";
  riskDisclosure?: "standard" | "detailed" | "off";
}

export type AgentHistoryTurn = HistoryTurn;

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

function intentTopic(intent: Intent): TopicKey {
  return intent.kind as TopicKey;
}

function lastStickyIntent(history: AgentHistoryTurn[]): Intent | null {
  for (const turn of [...history].reverse().filter((h) => h.role === "user").slice(0, 6)) {
    const prev = detectIntent(turn.content);
    if (prev.kind !== "general" && prev.kind !== "market" && prev.kind !== "news") return prev;
  }
  for (const turn of [...history].reverse().filter((h) => h.role === "assistant" || h.role === "agent").slice(0, 3)) {
    if (/phong bì tuần|đ\/ngày|đ\/tuần|quỹ đệm|chi tiêu tuần/i.test(turn.content)) return { kind: "personal_finance" };
    if (/khẩu vị rủi ro|gia sản|tỷ trọng|tái cân bằng|lớp tài sản|thanh khoản cao/i.test(turn.content)) return { kind: "wealth" };
    const m = turn.content.toUpperCase().match(/\b(BTC|ETH|SOL|BNB)(?:USDT)?\b/);
    if (m) return { kind: "crypto", symbol: `${m[1]}USDT` };
  }
  return null;
}

function resolveIntent(question: string, history: AgentHistoryTurn[]): Intent {
  const direct = detectIntent(question);
  if (direct.kind !== "general" && direct.kind !== "market") return direct;
  const sticky = lastStickyIntent(history);
  if (!sticky) return direct;
  const stickyTopic = intentTopic(sticky);
  if (direct.kind !== "general" && !sameTopicFamily(stickyTopic, intentTopic(direct)) && !isFollowUpCue(question)) return direct;
  if (isFollowUpCue(question) || direct.kind === "general") return sticky;
  return direct;
}

function buildTopicMemory(history: AgentHistoryTurn[]): TopicSlot[] {
  const map = new Map<TopicKey, TopicSlot>();
  for (const h of history) {
    if (h.role !== "user") continue;
    const intent = detectIntent(h.content);
    if (intent.kind === "general") continue;
    const topic = intentTopic(intent);
    const hints = parseMoneyHints(h.content);
    const symbols: string[] = [];
    if (intent.kind === "crypto") symbols.push(intent.symbol);
    if (intent.kind === "forex") symbols.push(intent.pair);
    if (intent.kind === "vn-stock") symbols.push(intent.symbol);
    if (intent.kind === "compare") symbols.push(intent.a, intent.b);
    const horizon =
      hints.months != null ? `${hints.months} tháng` : hints.weeks != null ? `${hints.weeks} tuần` : hints.days != null ? `${hints.days} ngày` : null;
    map.set(topic, { topic, symbols, summary: h.content.trim().slice(0, 220), amount_vnd: hints.amount_vnd, horizon });
  }
  return [...map.values()];
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
- Tài chính cá nhân/gia sản: không dòng nguồn hay disclaimer dài.
- Đa chủ đề: giữ đúng slot chủ đề đang hỏi; không trộn ràng buộc chủ đề khác trừ khi user liên kết rõ.`;

const SYS_STOCK = `${SYS_BASE}

Vai trò: Chuyên gia phân tích cổ phiếu VN. Luận điểm → bằng chứng → rủi ro → theo dõi. Không khuyến nghị mua/bán tuyệt đối.

Few-shot market:
Q: "Thị trường đang diễn ra chuyện gì?"
A: Dùng STRUCTURED CONTEXT.pulse (headline, score, drivers, body), indices, crypto_summary, forex_note. Viết 3-4 đoạn, mỗi đoạn 2-3 câu, dùng số thật, không bịa.
Q: "Phân tích BTC hiện tại"
A: Dùng market_data (price, change_24h_pct, range, volume), technical_state (trend, RSI, support/resistance), futures_state. Viết 2-3 đoạn, kèm rủi ro.`;

const SYS_PF = `${SYS_BASE}

Vai trò: Chuyên gia tài chính cá nhân tại Việt Nam. Dùng đúng số user_inputs/plan. Khi có số dư + thời hạn: trần chi /ngày và /tuần; chia nhóm; phong bì tuần; cảnh báo tiêu sớm/vay nóng. Không disclaimer.`;

const SYS_WEALTH = `${SYS_BASE}

Vai trò: Chuyên gia quản lý gia sản (private wealth) tại Việt Nam.
Quy tắc:
1) Không danh mục one-size-fits-all cứng. Nêu giả định khẩu vị nếu user chưa nói.
2) Đưa dải % theo lớp: thanh khoản / thu nhập cố định / tăng trưởng / vệ tinh — kèm lý do.
3) Đánh đổi lợi nhuận–rủi ro–thanh khoản; cảnh báo tập trung >30%.
4) Pháp lý/thuế/thừa kế: nguyên tắc + nhắc luật sư/chuyên gia thuế.
5) Trả lời đủ ý (nhiều đoạn), không 3 câu sáo rỗng.

Few-shot:
Hỏi: "Nếu tôi có 100 triệu thì nên phân bổ tài sản như thế nào?"
Trả: "Với ~100 triệu đồng, cần biết: (1) có phải toàn bộ tài sản ròng không, (2) bao nhiêu cần rút trong 12 tháng, (3) khẩu vị bảo thủ/cân bằng/tăng trưởng.
Giả định tạm: trung hạn, chưa rút lớn trong 1 năm, khẩu vị cân bằng:
• 25–35% thanh khoản cao (tiền gửi, quỹ thị trường tiền tệ).
• 25–35% thu nhập tương đối ổn (trái phiếu/quỹ trái phiếu).
• 25–35% tăng trưởng (cổ phiếu/quỹ cổ phiếu đa dạng — tránh 1 mã).
• 0–10% vệ tinh (vàng; crypto ≤5% nếu chấp nhận biến động mạnh).
Giữ 3–6 tháng chi phí ngoài danh mục; giải ngân chia 3–4 đợt. Cho khẩu vị và thời điểm dùng tiền để siết dải %."
`;

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
    scope: "personal_finance", persona: "personal_finance",
    user_inputs: { raw_question: question, amount_vnd: amount, days: horizonDays, weeks: hints.weeks ?? weeks, months: hints.months, per_day_budget_vnd: perDay, per_week_budget_vnd: weekly },
    plan: perDay != null ? { food_day: foodDay, transit_day: transitDay, utilities_day: utilDay, buffer_day: bufferDay, flexible_day: flexDay, weekly_envelope: weekly } : null,
    data_meta: { source: "user_question + orca-personal-finance-framework", freshness: "LIVE", fetched_at: new Date().toISOString() },
  };
  let narrative: string;
  if (isEmergency && amount != null && horizonDays != null && perDay != null) {
    narrative = [`Tình huống eo hẹp: ${amount.toLocaleString("vi-VN")}đ / ${horizonDays} ngày → ~${perDay.toLocaleString("vi-VN")}đ/ngày (~${weekly?.toLocaleString("vi-VN") ?? "—"}đ/tuần).`, `Ưu tiên: ăn ~${foodDay?.toLocaleString("vi-VN")}đ/ngày; đi lại ~${transitDay?.toLocaleString("vi-VN")}đ/ngày; quỹ đệm ~${bufferDay?.toLocaleString("vi-VN")}đ/ngày.`, `Hóa đơn đến hạn: xin gia hạn. Tránh vay app. Còn khoản thu trong kỳ không?`].join("\n\n");
  } else if (amount != null && horizonDays != null && perDay != null && weekly != null) {
    const nWeeks = Math.max(1, Math.round(horizonDays / 7));
    const monthsLabel = hints.months ?? Math.round(horizonDays / 30);
    narrative = [
      `Bạn có ${amount.toLocaleString("vi-VN")}đ trong ~${horizonDays} ngày (${monthsLabel} tháng) → ~${perDay.toLocaleString("vi-VN")}đ/ngày hoặc ${weekly.toLocaleString("vi-VN")}đ/tuần. Nên dùng phong bì tuần.`,
      `Chia tuần (×${nWeeks}): ăn ~${((foodDay ?? 0) * 7).toLocaleString("vi-VN")}đ; đi lại ~${((transitDay ?? 0) * 7).toLocaleString("vi-VN")}đ; nhà/tiện ích ~${((utilDay ?? 0) * 7).toLocaleString("vi-VN")}đ; đệm ~${((bufferDay ?? 0) * 7).toLocaleString("vi-VN")}đ; linh hoạt ~${((flexDay ?? 0) * 7).toLocaleString("vi-VN")}đ.`,
      `Làm ngay: (1) chuyển ${weekly.toLocaleString("vi-VN")}đ sang ví tuần; (2) trừ trước khoản cố định; (3) tắt order/trả sau; (4) thu phụ cộng vào tuần hiện tại.`,
      `Tránh tiêu 40–50% trong 2 tuần đầu. Cho biết tiền nhà đã trả chưa, nợ thẻ/trả góp, thu nhập trong kỳ để siết lịch.`,
    ].join("\n\n");
  } else if (amount != null) {
    narrative = `Khoảng ${amount.toLocaleString("vi-VN")}đ — cần thêm khung thời gian và khoản cố định để dựng lịch tuần.`;
  } else {
    narrative = "Cần số tiền hiện có, thời gian xoay, và vài khoản cố định (nhà, điện, nợ).";
  }
  return { narrative, contract, sectionsUsed: ["personal-finance", "user-inputs"], symbols: [], freshnesses: ["LIVE"], persona: "personal_finance" };
}

async function buildWealth(question: string): Promise<Built> {
  const hints = parseMoneyHints(question);
  const amount = hints.amount_vnd;
  const riskHint = /bảo thủ|an toàn|thấp rủi ro/i.test(question)
    ? "conservative"
    : /tăng trưởng|mạo hiểm|cao rủi ro|aggressive/i.test(question)
      ? "growth"
      : /cân bằng|trung bình/i.test(question)
        ? "balanced"
        : null;

  const bands =
    riskHint === "conservative"
      ? { cash: [40, 50], fixed: [30, 40], growth: [10, 20], satellite: [0, 5] }
      : riskHint === "growth"
        ? { cash: [10, 20], fixed: [10, 20], growth: [50, 65], satellite: [5, 15] }
        : { cash: [25, 35], fixed: [25, 35], growth: [25, 35], satellite: [0, 10] };

  const tier =
    amount == null ? "unknown" : amount >= 10_000_000_000 ? "hnw" : amount >= 1_000_000_000 ? "affluent" : amount >= 100_000_000 ? "mass_affluent" : "starter";

  const contract: Record<string, unknown> = {
    scope: "wealth",
    persona: "wealth",
    user_inputs: { raw_question: question, amount_vnd: amount, risk_hint: riskHint, tier },
    framework: {
      requires_before_allocation: ["khẩu vị rủi ro", "khung thời gian", "nhu cầu thanh khoản", "mục tiêu truyền thừa"],
      concentration_risk_flag_pct: 30,
      rebalance_band_pct: 5,
      reference_bands_pct: bands,
      layers: ["thanh khoản cao", "thu nhập cố định", "tăng trưởng", "vệ tinh"],
    },
    data_meta: {
      source: "user_question + orca-wealth-framework",
      freshness: "LIVE",
      fetched_at: new Date().toISOString(),
      note: "Dải % là khung tham chiếu có điều kiện — không phải danh mục chuẩn.",
    },
  };

  const riskLabel =
    riskHint === "conservative" ? "bảo thủ" : riskHint === "growth" ? "tăng trưởng" : riskHint === "balanced" ? "cân bằng" : "cân bằng (giả định tạm)";

  let narrative: string;
  if (amount != null) {
    const amt = amount.toLocaleString("vi-VN");
    narrative = [
      `Với quy mô khoảng ${amt}đ, không có danh mục “chuẩn” áp cho mọi người. Phân bổ phụ thuộc khẩu vị rủi ro, thời điểm cần dùng tiền, và mức tập trung tài sản hiện tại (nhà, một mã cổ phiếu, kinh doanh…).`,
      `Giả định làm việc (bạn có thể chỉnh): khẩu vị ${riskLabel}; chưa cần rút phần lớn trong 12 tháng; đây là phần có thể đưa vào kế hoạch đầu tư (đã tách quỹ sinh hoạt 3–6 tháng nếu có).`,
      `Khung tham chiếu theo lớp tài sản (dải %, không phải lệnh mua):\n• Thanh khoản cao (tiền gửi, quỹ thị trường tiền tệ): ${bands.cash[0]}–${bands.cash[1]}% — đệm chi tiêu và cơ hội giải ngân dần.\n• Thu nhập tương đối ổn (trái phiếu / quỹ trái phiếu / kỳ hạn): ${bands.fixed[0]}–${bands.fixed[1]}%.\n• Tăng trưởng (cổ phiếu / quỹ cổ phiếu đa dạng — tránh dồn một mã): ${bands.growth[0]}–${bands.growth[1]}%.\n• Vệ tinh (vàng; crypto chỉ khi chấp nhận biến động mạnh và thường ≤5%): ${bands.satellite[0]}–${bands.satellite[1]}%.`,
      `Cách triển khai thực tế:\n1) Không giải ngân một lần — chia 3–4 đợt trong vài tháng.\n2) Nếu đang >30% tài sản ở một mã / một BĐS, ưu tiên giảm tập trung trước khi thêm rủi ro mới.\n3) Tái cân bằng khi lệch mục tiêu khoảng ±5 điểm % hoặc định kỳ 6–12 tháng.\n4) Thuế / thừa kế / chuyển tài sản: nguyên tắc chung — cần luật sư hoặc chuyên gia thuế xác nhận trước khi thực hiện.`,
      `Để siết dải % sát hơn, cho mình biết: (1) bảo thủ / cân bằng / tăng trưởng, (2) bao nhiêu % cần dùng trong 1–2 năm, (3) tài sản hiện tại có đang dồn một chỗ không.`,
    ].join("\n\n");
  } else {
    narrative = [
      "Câu hỏi quản lý gia sản — chưa có quy mô tài sản cụ thể.",
      "Trước khi đề xuất tỷ trọng: khẩu vị rủi ro, khung thời gian, nhu cầu thanh khoản, mục tiêu truyền thừa (nếu có).",
      "Nguyên tắc: đa dạng hoá; tái cân bằng ~±5 điểm %; pháp lý/thuế/thừa kế cần chuyên gia xác nhận.",
    ].join("\n\n");
  }

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
  const tech = technical;
  const narrative = [`${sym} — giá ${ticker.price.toLocaleString("en-US")} USDT, 24h ${ticker.changePercent != null ? ticker.changePercent.toFixed(2) + "%" : "?"}.`, tech ? `Kỹ thuật: xu hướng ${trendVi[tech.trend.label]}, RSI14 ${tech.rsi14?.toFixed(1) ?? "?"}.` : "Chưa đủ chuỗi chỉ báo.", funding ? `Futures: funding ${(funding.fundingRate * 100).toFixed(4)}%.` : "Futures: không khả dụng."];
  return { narrative: narrative.filter(Boolean).join("\n\n"), contract, sectionsUsed, symbols, freshnesses, persona: "stock_analyst" };
}

async function buildForex(pair: string): Promise<Built> {
  const r = await getForexDetail(pair);
  if (!r) return { narrative: `Không lấy được dữ liệu ${pair}.`, contract: { asset: { symbol: pair, asset_type: "forex" }, error: "unavailable" }, sectionsUsed: [], symbols: [pair], freshnesses: [], unavailable: true, persona: "stock_analyst" };
  const d = r.detail;
  const contract = { asset: { symbol: d.pair, asset_type: "forex" }, market_data: d.current ? { price: d.current.price, change_pct_vs_prev_close: d.current.changePercent } : null, technical_state: d.technical ? { trend: d.technical.trend.label, rsi14: d.technical.rsi14, returns: d.technical.returns, support: d.technical.support, resistance: d.technical.resistance, signals: d.technical.signals } : null, data_meta: { source: r.meta.source, freshness: r.meta.freshness, fetched_at: new Date().toISOString() } };
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
    return { narrative: `${symbol}: chưa có VNSTOCK_API_KEY.` + (news?.articles.length ? `\n\nTin: ${news.articles.map((a) => a.title).join("; ")}.` : ""), contract: ctx, sectionsUsed: news?.articles.length ? ["news"] : [], symbols: [symbol], freshnesses: news ? [news.meta.freshness] : [], unavailable: true, persona: "stock_analyst" };
  }
  const analysis = await buildStockAnalysis(symbol);
  if (!analysis) return { narrative: `Không lấy được dữ liệu ${symbol}.`, contract: { asset: { symbol, asset_type: "stock" }, error: "provider_unavailable" }, sectionsUsed: [], symbols: [symbol], freshnesses: [], unavailable: true, persona: "stock_analyst" };
  const c = analysis.contract;
  const ms = c.market_state;
  const fh = c.fundamental_state?.financial_health;
  const v = c.fundamental_state?.valuation;
  const lines = [c.market_data ? `${symbol}: giá ${(c.market_data.price as number).toLocaleString("vi-VN")} (${(c.market_data.change_percent as number)?.toFixed(2) ?? "?"}%).` : `${symbol}.`, ms ? `Market state: ${ms.labelVi} — strength ${ms.strength}/100.` : "", fh && fh.scores.overall != null ? `Financial Health: ${fh.scores.overall}/100.` : "", v ? `Định giá: P/E ${v.multiples.pe ?? "—"}x · P/B ${v.multiples.pb ?? "—"}x.` : ""];
  return { narrative: lines.filter(Boolean).join("\n\n"), contract: c as unknown as Record<string, unknown>, sectionsUsed: ["vn-stock", "market-state-engine"], symbols: [symbol], freshnesses: [analysis.meta.freshness], persona: "stock_analyst" };
}

async function buildMarket(): Promise<Built> {
  const snap = await buildMarketSnapshot();
  const p = snap.snapshot.pulse;
  const contract = { scope: "market_snapshot", pulse: { score: p.score, headline: p.headline, drivers: p.drivers }, sections_freshness: snap.meta.sections, indices: snap.snapshot.indices?.slice(0, 4) ?? null, crypto_summary: snap.snapshot.crypto?.summary ?? null, forex_note: snap.snapshot.forex?.usdStrengthNote ?? null, commodities: snap.snapshot.commodities?.filter((x) => ["XAUUSD", "CL", "SJC"].includes(x.symbol)) ?? null, news_top: snap.snapshot.news?.slice(0, 5).map((n) => ({ title: n.title, source: n.source })) ?? null, data_meta: { source: snap.meta.source, freshness: snap.meta.freshness, fetched_at: new Date().toISOString(), note: snap.meta.note } };
  return { narrative: `${p.headline}.\n\n${p.body.join("\n\n")}`, contract, sectionsUsed: ["market-snapshot", "pulse-engine"], symbols: [], freshnesses: Object.values(snap.meta.sections ?? {}), persona: "stock_analyst" };
}

export async function answerQuestion(question: string, prefs: AgentPrefs = {}, history: AgentHistoryTurn[] = []): Promise<{ result: AgentAnswer; meta: Meta }> {
  const intent = resolveIntent(question, history);
  const topicMemory = buildTopicMemory(history);
  const memoryBlock = formatTopicMemory(topicMemory);
  const sameTopicUserLines = history.filter((h) => h.role === "user" && detectIntent(h.content).kind === intent.kind).slice(-3).map((h) => h.content);
  const contextQuestion = intent.kind === "personal_finance" || intent.kind === "wealth" ? `${sameTopicUserLines.join("\n")}\n${question}`.trim() : question;
  const deep = prefs.depth === "deep";
  let built: Built;
  if (intent.kind === "personal_finance") built = await buildPersonalFinance(contextQuestion);
  else if (intent.kind === "wealth") built = await buildWealth(contextQuestion);
  else if (intent.kind === "crypto") built = await buildCrypto(intent.symbol);
  else if (intent.kind === "forex") built = await buildForex(intent.pair);
  else if (intent.kind === "commodity") built = await buildCommodity(intent.query);
  else if (intent.kind === "vn-stock") built = await buildVn(intent.symbol, deep);
  else if (intent.kind === "market" || intent.kind === "news" || intent.kind === "general") {
    built = await buildMarket();
    if (intent.kind === "news" && built.contract.news_top) {
      const tops = (built.contract as { news_top?: { title: string; source: string }[] }).news_top ?? [];
      built = { ...built, narrative: tops.length ? tops.map((a, i) => `${i + 1}. ${a.title} — ${a.source}`).join("\n") : "Chưa có tin phù hợp." };
    }
  } else {
    const aIsCrypto = KNOWN_CRYPTO.has(intent.a.replace(/USDT$/, "")) || intent.a.endsWith("USDT");
    const bIsCrypto = KNOWN_CRYPTO.has(intent.b.replace(/USDT$/, "")) || intent.b.endsWith("USDT");
    const buildSide = async (s: string, crypto: boolean) => crypto ? buildCrypto(s.endsWith("USDT") ? s : `${s}USDT`) : FX_PAIRS.includes(s) ? buildForex(s) : buildVn(s, false);
    const [A, B] = await Promise.all([buildSide(intent.a, aIsCrypto), buildSide(intent.b, bIsCrypto)]);
    built = { narrative: `Đối chiếu:\n\n${A.narrative}\n\n${B.narrative}`, contract: { compare: [{ ...A.contract }, { ...B.contract }] }, sectionsUsed: [...new Set([...A.sectionsUsed, ...B.sectionsUsed])], symbols: [intent.a, intent.b], freshnesses: [...A.freshnesses, ...B.freshnesses], persona: "stock_analyst" };
  }

  built.contract = { ...built.contract, conversation_memory: { active_topic: intent.kind, slots: topicMemory, note: "Chỉ dùng slot trùng active_topic hoặc được user liên kết rõ." } };

  let narrative = built.narrative;
  if (prefs.depth === "concise") narrative = narrative.split("\n\n").slice(0, 2).join("\n\n");
  const sys = systemFor(built.persona);
  let mode: AgentAnswer["mode"] = "deterministic";
  let model: string | null = null;
  let finalAnswer = narrative;
  let outputValidation: Meta["outputValidation"];
  const factNums = collectFactNumbers(built.contract);
  for (const n of collectUserNumbers(question)) factNums.add(n);
  for (const h of history) if (h.role === "user") for (const n of collectUserNumbers(h.content)) factNums.add(n);

  const canLlm = llmConfigured() && !(built.unavailable && built.persona === "stock_analyst");
  if (canLlm) {
    const role = intent.kind === "compare" || intent.kind === "market" || intent.kind === "wealth" ? "reasoning" : "analysis";
    const styleVi = prefs.style === "technical" ? "súc tích, nhấn chỉ báo" : prefs.style === "brief" ? "rất ngắn (3-5 câu)" : "chuyên sâu, mạch lạc";
    const memLine = memoryBlock ? `\n\nBỘ NHỚ ĐA CHỦ ĐỀ:\n${memoryBlock}` : "";
    const user = built.persona === "personal_finance" || built.persona === "wealth"
      ? `CÂU HỎI HIỆN TẠI: ${question}${memLine}\n\nSTRUCTURED CONTEXT:\n${JSON.stringify(built.contract, null, 1).slice(0, 11_000)}\n\nActive topic: ${intent.kind}. Trả lời ĐỦ Ý theo khung (dải % lớp tài sản hoặc lịch chi cụ thể, giả định, bước triển khai). Không 3 câu sáo. Không disclaimer.`
      : `CÂU HỎI: ${question}${memLine}\n\nSTRUCTURED CONTEXT:\n${JSON.stringify(built.contract, null, 1).slice(0, 11_000)}\n\nPhong cách: ${styleVi}. Active: ${intent.kind}.`;
    const tagged = history.filter((h) => h.content?.trim());
    const sameTopic = tagged.filter((h) => h.role !== "user" || detectIntent(h.content).kind === intent.kind || detectIntent(h.content).kind === "general");
    const chatHistory = (sameTopic.length >= 2 ? sameTopic : tagged).slice(-8).map((h) => ({ role: (h.role === "user" ? "user" : "assistant") as "user" | "assistant", content: h.content.trim().slice(0, 2_500) }));
    const first = await llmChat(role, { system: sys, user, history: chatHistory, temperature: 0.35, maxTokens: prefs.depth === "deep" ? 1400 : 1100 });
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
  const meta = buildMeta({ source: mode === "llm" ? `orca-agent + ${model}` : "orca-agent (deterministic)", sourceTimestampMs: Date.now(), note: `Persona: ${built.persona} · topic: ${intent.kind}` });
  meta.freshness = dataFreshness;
  meta.outputValidation = outputValidation;
  meta.qualityStatus = built.unavailable ? "STALE" : "VALID";
  return { result: { answer: finalAnswer, mode, intent: intent.kind, persona: built.persona, model, confidence, dataQuality: qualityToLabel(meta.qualityStatus), dataFreshness, context: { sectionsUsed: built.sectionsUsed, symbols: built.symbols } }, meta };
}

async function validateMaybeRepair(first: LlmResult, user: string, facts: Set<number>, role: "reasoning" | "analysis", sys: string): Promise<{ text: string | null; model: string; validation: Meta["outputValidation"] }> {
  let val = validateOutput(first.text, facts);
  if (val.ok) return { text: first.text, model: first.model, validation: { validated: true, unsupportedClaims: 0 } };
  const regen = await llmChat(role, { system: `${sys}\nSTRICT: chỉ dùng số trong context. Sai trước: ${val.unsupported.slice(0, 5).map((u) => u.raw).join(", ")}.`, user, temperature: 0.2, maxTokens: 1100 });
  if (!regen) return { text: null, model: first.model, validation: { validated: false, unsupportedClaims: val.unsupported.length, recovered: "deterministic" } };
  val = validateOutput(regen.text, facts);
  if (val.ok) return { text: regen.text, model: first.model, validation: { validated: true, unsupportedClaims: 0, recovered: "regenerated" } };
  return { text: null, model: first.model, validation: { validated: false, unsupportedClaims: val.unsupported.length, recovered: "deterministic-fallback" } };
}

export { env };
