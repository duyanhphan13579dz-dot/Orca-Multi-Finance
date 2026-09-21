export type AgentDomain = "market" | "industry" | "stock" | "commodity" | "general";
export type AgentTask = "overview" | "diagnose" | "compare" | "explain" | "news" | "forecast" | "unknown";
export type AgentTimeframe = "intraday" | "current" | "short_term" | "long_term" | "historical" | "unknown";

export interface AgentEntities {
  symbols: string[];
  industries: string[];
  indices: string[];
  commodities: string[];
}
export interface AgentRequirements {
  realtime: boolean;
  technical: boolean;
  fundamental: boolean;
  valuation: boolean;
  news: boolean;
}
export interface AgentRoute {
  primaryDomain: AgentDomain;
  secondaryDomains: AgentDomain[];
  entities: AgentEntities;
  task: AgentTask;
  timeframe: AgentTimeframe;
  requirements: AgentRequirements;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface AgentResponseContext {
  domain: Exclude<AgentDomain, "general">;
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
  analysis: string[];
  drivers: string[];
  risks: string[];
  catalysts: string[];
  relatedEntities: string[];
  sources: { name: string; updatedAt?: string; quality?: "HIGH" | "MEDIUM" | "LOW" }[];
  dataMeta: { freshestAt?: string; freshness?: string; quality: "HIGH" | "MEDIUM" | "LOW" };
}

export const DOMAIN_LABELS: Record<Exclude<AgentDomain, "general">, string> = {
  market: "Thị trường", industry: "Ngành", stock: "Cổ phiếu", commodity: "Hàng hóa",
};
export const DOMAIN_GUIDES: Record<Exclude<AgentDomain, "general">, string> = {
  market: "AI_MARKET_GUIDE.md", industry: "AI_INDUSTRY_GUIDE.md", stock: "AI_STOCK_GUIDE.md", commodity: "AI_COMMODITY_GUIDE.md",
};
const KNOWN_STOCKS = new Set(["FPT", "CMG", "VCB", "TCB", "HPG", "MWG", "SSI", "GAS", "VIC", "VHM", "MBB", "CTG", "BID", "VPB", "VNM", "MSN"]);
const uniq = (xs: string[]) => [...new Set(xs)];

function detectIndustries(q: string) {
  const map: [RegExp, string][] = [[/ngân hàng|banking/i, "banking"], [/dầu khí|oil.?gas/i, "oil-gas"], [/thép|steel/i, "steel"], [/công nghệ|technology/i, "technology"], [/bất động sản|real estate/i, "real-estate"], [/bán lẻ|retail/i, "retail"]];
  return uniq(map.filter(([re]) => re.test(q)).map(([, value]) => value));
}
function detectCommodities(q: string) {
  const map: [RegExp, string][] = [[/vàng|gold/i, "gold"], [/bạc|silver/i, "silver"], [/dầu|oil|wti|brent/i, "oil"], [/hrc|thép/i, "steel"], [/đồng|copper/i, "copper"], [/cà phê|coffee/i, "coffee"]];
  return uniq(map.filter(([re]) => re.test(q)).map(([, value]) => value));
}

export function routeQuestion(question: string): AgentRoute {
  const q = question.trim();
  const lower = q.toLowerCase();
  const upper = q.toUpperCase();
  const symbols = uniq((upper.match(/\b[A-Z]{3}\b/g) ?? []).filter((x) => KNOWN_STOCKS.has(x)));
  const industries = uniq([...detectIndustries(q), ...(symbols.includes("GAS") && /dầu|oil|wti|brent/i.test(q) ? ["oil-gas"] : [])]);
  const commodities = detectCommodities(q);
  const indices = uniq((lower.match(/vn-?index|vn30|hnx|hose/g) ?? []).map((x) => x.toUpperCase().replace("-", "")));
  const domains: AgentDomain[] = [];
  if (/(thị trường|vn-?index|vn30|hose|hnx|toàn cảnh|chỉ số|market|thanh khoản|khối ngoại)/i.test(q) || indices.length) domains.push("market");
  if (/(ngành|sector|banking|ngân hàng|dầu khí|thép|công nghệ|bất động sản|bán lẻ)/i.test(q) || industries.length) domains.push("industry");
  if (symbols.length || /cổ phiếu|mã cổ phiếu|ticker|định giá|phân tích\s+[A-Z]{3}/i.test(q)) domains.push("stock");
  if (/(vàng|gold|bạc|silver|dầu|oil|wti|brent|hrc|đồng|cà phê|hàng hóa|commodity)/i.test(q) || commodities.length) domains.push("commodity");
  const orderedDomains: AgentDomain[] = commodities.length && !domains.includes("market") && /ảnh hưởng|tác động|giá\s+(hrc|dầu|vàng|oil)/i.test(q)
    ? ["commodity", ...domains.filter((d) => d !== "commodity")]
    : domains;
  const primaryDomain = orderedDomains[0] ?? "general";
  const secondaryDomains: AgentDomain[] = [...new Set(orderedDomains.slice(1))];
  const task: AgentTask = /so sánh|vs\b|đối chiếu/i.test(q) ? "compare" : /ảnh hưởng|tác động|vì sao|tại sao/i.test(q) ? "diagnose" : /tin tức|news/i.test(q) ? "news" : /dự báo|forecast|sắp tới/i.test(q) ? "forecast" : /thế nào|ra sao|hôm nay|tổng quan/i.test(q) ? "overview" : "explain";
  const timeframe: AgentTimeframe = /hôm nay|hiện tại|đang|realtime|intraday/i.test(q) ? "current" : /ngắn hạn|tuần tới|1 tháng/i.test(q) ? "short_term" : /dài hạn|năm tới/i.test(q) ? "long_term" : /lịch sử|quá khứ/i.test(q) ? "historical" : "unknown";
  const requirements: AgentRequirements = {
    realtime: timeframe === "current" || /giá|hôm nay|hiện tại|realtime/i.test(q),
    technical: /kỹ thuật|technical|rsi|macd|xu hướng|chart/i.test(q),
    fundamental: /cơ bản|bctc|doanh thu|lợi nhuận|fundamental/i.test(q),
    valuation: /định giá|p\/e|p\/b|eps|valuation/i.test(q),
    news: /tin tức|news|sự kiện/i.test(q),
  };
  return { primaryDomain, secondaryDomains, entities: { symbols, industries, indices, commodities }, task, timeframe, requirements, confidence: domains.length >= 2 ? "HIGH" : domains.length ? "MEDIUM" : "LOW" };
}

export function domainsForRoute(route: AgentRoute): Exclude<AgentDomain, "general">[] {
  return [route.primaryDomain, ...route.secondaryDomains].filter((d): d is Exclude<AgentDomain, "general"> => d !== "general");
}
export function createResponseContext(domain: Exclude<AgentDomain, "general">, built: { narrative: string; contract: Record<string, unknown>; symbols: string[]; freshnesses: string[]; sectionsUsed: string[]; unavailable?: boolean }): AgentResponseContext {
  const lines = built.narrative.split("\n").map((x) => x.replace(/^#+\s*/, "").trim()).filter(Boolean);
  const quality = built.unavailable ? "LOW" : built.sectionsUsed.length >= 3 ? "HIGH" : "MEDIUM";
  const list = (key: string, fallback: string[]) => Array.isArray(built.contract[key]) ? built.contract[key].filter((x): x is string => typeof x === "string") : fallback;
  return { domain, title: DOMAIN_LABELS[domain], summary: lines[1] ?? lines[0] ?? "Chưa có tóm tắt dữ liệu.", metrics: built.contract, analysis: lines.slice(1, 7), drivers: list("drivers", []), risks: list("risks", ["Dữ liệu có thể trễ hoặc thiếu khi upstream không khả dụng."]), catalysts: list("catalysts", []), relatedEntities: built.symbols, sources: built.sectionsUsed.map((name) => ({ name, quality })), dataMeta: { freshness: built.freshnesses[0], quality } };
}

export const ROUTER_VERSION = "domain-router-v1";
export const RESPONSE_CONTRACT_VERSION = "agent-response-context-v1";
export const route = routeQuestion;
export default routeQuestion;

export function routeAcceptanceCases() {
  return [
    ["Thị trường hôm nay thế nào?", ["market"]], ["Ngành ngân hàng thế nào?", ["industry"]], ["Phân tích FPT", ["stock"]], ["Giá vàng hôm nay?", ["commodity"]], ["Dầu tăng ảnh hưởng GAS thế nào?", ["commodity", "industry", "stock"]], ["VN-Index giảm thì FPT có bị ảnh hưởng không?", ["market", "stock"]], ["Ngành thép hưởng lợi gì từ giá HRC?", ["commodity", "industry"]], ["FPT hay CMG có nền tảng tài chính tốt hơn?", ["stock"]],
  ] as const;
}
