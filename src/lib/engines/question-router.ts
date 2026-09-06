/**
 * QUESTION ROUTER (Phase 4) — bước 1 của pipeline: User Question → intent.
 *
 * Thuần & xác định: đọc câu hỏi, trả intent + symbol. Không LLM — routing
 * phải deterministic để pipeline trace được và test được. Kế thừa ngữ nghĩa
 * detectIntent của agent v1, mở rộng intent Market Intelligence (Phase 3).
 */

export type AgentIntent =
  | { kind: "crypto"; symbol: string }
  | { kind: "forex"; pair: string }
  | { kind: "vn-stock"; symbol: string }
  | { kind: "commodity"; query: string }
  | { kind: "market" }
  | { kind: "market-breadth" }
  | { kind: "market-sectors" }
  | { kind: "market-state" }
  | { kind: "market-leaders" }
  | { kind: "market-events" }
  | { kind: "market-smart-alerts" }
  | { kind: "compare"; a: string; b: string }
  | { kind: "news"; query?: string }
  | { kind: "general" };

export const KNOWN_CRYPTO = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "TON", "AVAX", "LINK", "DOT", "TRX", "LTC", "BCH", "NEAR", "SUI", "APT", "ARB", "OP", "INJ", "TIA", "SEI", "PEPE", "SHIB", "UNI", "ATOM", "FIL", "ETC", "AAVE", "MKR", "ALGO", "VET", "ICP", "FET", "RENDER", "WLD", "JUP", "ENA", "ONDO", "POL", "XLM", "HBAR", "KAS", "TAO", "IP", "PI", "ZEC", "STRK", "PAXG",
]);

export const FX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "EURJPY", "EURGBP", "GBPJPY", "AUDJPY", "USDVND"];

export const COMMODITY_WORDS: [RegExp, string][] = [
  [/vàng|gold/i, "gold"], [/bạc|silver/i, "silver"], [/dầu|oil|wti|brent/i, "oil"],
  [/cà phê|coffee/i, "coffee"], [/thép|steel/i, "steel"], [/đường|sugar/i, "sugar"],
  [/khí|gas|natgas/i, "natgas"], [/đồng\b|copper/i, "copper"],
];

export function routeQuestion(q: string, vnTickers: readonly string[] = []): AgentIntent {
  const upper = q.toUpperCase();
  const known = (t: string) => KNOWN_CRYPTO.has(t) || vnTickers.includes(t) || FX_PAIRS.includes(t);

  // Market Intelligence intents (Phase 3 modules) — ưu tiên trước general
  if (/độ rộng|breadth|tăng giảm toàn thị trường|số mã tăng/i.test(q)) return { kind: "market-breadth" };
  if (/ngành|sector|xoay vòng|rotation|dòng tiền ngành/i.test(q)) return { kind: "market-sectors" };
  if (/trạng thái thị trường|regime|thị trường đang.*(tăng|giảm|đi ngang)/i.test(q)) return { kind: "market-state" };
  if (/dẫn dắt|leader|leading|đầu tàu|cổ phiếu mạnh nhất/i.test(q)) return { kind: "market-leaders" };
  if (/sự kiện|event|biến động nổi bật/i.test(q)) return { kind: "market-events" };
  if (/cảnh báo thông minh|smart alert|tín hiệu thị trường/i.test(q)) return { kind: "market-smart-alerts" };

  if (/so sánh|compare|\bvs\b|\bversus\b/i.test(q)) {
    const tokens = upper.match(/\b[A-Z]{2,10}\b/g) ?? [];
    const meaningful = tokens.filter(known);
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
  for (const t of upper.match(/\b[A-Z]{3}\b/g) ?? []) if (vnTickers.includes(t)) return { kind: "vn-stock", symbol: t };
  for (const [re, key] of COMMODITY_WORDS) if (re.test(q)) return { kind: "commodity", query: key };
  if (/thị trường|market|tổng quan|hôm nay|tình hình|đánh giá chung|bức tranh/i.test(q)) return { kind: "market" };
  if (/tin tức|news|sự kiện/i.test(q)) return { kind: "news" };
  return { kind: "general" };
}

export function intentLabel(intent: AgentIntent): string {
  const map: Record<AgentIntent["kind"], string> = {
    crypto: "phân tích crypto",
    forex: "phân tích ngoại hối",
    "vn-stock": "phân tích cổ phiếu VN",
    commodity: "phân tích hàng hoá",
    market: "tổng quan thị trường",
    "market-breadth": "độ rộng thị trường",
    "market-sectors": "xoay vòng ngành",
    "market-state": "trạng thái thị trường",
    "market-leaders": "cổ phiếu dẫn dắt",
    "market-events": "sự kiện thị trường",
    "market-smart-alerts": "cảnh báo thông minh",
    compare: "so sánh tài sản",
    news: "tin tức",
    general: "tổng hợp",
  };
  return map[intent.kind];
}
