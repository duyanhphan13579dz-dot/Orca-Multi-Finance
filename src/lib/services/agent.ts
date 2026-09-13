import "server-only";
import { env } from "../env";
import { buildMeta, worstFreshness } from "../freshness";
import { getCryptoDetail } from "./crypto";
import { buildMarketSnapshot } from "./market";
import { computeConfidence, type Confidence } from "./intelligence";
import { VN_TICKERS } from "../providers/news";
import type { FreshnessStatus, Meta } from "../types";
import type { HistoryTurn } from "./agent-memory";
import { buildVn } from "./agent-vn-stock";

export interface AgentPrefs {
  depth?: "concise" | "standard" | "deep";
  style?: "analyst" | "technical" | "brief";
  language?: "vi" | "en";
  riskDisclosure?: "standard" | "detailed" | "off";
}

/** Conversation history turn accepted by the agent API route. */
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

interface Built {
  narrative: string;
  contract: Record<string, unknown>;
  sectionsUsed: string[];
  symbols: string[];
  freshnesses: FreshnessStatus[];
  unavailable?: boolean;
  persona: Persona;
}

const KNOWN_CRYPTO = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "TON", "AVAX", "LINK", "DOT", "TRX",
  "LTC", "BCH", "NEAR", "SUI", "APT", "ARB", "OP", "INJ", "TIA", "SEI", "PEPE", "SHIB",
  "UNI", "ATOM", "FIL", "ETC", "AAVE", "MKR", "ALGO", "VET", "ICP", "FET", "RENDER",
  "WLD", "JUP", "ENA", "ONDO", "POL", "XLM", "HBAR", "KAS", "TAO", "IP", "PI", "ZEC",
  "STRK", "PAXG",
]);
const FX_PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
  "EURJPY", "EURGBP", "GBPJPY", "AUDJPY", "USDVND",
];

type Intent =
  | { kind: "vn-market"; requestedDate: string | null }
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

function detectIntent(q: string): Intent {
  const upper = q.toUpperCase();
  if (/gia sản|danh mục.*tỷ|phân bổ tài sản|private wealth|family office/i.test(q)) return { kind: "wealth" };
  if (/ngân sách|chi tiêu|tiết kiệm|quỹ dự phòng|lương|tiêu trong/i.test(q)) return { kind: "personal_finance" };
  if (/chứng khoán|thị trường.*(việt|vn)|vn-?index|vn30|hnx|upcom|phiên giao dịch/i.test(q))
    return { kind: "vn-market", requestedDate: null };
  if (/so sánh|compare|\bvs\b/i.test(q)) {
    const tokens = upper.match(/\b[A-Z]{2,10}\b/g) ?? [];
    const meaningful = tokens.filter(
      (t) => KNOWN_CRYPTO.has(t) || VN_TICKERS.includes(t) || FX_PAIRS.includes(t),
    );
    if (meaningful.length >= 2) return { kind: "compare", a: meaningful[0], b: meaningful[1] };
  }
  const usdt = upper.match(/\b([A-Z]{2,12})USDT\b/);
  if (usdt) return { kind: "crypto", symbol: `${usdt[1]}USDT` };
  for (const t of upper.match(/\b[A-Z]{2,5}\b/g) ?? [])
    if (KNOWN_CRYPTO.has(t)) return { kind: "crypto", symbol: `${t}USDT` };
  for (const t of upper.match(/\b[A-Z]{3}\b/g) ?? [])
    if (VN_TICKERS.includes(t)) return { kind: "vn-stock", symbol: t };
  if (/vàng|gold|bạc|dầu|oil|cà phê/i.test(q)) return { kind: "commodity", query: "gold" };
  if (/thị trường|market|tổng quan/i.test(q)) return { kind: "vn-market", requestedDate: null };
  if (/tin tức|news/i.test(q)) return { kind: "news" };
  return { kind: "general" };
}

async function buildCrypto(symbol: string): Promise<Built> {
  const r = await getCryptoDetail(symbol);
  const sym = symbol.replace(/USDT$/, "");
  if (!r) {
    return {
      narrative: `${sym}: dữ liệu không khả dụng từ Binance.`,
      contract: { asset: { symbol: sym, asset_type: "crypto" }, error: "unavailable" },
      sectionsUsed: [],
      symbols: [symbol],
      freshnesses: [],
      unavailable: true,
      persona: "stock_analyst",
    };
  }
  const ticker = r.detail.ticker;
  const tech = r.detail.technical;
  const funding = r.detail.funding;
  const narrative = [
    `${sym} — giá ${ticker.price.toLocaleString("en-US")} USDT, 24h ${
      ticker.changePercent != null ? ticker.changePercent.toFixed(2) + "%" : "?"
    }.`,
    tech
      ? `Kỹ thuật: xu hướng ${tech.trend?.label ?? "?"}, RSI14 ${tech.rsi14?.toFixed(1) ?? "?"}.`
      : "Chưa đủ chuỗi chỉ báo.",
    funding ? `Futures: funding ${(funding.fundingRate * 100).toFixed(4)}%.` : "Futures: không khả dụng.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    narrative,
    contract: { asset: { symbol: sym }, market_data: ticker },
    sectionsUsed: ["crypto"],
    symbols: [symbol],
    freshnesses: [r.meta.freshness],
    persona: "stock_analyst",
  };
}

async function buildMarket(): Promise<Built> {
  const snap = await buildMarketSnapshot();
  const p = snap.snapshot.pulse;
  return {
    narrative: `${p.headline}.\n\n${p.body.join("\n\n")}`,
    contract: { scope: "market_snapshot", pulse: p },
    sectionsUsed: ["market-snapshot"],
    symbols: [],
    freshnesses: Object.values(snap.meta.sections ?? {}),
    persona: "stock_analyst",
  };
}

export async function answerQuestion(
  question: string,
  prefs: AgentPrefs = {},
  history: AgentHistoryTurn[] = [],
): Promise<{ result: AgentAnswer; meta: Meta }> {
  const intent = detectIntent(question);
  const deep = prefs.depth === "deep";
  let built: Built;

  if (intent.kind === "vn-stock") {
    built = await buildVn(intent.symbol, deep);
  } else if (intent.kind === "crypto") {
    built = await buildCrypto(intent.symbol);
  } else if (
    intent.kind === "vn-market" ||
    intent.kind === "market" ||
    intent.kind === "general" ||
    intent.kind === "news"
  ) {
    built = await buildMarket();
  } else if (intent.kind === "compare") {
    const A =
      KNOWN_CRYPTO.has(intent.a.replace(/USDT$/, "")) || intent.a.endsWith("USDT")
        ? await buildCrypto(intent.a.endsWith("USDT") ? intent.a : `${intent.a}USDT`)
        : await buildVn(intent.a, false);
    const B =
      KNOWN_CRYPTO.has(intent.b.replace(/USDT$/, "")) || intent.b.endsWith("USDT")
        ? await buildCrypto(intent.b.endsWith("USDT") ? intent.b : `${intent.b}USDT`)
        : await buildVn(intent.b, false);
    built = {
      narrative: `Đối chiếu:\n\n${A.narrative}\n\n${B.narrative}`,
      contract: { compare: [A.contract, B.contract] },
      sectionsUsed: [...new Set([...A.sectionsUsed, ...B.sectionsUsed])],
      symbols: [intent.a, intent.b],
      freshnesses: [...A.freshnesses, ...B.freshnesses],
      persona: "stock_analyst",
    };
  } else {
    built = {
      narrative:
        "Mình có thể hỗ trợ phân tích cổ phiếu VN, crypto, thị trường và tài chính cá nhân. Hãy nêu mã hoặc câu hỏi cụ thể.",
      contract: {},
      sectionsUsed: [],
      symbols: [],
      freshnesses: ["LIVE"],
      persona: "stock_analyst",
    };
  }

  let finalAnswer = built.narrative;
  if (prefs.depth === "concise") finalAnswer = finalAnswer.split("\n\n").slice(0, 3).join("\n\n");

  if (built.persona === "stock_analyst" && prefs.riskDisclosure !== "off") {
    finalAnswer +=
      "\n\n— Phân tích định lượng từ dữ liệu thật, phục vụ nghiên cứu; không phải khuyến nghị đầu tư.";
  }

  const dataFreshness = built.freshnesses.length
    ? worstFreshness(built.freshnesses)
    : built.unavailable
      ? "UNAVAILABLE"
      : "LIVE";
  const confidence = computeConfidence({
    freshness: built.freshnesses,
    coverage: built.unavailable ? 0 : 1,
  });
  const meta = buildMeta({
    source: "orca-agent (deterministic)",
    sourceTimestampMs: Date.now(),
    note: `Persona: ${built.persona} · topic: ${intent.kind}`,
  });
  meta.freshness = dataFreshness;

  return {
    result: {
      answer: finalAnswer,
      mode: "deterministic",
      intent: intent.kind,
      persona: built.persona,
      model: null,
      confidence,
      dataQuality: built.unavailable ? "LOW" : "HIGH",
      dataFreshness,
      context: { sectionsUsed: built.sectionsUsed, symbols: built.symbols },
    },
    meta,
  };
}

export { env };
