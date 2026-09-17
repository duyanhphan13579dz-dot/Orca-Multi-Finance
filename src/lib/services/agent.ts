import "server-only";
import { buildMeta, worstFreshness } from "../freshness";
import { computeConfidence, type Confidence } from "./intelligence";
import { VN_TICKERS } from "../providers/news";
import type { FreshnessStatus, Meta } from "../types";
import type { HistoryTurn } from "./agent-memory";
import { llmChat, llmConfigured } from "../ai/gateway";
import {
  buildUniverseOverview,
  buildForexContext,
  buildCommodityContext,
  buildRatesMacroContext,
  buildVnStockFull,
  buildCryptoContext,
  type AgentBuilt,
} from "./agent-context";
import { buildVnMarketBriefing } from "./market-briefing";

export interface AgentPrefs {
  depth?: "concise" | "standard" | "deep";
  style?: "analyst" | "technical" | "brief";
  language?: "vi" | "en";
  riskDisclosure?: "standard" | "detailed" | "off";
}

export type AgentHistoryTurn = HistoryTurn;

type Persona = "stock_analyst" | "personal_finance" | "wealth";

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

const KNOWN_CRYPTO = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "TON",
  "AVAX",
  "LINK",
  "DOT",
  "TRX",
  "LTC",
  "BCH",
  "NEAR",
  "SUI",
  "APT",
  "ARB",
  "OP",
  "INJ",
  "TIA",
  "SEI",
  "PEPE",
  "SHIB",
  "UNI",
  "ATOM",
  "FIL",
  "ETC",
  "AAVE",
  "MKR",
  "ALGO",
  "VET",
  "ICP",
  "FET",
  "RENDER",
  "WLD",
  "JUP",
  "ENA",
  "ONDO",
  "POL",
  "XLM",
  "HBAR",
  "KAS",
  "TAO",
  "STRK",
  "PAXG",
]);

type Intent =
  | { kind: "vn-market"; requestedDate: string | null }
  | { kind: "crypto"; symbol: string }
  | { kind: "forex"; pair: string }
  | { kind: "vn-stock"; symbol: string }
  | { kind: "commodity"; query: string }
  | { kind: "market" }
  | { kind: "compare"; a: string; b: string }
  | { kind: "news"; query?: string }
  | { kind: "rates" }
  | { kind: "macro" }
  | { kind: "personal_finance" }
  | { kind: "wealth" }
  | { kind: "general" };

/** Câu hỏi nhận định / tổng hợp diễn biến thị trường CK VN */
function isVnMarketBriefingQuery(q: string): boolean {
  return /thị trường đang diễn ra|nhận định thị trường|tổng hợp diễn biến thị trường|diễn biến thị trường hôm nay|thị trường hôm nay|tổng quan thị trường|thị trường chứng khoán hôm nay|phiên giao dịch hôm nay|thị trường đang thế nào|thị trường ra sao/i.test(
    q,
  );
}

function detectIntent(q: string): Intent {
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();

  // Ưu tiên nhận định thị trường CK VN (format 4 phần)
  if (isVnMarketBriefingQuery(q)) {
    return { kind: "vn-market", requestedDate: null };
  }

  if (/lãi suất|interest rate|trái phiếu chính phủ|huy động|cho vay/i.test(q)) return { kind: "rates" };
  if (/vĩ mô|macro|gdp|cpi|lạm phát|thất nghiệp|fdi|xuất khẩu/i.test(q)) return { kind: "macro" };
  if (/tài chính cá nhân|tiết kiệm|ngân sách|chi tiêu gia đình/i.test(q)) return { kind: "personal_finance" };
  if (/gia sản|tài sản ròng|phân bổ danh mục|wealth/i.test(q)) return { kind: "wealth" };

  if (/vàng|gold|bạc|silver|dầu|oil|cà phê|commodity|hàng hóa/i.test(q)) {
    return { kind: "commodity", query: q };
  }

  for (const p of [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "AUDUSD",
    "USDCAD",
    "NZDUSD",
    "EURJPY",
    "EURGBP",
    "GBPJPY",
    "AUDJPY",
    "USDVND",
  ]) {
    if (upper.includes(p) || upper.replace("/", "").includes(p)) return { kind: "forex", pair: p };
  }
  if (/\b(eur\/usd|gbp\/usd|usd\/jpy|usd\/vnd|forex|ngoại hối|tỷ giá)\b/i.test(q)) {
    if (/usd\/vnd|usd\s*vnd|đô.*việt/i.test(q)) return { kind: "forex", pair: "USDVND" };
    if (/eur/i.test(q)) return { kind: "forex", pair: "EURUSD" };
    if (/gbp|bảng/i.test(q)) return { kind: "forex", pair: "GBPUSD" };
    if (/jpy|yên/i.test(q)) return { kind: "forex", pair: "USDJPY" };
    return { kind: "forex", pair: "EURUSD" };
  }

  const usdt = upper.match(/\b([A-Z]{2,12})USDT\b/);
  if (usdt) return { kind: "crypto", symbol: `${usdt[1]}USDT` };
  for (const t of upper.match(/\b[A-Z]{2,5}\b/g) ?? []) {
    if (KNOWN_CRYPTO.has(t)) return { kind: "crypto", symbol: `${t}USDT` };
  }

  const tickers = upper.match(/\b[A-Z]{3}\b/g) ?? [];
  for (const t of tickers) {
    if (VN_TICKERS.includes(t) || /^[A-Z]{3}$/.test(t)) {
      if (!KNOWN_CRYPTO.has(t) && t !== "USD" && t !== "EUR" && t !== "GBP" && t !== "JPY") {
        if (VN_TICKERS.includes(t) || /cổ phiếu|mã|phân tích|định giá|pe|pb/i.test(q) || tickers.length === 1) {
          if (VN_TICKERS.includes(t) || /\b(fpt|vcb|tcb|hpg|mwg|ssi|vnindex)\b/i.test(lower)) {
            return { kind: "vn-stock", symbol: t === "VNINDEX" ? "VNINDEX" : t };
          }
          if (VN_TICKERS.includes(t)) return { kind: "vn-stock", symbol: t };
        }
      }
    }
  }
  const mStock = upper.match(/\b([A-Z]{3})\b/);
  if (mStock && !KNOWN_CRYPTO.has(mStock[1]) && /cổ phiếu|mã|phân tích|định giá|ck |chứng khoán/i.test(q)) {
    return { kind: "vn-stock", symbol: mStock[1] };
  }
  for (const t of tickers) {
    if (VN_TICKERS.includes(t)) return { kind: "vn-stock", symbol: t };
  }

  if (/so sánh|vs\b|đối chiếu/i.test(q)) {
    const meaningful = (upper.match(/\b[A-Z]{2,5}\b/g) ?? []).filter(
      (t) => t.length >= 2 && t !== "USDT" && t !== "VS",
    );
    if (meaningful.length >= 2) return { kind: "compare", a: meaningful[0], b: meaningful[1] };
  }

  if (/tin tức|news/i.test(q)) return { kind: "news" };
  if (/thị trường|market|tổng quan|đa tài sản|toàn cảnh/i.test(q)) {
    return { kind: "vn-market", requestedDate: null };
  }
  return { kind: "general" };
}

async function synthesizeWithLlm(
  question: string,
  built: AgentBuilt,
  prefs: AgentPrefs,
  history: AgentHistoryTurn[],
  opts?: { forceBriefingFormat?: boolean },
): Promise<{ text: string; model: string } | null> {
  if (!llmConfigured()) return null;
  try {
    const briefingRule = opts?.forceBriefingFormat
      ? `
BẮT BUỘC giữ đúng 4 phần (tiêu đề ##):
1. Biến động chỉ số & cổ phiếu dẫn dắt
2. Động thái khối ngoại
3. Thanh khoản & độ rộng thị trường
4. Tổng quan ngành & nguyên nhân vĩ mô
Chỉ làm mượt câu chữ / bổ sung liên kết logic từ CONTEXT; KHÔNG đổi cấu trúc, KHÔNG bịa số liệu.`
      : "";

    const system = `Bạn là ORCA Agent — trợ lý phân tích tài chính toàn diện của nền tảng ORCA Multi-Finance.
Chỉ được dùng số liệu trong CONTEXT JSON và NARRATIVE đã tính sẵn từ hệ thống (chứng khoán VN, crypto, forex, hàng hóa, lãi suất, vĩ mô).
KHÔNG bịa số, KHÔNG bịa nguồn. Nếu thiếu dữ liệu, nói rõ "chưa có trong hệ thống".
Trả lời tiếng ${prefs.language === "en" ? "Anh" : "Việt"}, cấu trúc rõ (tiêu đề ##, gạch đầu dòng).
Không đưa khuyến nghị mua/bán tuyệt đối; nhấn mạnh phục vụ nghiên cứu.${briefingRule}`;

    const user = `CÂU HỎI: ${question}

NARRATIVE HỆ THỐNG:
${built.narrative.slice(0, 7_000)}

CONTEXT JSON (rút gọn):
${JSON.stringify(built.contract).slice(0, 8_000)}

Hãy tổng hợp phân tích chuyên sâu, bám số liệu trên.`;

    const r = await llmChat("analysis", {
      system,
      user,
      temperature: opts?.forceBriefingFormat ? 0.15 : 0.25,
      maxTokens: prefs.depth === "deep" || opts?.forceBriefingFormat ? 1600 : 900,
      history: history.slice(-8).map((h) => ({
        role: h.role === "assistant" || h.role === "agent" ? ("assistant" as const) : ("user" as const),
        content: h.content,
      })),
    });
    if (!r?.text?.trim()) return null;
    return { text: r.text.trim(), model: r.model };
  } catch {
    return null;
  }
}

export async function answerQuestion(
  question: string,
  prefs: AgentPrefs = {},
  history: AgentHistoryTurn[] = [],
): Promise<{ result: AgentAnswer; meta: Meta }> {
  const intent = detectIntent(question);
  const deep = prefs.depth === "deep";
  let built: AgentBuilt;
  let persona: Persona = "stock_analyst";
  let forceBriefingFormat = false;

  if (intent.kind === "vn-market" || intent.kind === "market") {
    // Nhận định CK VN — format 4 phần chuẩn
    built = await buildVnMarketBriefing();
    forceBriefingFormat = true;
  } else if (intent.kind === "vn-stock") {
    built = await buildVnStockFull(intent.symbol, deep);
  } else if (intent.kind === "crypto") {
    built = await buildCryptoContext(intent.symbol);
  } else if (intent.kind === "forex") {
    built = await buildForexContext(intent.pair);
  } else if (intent.kind === "commodity") {
    built = await buildCommodityContext(intent.query);
  } else if (intent.kind === "rates") {
    built = await buildRatesMacroContext("rates");
  } else if (intent.kind === "macro") {
    built = await buildRatesMacroContext("macro");
  } else if (intent.kind === "compare") {
    const isCrypto = (x: string) =>
      KNOWN_CRYPTO.has(x.replace(/USDT$/, "")) || x.endsWith("USDT");
    const A = isCrypto(intent.a)
      ? await buildCryptoContext(intent.a.endsWith("USDT") ? intent.a : `${intent.a}USDT`)
      : await buildVnStockFull(intent.a, false);
    const B = isCrypto(intent.b)
      ? await buildCryptoContext(intent.b.endsWith("USDT") ? intent.b : `${intent.b}USDT`)
      : await buildVnStockFull(intent.b, false);
    built = {
      narrative: `## Đối chiếu ${intent.a} vs ${intent.b}\n\n${A.narrative}\n\n---\n\n${B.narrative}`,
      contract: { compare: [A.contract, B.contract] },
      sectionsUsed: [...new Set([...A.sectionsUsed, ...B.sectionsUsed])],
      symbols: [intent.a, intent.b],
      freshnesses: [...A.freshnesses, ...B.freshnesses],
    };
  } else if (intent.kind === "personal_finance") {
    persona = "personal_finance";
    const uni = await buildUniverseOverview();
    built = {
      ...uni,
      narrative: `## Góc tài chính cá nhân\n\nDựa trên bối cảnh thị trường hiện tại:\n\n${uni.narrative}\n\nGợi ý khung: quỹ dự phòng 3–6 tháng chi tiêu · ưu tiên nợ lãi cao · chỉ đầu tư số tiền chấp nhận biến động được · đa dạng hóa theo khẩu vị rủi ro.`,
    };
  } else if (intent.kind === "wealth") {
    persona = "wealth";
    const uni = await buildUniverseOverview();
    built = {
      ...uni,
      narrative: `## Góc phân bổ gia sản\n\nBối cảnh đa tài sản:\n\n${uni.narrative}\n\nKhung tham chiếu (không phải lời khuyên): lõi phòng thủ (tiền gửi/trái phiếu) · tăng trưởng (cổ phiếu/ETF) · vệ tinh (crypto/hàng hóa) theo tỷ trọng phù hợp rủi ro và chân trời thời gian.`,
    };
  } else if (intent.kind === "news") {
    // Tin tức chung vẫn có thể kèm briefing ngắn nếu hỏi thị trường
    built = isVnMarketBriefingQuery(question)
      ? await buildVnMarketBriefing()
      : await buildUniverseOverview();
    forceBriefingFormat = isVnMarketBriefingQuery(question);
  } else {
    // general — nếu vẫn có từ khóa thị trường thì briefing, không thì universe
    if (isVnMarketBriefingQuery(question) || /thị trường chứng khoán|vn-?index|hose/i.test(question)) {
      built = await buildVnMarketBriefing();
      forceBriefingFormat = true;
    } else {
      built = await buildUniverseOverview();
    }
  }

  let mode: "deterministic" | "llm" = "deterministic";
  let model: string | null = null;
  let finalAnswer = built.narrative;

  // Briefing 4 phần: mặc định giữ narrative số liệu; LLM chỉ làm mượt khi depth=deep hoặc đã cấu hình
  const useLlm =
    !forceBriefingFormat || prefs.depth === "deep" || prefs.style === "analyst";
  if (useLlm) {
    const llm = await synthesizeWithLlm(question, built, prefs, history, {
      forceBriefingFormat,
    });
    if (llm) {
      // Với briefing: chỉ chấp nhận nếu còn đủ 4 heading
      if (forceBriefingFormat) {
        const ok =
          /1\.\s*Biến động|## 1\./i.test(llm.text) &&
          /2\.\s*Động thái|## 2\./i.test(llm.text) &&
          /3\.\s*Thanh khoản|## 3\./i.test(llm.text) &&
          /4\.\s*Tổng quan|## 4\./i.test(llm.text);
        if (ok) {
          finalAnswer = llm.text;
          mode = "llm";
          model = llm.model;
        }
        // else giữ deterministic
      } else {
        finalAnswer = llm.text;
        mode = "llm";
        model = llm.model;
      }
    }
  }

  if (prefs.depth === "concise" && !forceBriefingFormat) {
    finalAnswer = finalAnswer.split("\n\n").slice(0, 4).join("\n\n");
  }

  if (prefs.riskDisclosure !== "off") {
    finalAnswer +=
      "\n\n— Phân tích từ dữ liệu thật trên ORCA (CK VN · Crypto · Forex · Hàng hóa · Lãi suất · Vĩ mô); phục vụ nghiên cứu, không phải khuyến nghị đầu tư.";
  }

  const dataFreshness = built.freshnesses.length
    ? worstFreshness(built.freshnesses)
    : built.unavailable
      ? "UNAVAILABLE"
      : "LIVE";
  const confidence = computeConfidence({
    freshness: built.freshnesses,
    coverage: built.unavailable ? 0 : Math.min(1, built.sectionsUsed.length / 3),
  });

  const meta = buildMeta({
    source: mode === "llm" ? "orca-agent+llm" : forceBriefingFormat ? "orca-agent-market-briefing" : "orca-agent",
    sourceTimestampMs: Date.now(),
    note: `Persona: ${persona} · intent: ${intent.kind} · sections: ${built.sectionsUsed.join(",")}`,
  });
  meta.freshness = dataFreshness;

  return {
    result: {
      answer: finalAnswer,
      mode,
      intent: intent.kind,
      persona,
      model,
      confidence,
      dataQuality: built.unavailable ? "LOW" : built.sectionsUsed.length >= 3 ? "HIGH" : "MEDIUM",
      dataFreshness,
      context: { sectionsUsed: built.sectionsUsed, symbols: built.symbols },
    },
    meta,
  };
}
