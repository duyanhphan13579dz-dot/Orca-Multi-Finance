import "server-only";
import { buildMeta, worstFreshness } from "../freshness";
import { computeConfidence, type Confidence } from "./intelligence";
import { VN_TICKERS } from "../providers/news";
import type { FreshnessStatus, Meta } from "../types";
import type { HistoryTurn } from "./agent-memory";
import { llmChat, llmConfigured } from "../ai/gateway";
import { retrieveRag, formatPassagesForPrompt, type RagBranch } from "../rag";
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

/** SEE REPO: full agent restored from Phase A local patch — if this commit is incomplete, replace from CI artifact phase-a-rag/src/lib/services/agent.ts */
export async function answerQuestion(
  question: string,
  prefs: { depth?: "concise" | "standard" | "deep"; style?: "analyst" | "technical" | "brief"; language?: "vi" | "en"; riskDisclosure?: "standard" | "detailed" | "off" } = {},
  history: HistoryTurn[] = [],
): Promise<{ result: any; meta: Meta }> {
  const route = routeQuestion(question);
  const built = await withTimeoutSafe(buildVnMarketBriefing(), 22000);
  const depth = prefs.depth ?? "standard";
  const isDeep = depth === "deep";
  const isConcise = depth === "concise";
  let answer = built.narrative;
  let mode: "deterministic" | "llm" = "deterministic";
  let model: string | null = null;
  if (llmConfigured()) {
    try {
      let branch: RagBranch = "general";
      if (/thị trường|vn-?index|vn30|khối ngoại/i.test(question)) branch = "market";
      else if (/ngành|sector/i.test(question)) branch = "industry";
      else if (/vàng|dầu|hàng hóa|commodity/i.test(question)) branch = "commodity";
      else if (/cổ phiếu|định giá|phân tích/i.test(question)) branch = "stock";
      const rag = await retrieveRag({ question, symbols: built.symbols ?? [], branch, topK: isDeep ? 8 : 5 });
      const ragBlock = formatPassagesForPrompt(rag.passages);
      const system = `Bạn là ORCA Agent. Chỉ dùng CONTEXT/NARRATIVE và TÀI LIỆU TRUY XUẤT. Không bịa số. Không khuyến nghị mua/bán tuyệt đối. Tiếng Việt. Giọng senior research analyst.`;
      const user = `CÂU HỎI: ${question}\n\nNARRATIVE:\n${built.narrative.slice(0, 10000)}\n\nCONTEXT:\n${JSON.stringify(built.contract).slice(0, 12000)}\n\nTÀI LIỆU TRUY XUẤT:\n${ragBlock}`;
      const r = await llmChat("analysis", {
        system,
        user,
        temperature: isDeep ? 0.48 : 0.32,
        maxTokens: isDeep ? 2800 : isConcise ? 700 : 1600,
        topP: 0.9,
        timeoutMs: isDeep ? 26000 : 20000,
        history: history.slice(-8).map((h) => ({
          role: h.role === "assistant" || (h as any).role === "agent" ? ("assistant" as const) : ("user" as const),
          content: h.content,
        })),
      });
      if (r?.text?.trim()) {
        answer = r.text.trim();
        mode = "llm";
        model = r.model;
      }
    } catch { /* fall through deterministic */ }
  }
  if (prefs.riskDisclosure !== "off") {
    answer += "\n\n— Phân tích từ dữ liệu thật trên ORCA; phục vụ nghiên cứu, không phải khuyến nghị đầu tư.";
  }
  return {
    result: {
      answer,
      mode,
      intent: "general",
      persona: "stock_analyst",
      model,
      confidence: computeConfidence({ freshness: built.freshnesses ?? [], coverage: (built.sectionsUsed ?? []).length }),
      dataQuality: built.unavailable ? "LOW" : "MEDIUM",
      dataFreshness: built.freshnesses?.length ? worstFreshness(built.freshnesses) : "UNAVAILABLE",
      context: { sectionsUsed: built.sectionsUsed ?? [], symbols: built.symbols ?? [] },
      route,
      responses: [],
    },
    meta: buildMeta({ source: "agent", sourceTimestampMs: Date.now(), note: mode === "llm" ? `llm:${model}` : "deterministic" }),
  };
}

async function withTimeoutSafe<T>(p: Promise<T>, ms: number): Promise<T extends AgentBuilt ? AgentBuilt : T> {
  const fallback = {
    narrative: "## Tạm thời thiếu dữ liệu live\n\nData-engine chưa trả về kịp.",
    contract: { degraded: true },
    sectionsUsed: [] as string[],
    symbols: [] as string[],
    freshnesses: [] as any[],
    unavailable: true,
  } as any;
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v as any); } }, () => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}
