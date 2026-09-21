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
  buildIndustryContext,
  buildCommodityContext,
  buildRatesMacroContext,
  buildVnStockFull,
  buildCryptoContext,
  type AgentBuilt,
} from "./agent-context";
import { buildVnMarketBriefing } from "./market-briefing";
import { createResponseContext, domainsForRoute, routeQuestion, type AgentResponseContext, type AgentRoute } from "./agent-router";

/** Hard wall for data-engine calls so agent never hangs past Vercel budget */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

const EMPTY_BUILT: AgentBuilt = {
  narrative:
    "## Tạm thời thiếu dữ liệu live\n\nData-engine chưa trả về kịp. Bạn có thể hỏi lại mã cụ thể (vd. VCB, FPT) hoặc thử sau vài giây.",
  contract: { degraded: true },
  sectionsUsed: [],
  symbols: [],
  freshnesses: [],
  unavailable: true,
};

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
  route: AgentRoute;
  responses: AgentResponseContext[];
}

const KNOWN_CRYPTO = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "TON", "AVAX", "LINK", "DOT", "TRX",
  "LTC", "BCH", "NEAR", "SUI", "APT", "ARB", "OP", "INJ", "TIA", "SEI", "PEPE", "SHIB",
  "UNI", "ATOM", "FIL", "ETC", "AAVE", "MKR", "ALGO", "VET", "ICP", "FET", "RENDER",
  "WLD", "JUP", "ENA", "ONDO", "POL", "XLM", "HBAR", "KAS", "TAO", "STRK", "PAXG",
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

function isVnMarketBriefingQuery(q: string): boolean {
  return /thị trường đang diễn ra|nhận định thị trường|tổng hợp diễn biến thị trường|diễn biến thị trường hôm nay|thị trường hôm nay|tổng quan thị trường|thị trường chứng khoán hôm nay|phiên giao dịch hôm nay|thị trường đang thế nào|thị trường ra sao/i.test(
    q,
  );
}

function detectIntent(q: string): Intent {
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();

  if (isVnMarketBriefingQuery(q)) {
    return { kind: "vn-market", requestedDate: null };
  }

  if (/lãi suất|interest rate|trái phiếu chính phủ|huy động|cho vay/i.test(q)) return { kind: "rates" };
  if (/vĩ mô|macro|gdp|cpi|lạm phát|thất nghiệp|fdi|xuất khẩu/i.test(q)) return { kind: "macro" };
  if (/ngành\s*ngân\s*hàng|sector\s*bank|banking\s*sector|so sánh.*ngân hàng/i.test(q)) {
    return { kind: "compare", a: "VCB", b: "TCB" };
  }
  if (/tài chính cá nhân|tiết kiệm|ngân sách|chi tiêu gia đình/i.test(q)) return { kind: "personal_finance" };
  if (/gia sản|tài sản ròng|phân bổ danh mục|wealth/i.test(q)) return { kind: "wealth" };

  if (/vàng|gold|bạc|silver|dầu|oil|cà phê|commodity|hàng hóa/i.test(q)) {
    return { kind: "commodity", query: q };
  }

  for (const p of [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
    "EURJPY", "EURGBP", "GBPJPY", "AUDJPY", "USDVND",
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
  const near = q.match(/(?:cổ\s*phiếu|mã|ticker|symbol)\s+([A-Za-z]{3})\b/i);
  if (near) {
    const sym = near[1].toUpperCase();
    if (!KNOWN_CRYPTO.has(sym)) return { kind: "vn-stock", symbol: sym };
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
    const marketRule = /thị trường|vn-?index|vn30|hose|hnx|upcom|khối ngoại|ngành dẫn dắt/i.test(question)
      ? `
Đây là câu hỏi nhánh THỊ TRƯỜNG. Ưu tiên trạng thái VN-Index/VN30/HNX/UPCoM, mức tăng giảm và thanh khoản, breadth, leadership/ngành mạnh yếu, flow, macro/cross-asset, rủi ro và kết luận ngắn. Chỉ dùng các trường đã có trong CONTEXT; không tự tạo market score, xác suất hay khuyến nghị cá nhân hóa. Phân biệt rõ dữ liệu với diễn giải và nhắc timestamp khi có.`
      : "";
    const industryRule = /ngành|sector|banking|dầu khí|thép|công nghệ|bất động sản|bán lẻ/i.test(question)
      ? `
Đây là câu hỏi nhánh NGÀNH. Phân tích toàn ngành trước: xu hướng/relative strength, breadth, thanh khoản, leadership/laggards; chỉ liên hệ doanh nghiệp khi CONTEXT chứng minh được. Không lấy một vài mã đại diện để gọi là toàn ngành. Earnings, valuation, NIM/NPL/CASA, hàng hóa, macro, news hoặc catalyst chỉ được nêu khi có dữ liệu; nếu thiếu phải nói rõ. Không tự tạo ranking mới.`
      : "";
    const stockRule = /phân tích|cổ phiếu|mã cổ phiếu|định giá|p\/e|p\/b|eps|so sánh|\bFPT\b|\bCMG\b|\bGAS\b/i.test(question)
      ? `
Đây là câu hỏi nhánh CỔ PHIẾU. Đọc theo thứ tự thị trường → ngành → doanh nghiệp → cổ phiếu; financial statements phải giữ đúng kỳ báo cáo và nguồn. Chỉ giải thích technical/fundamental/valuation/performance scores đã có, không tạo điểm tổng hợp mới. Khi so sánh, đối chiếu từng chỉ tiêu cùng kỳ và đánh dấu thiếu/discrepancy; không kết luận rẻ/đắt từ một ratio.`
      : "";
    const commodityRule = /vàng|gold|bạc|silver|dầu|oil|wti|brent|hrc|đồng|cà phê|robusta|arabica|hàng hóa|commodity/i.test(question)
      ? `
Đây là câu hỏi nhánh HÀNG HÓA. Luôn nêu giá, đơn vị, currency, timestamp, timeframe và nguồn nếu có. Chỉ dùng timeframe được engine cung cấp; không gọi dữ liệu hiện tại nếu timestamp thiếu. Khi phân tích tác động, đi theo COMMODITY → cơ chế truyền dẫn → INDUSTRY → DOANH NGHIỆP → STOCK; không suy diễn mọi mã đều hưởng lợi và phải nêu độ trễ/rủi ro.`
      : "";

    const system = `Bạn là ORCA Agent — trợ lý phân tích tài chính toàn diện của nền tảng ORCA Multi-Finance.
Chỉ được dùng số liệu trong CONTEXT JSON và NARRATIVE đã tính sẵn từ hệ thống (chứng khoán VN, crypto, forex, hàng hóa, lãi suất, vĩ mô).
KHÔNG bịa số, KHÔNG bịa nguồn. Nếu thiếu dữ liệu, nói rõ "chưa có trong hệ thống".
Trả lời tiếng ${prefs.language === "en" ? "Anh" : "Việt"}, cấu trúc rõ (tiêu đề ##, gạch đầu dòng).
Không đưa khuyến nghị mua/bán tuyệt đối; nhấn mạnh phục vụ nghiên cứu.${briefingRule}${marketRule}${industryRule}${stockRule}${commodityRule}`;

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
      maxTokens: prefs.depth === "deep" || opts?.forceBriefingFormat ? 1400 : 800,
      timeoutMs: 18_000,
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

async function buildRoutedContext(route: AgentRoute, question: string, deep: boolean): Promise<{ built: AgentBuilt; responses: AgentResponseContext[] }> {
  const domains = domainsForRoute(route);
  const jobs = domains.map(async (domain) => {
    if (domain === "market") return { domain, built: await withTimeout(buildVnMarketBriefing(), 22_000, EMPTY_BUILT) };
    if (domain === "industry") return { domain, built: await withTimeout(buildIndustryContext(question), 22_000, EMPTY_BUILT) };
    if (domain === "commodity") return { domain, built: await withTimeout(buildCommodityContext(question), 22_000, EMPTY_BUILT) };
    const symbols = route.entities.symbols.length > 1 ? route.entities.symbols.slice(0, 4) : [route.entities.symbols[0] ?? "FPT"];
    if (symbols.length > 1 && route.task === "compare") {
      const stocks = await Promise.all(symbols.map((symbol) => withTimeout(buildVnStockFull(symbol, deep), 22_000, { ...EMPTY_BUILT, symbols: [symbol] })));
      return {
        domain,
        built: {
          narrative: stocks.map((stock) => stock.narrative).join("\n\n---\n\n"),
          contract: { comparison: stocks.map((stock, index) => ({ symbol: symbols[index], ...stock.contract })) },
          sectionsUsed: [...new Set(stocks.flatMap((stock) => stock.sectionsUsed))],
          symbols,
          freshnesses: stocks.flatMap((stock) => stock.freshnesses),
          unavailable: stocks.every((stock) => stock.unavailable),
        },
      };
    }
    return { domain, built: await withTimeout(buildVnStockFull(symbols[0]!, deep), 22_000, { ...EMPTY_BUILT, symbols: [symbols[0]!] }) };
  });
  const parts = await Promise.all(jobs);
  const merged: AgentBuilt = {
    narrative: parts.map((x) => x.built.narrative).join("\n\n---\n\n"),
    contract: Object.fromEntries(parts.map((x) => [x.domain, x.built.contract])),
    sectionsUsed: [...new Set(parts.flatMap((x) => x.built.sectionsUsed))],
    symbols: [...new Set(parts.flatMap((x) => x.built.symbols))],
    freshnesses: parts.flatMap((x) => x.built.freshnesses),
    unavailable: parts.every((x) => x.built.unavailable),
  };
  return { built: merged, responses: parts.map((x) => createResponseContext(x.domain, x.built)) };
}

export async function answerQuestion(
  question: string,
  prefs: AgentPrefs = {},
  history: AgentHistoryTurn[] = [],
): Promise<{ result: AgentAnswer; meta: Meta }> {
  const intent = detectIntent(question);
  const route = routeQuestion(question);
  const deep = prefs.depth === "deep";
  let built: AgentBuilt;
  let responses: AgentResponseContext[] = [];
  let persona: Persona = "stock_analyst";
  let forceBriefingFormat = false;
  const DATA_MS = 22_000;

  try {
    if (domainsForRoute(route).length > 0) {
      const routed = await buildRoutedContext(route, question, deep);
      built = routed.built;
      responses = routed.responses;
    } else if (intent.kind === "vn-market" || intent.kind === "market") {
      built = await withTimeout(buildVnMarketBriefing(), DATA_MS, EMPTY_BUILT);
      forceBriefingFormat = !built.unavailable;
    } else if (intent.kind === "vn-stock") {
      built = await withTimeout(buildVnStockFull(intent.symbol, deep), DATA_MS, {
        ...EMPTY_BUILT,
        narrative: `## ${intent.symbol}\n\nChưa lấy được đủ dữ liệu live cho mã này trong thời gian cho phép. Thử lại sau hoặc kiểm tra /system.`,
        symbols: [intent.symbol],
      });
    } else if (intent.kind === "crypto") {
      built = await withTimeout(buildCryptoContext(intent.symbol), DATA_MS, {
        ...EMPTY_BUILT,
        symbols: [intent.symbol],
        narrative: `## ${intent.symbol}\n\nChưa lấy được dữ liệu crypto kịp thời.`,
      });
    } else if (intent.kind === "forex") {
      built = await withTimeout(buildForexContext(intent.pair), DATA_MS, {
        ...EMPTY_BUILT,
        symbols: [intent.pair],
        narrative: `## ${intent.pair}\n\nChưa lấy được dữ liệu forex kịp thời.`,
      });
    } else if (intent.kind === "commodity") {
      built = await withTimeout(buildCommodityContext(intent.query), DATA_MS, EMPTY_BUILT);
    } else if (intent.kind === "rates") {
      built = await withTimeout(buildRatesMacroContext("rates"), DATA_MS, EMPTY_BUILT);
    } else if (intent.kind === "macro") {
      built = await withTimeout(buildRatesMacroContext("macro"), DATA_MS, EMPTY_BUILT);
    } else if (intent.kind === "compare") {
      const isCrypto = (x: string) =>
        KNOWN_CRYPTO.has(x.replace(/USDT$/, "")) || x.endsWith("USDT");
      const loadOne = (x: string) =>
        isCrypto(x)
          ? buildCryptoContext(x.endsWith("USDT") ? x : `${x}USDT`)
          : buildVnStockFull(x, false);
      const [A, B] = await Promise.all([
        withTimeout(loadOne(intent.a), DATA_MS, {
          ...EMPTY_BUILT,
          symbols: [intent.a],
          narrative: `## ${intent.a}\n\nThiếu dữ liệu.`,
        }),
        withTimeout(loadOne(intent.b), DATA_MS, {
          ...EMPTY_BUILT,
          symbols: [intent.b],
          narrative: `## ${intent.b}\n\nThiếu dữ liệu.`,
        }),
      ]);
      built = {
        narrative: `## Đối chiếu ${intent.a} vs ${intent.b}\n\n${A.narrative}\n\n---\n\n${B.narrative}`,
        contract: { compare: [A.contract, B.contract] },
        sectionsUsed: [...new Set([...A.sectionsUsed, ...B.sectionsUsed])],
        symbols: [intent.a, intent.b],
        freshnesses: [...A.freshnesses, ...B.freshnesses],
        unavailable: Boolean(A.unavailable && B.unavailable),
      };
    } else if (intent.kind === "personal_finance") {
      persona = "personal_finance";
      const uni = await withTimeout(buildUniverseOverview(), DATA_MS, EMPTY_BUILT);
      built = {
        ...uni,
        narrative: `## Góc tài chính cá nhân\n\nDựa trên bối cảnh thị trường hiện tại:\n\n${uni.narrative}\n\nGợi ý khung: quỹ dự phòng 3–6 tháng chi tiêu · ưu tiên nợ lãi cao · chỉ đầu tư số tiền chấp nhận biến động được · đa dạng hóa theo khẩu vị rủi ro.`,
      };
    } else if (intent.kind === "wealth") {
      persona = "wealth";
      const uni = await withTimeout(buildUniverseOverview(), DATA_MS, EMPTY_BUILT);
      built = {
        ...uni,
        narrative: `## Góc phân bổ gia sản\n\nBối cảnh đa tài sản:\n\n${uni.narrative}\n\nKhung tham chiếu (không phải lời khuyên): lõi phòng thủ (tiền gửi/trái phiếu) · tăng trưởng (cổ phiếu/ETF) · vệ tinh (crypto/hàng hóa) theo tỷ trọng phù hợp rủi ro và chân trời thời gian.`,
      };
    } else if (intent.kind === "news") {
      built = isVnMarketBriefingQuery(question)
        ? await withTimeout(buildVnMarketBriefing(), DATA_MS, EMPTY_BUILT)
        : await withTimeout(buildUniverseOverview(), DATA_MS, EMPTY_BUILT);
      forceBriefingFormat = isVnMarketBriefingQuery(question) && !built.unavailable;
    } else {
      if (isVnMarketBriefingQuery(question) || /thị trường chứng khoán|vn-?index|hose/i.test(question)) {
        built = await withTimeout(buildVnMarketBriefing(), DATA_MS, EMPTY_BUILT);
        forceBriefingFormat = !built.unavailable;
      } else {
        built = await withTimeout(buildUniverseOverview(), DATA_MS, EMPTY_BUILT);
      }
    }

    let mode: "deterministic" | "llm" = "deterministic";
    let model: string | null = null;
    let finalAnswer = built.narrative;

    const useLlm =
      !forceBriefingFormat || prefs.depth === "deep" || prefs.style === "analyst";
    if (useLlm) {
      const llm = await synthesizeWithLlm(question, built, prefs, history, {
        forceBriefingFormat,
      });
      if (llm) {
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
      source:
        mode === "llm"
          ? "orca-agent+llm"
          : forceBriefingFormat
            ? "orca-agent-market-briefing"
            : "orca-agent",
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
        route,
        responses,
      },
      meta,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const meta = buildMeta({
      source: "orca-agent-degraded",
      sourceTimestampMs: Date.now(),
      note: `Agent degraded: ${msg.slice(0, 120)}`,
    });
    meta.freshness = "UNAVAILABLE";
    return {
      result: {
        answer:
          "Agent gặp sự cố khi tổng hợp dữ liệu/LLM. Dữ liệu quant và pipeline vẫn chạy độc lập — vui lòng thử lại sau vài giây hoặc hỏi mã cụ thể (vd. VCB, BTC).\n\n— ORCA · chế độ degraded",
        mode: "deterministic" as const,
        intent: "general",
        persona: "stock_analyst" as const,
        model: null,
        confidence: computeConfidence({ freshness: [], coverage: 0 }),
        dataQuality: "LOW" as const,
        dataFreshness: "UNAVAILABLE" as const,
        context: { sectionsUsed: [], symbols: [] },
        route: routeQuestion(question),
        responses: [],
      },
      meta,
    };
  }
}
