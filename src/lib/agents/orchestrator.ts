import "server-only";
import { answerQuestion, type AgentPrefs } from "../services/agent";
import { buildMeta, worstFreshness } from "../freshness";
import { qualityToLabel } from "../quality";
import { runStockAnalyst, runStockAnalystWithLLM, extractStockSymbol } from "./stock-analyst";
import { runPersonalFinance, runBudgetPlanner, looksLikeBudgetQuestion } from "./personal-finance";
import { runWealthManager } from "./wealth-manager";
import type { AgentId, AgentRun } from "./agent-types";
import type { FinancialProfile } from "../finance/financial-profile";
import type { Meta } from "../types";
import { llmConfigured } from "../ai/gateway";
import { pipelineTrace } from "../services/agent-pipeline";

/**
 * AI ORCHESTRATOR — ORCA AI CORE.
 * 1) Phân loại intent (deterministic, không LLM routing).
 * 2) Intent tài chính mới → chọn 1 hoặc NHIỀU agent chuyên biệt (multi-agent).
 * 3) Intent legacy (crypto/forex/commodity/vn-stock/market/news…) → delegate
 *    `answerQuestion` — GIỮ NGUYÊN hành vi/API cũ (compatibility).
 * Không gọi tất cả agent cho mọi câu.
 */

export const FINANCIAL_INTENTS = new Set(["stock-analysis", "stock-budget", "personal-finance", "wealth", "portfolio-scenario"]);

export function classifyFinancial(question: string): {
  intents: AgentId[];
  symbol?: string;
  kind?: string;
} {
  const q = question.toLowerCase();
  const upper = question.toUpperCase();
  const hasMoney = /(\d[\d.,]*\s*(triệu|tỷ|tỉ|tr|m|ty|vnd|đ))/i.test(question) || /mua|đầu tư|invest/i.test(q);
  const symbol = extractStockSymbol(question);

  const wealthIntent = /danh mục|portfolio|phân bổ|tỷ trọng|đa dạng hóa|tái cân bằng|rủi ro danh mục|drawdown|concentration|phơi nhiễm/i.test(q);
  const pfIntent = /thu nhập|chi tiêu|tiết kiệm|nợ|tài chính cá nhân|khẩn cấp|dòng tiền|dti|sức khỏe tài chính|mục tiêu tài chính|tiền mua|ngân sách|budget/i.test(q);
  const stockIntent = /phân tích|định giá|cổ phiếu|stock|báo cáo tài chính|pe\b|p\/e|kỹ thuật|triển vọng|đầu tư (vào|hp|vnm|...)/i.test(q) || !!symbol;

  if (symbol && hasMoney && (stockIntent || /mua HP|bỏ tiền|đầu tư/i.test(q))) {
    // Multi-agent: "500 triệu mua HPG" → Stock + Wealth + Personal Finance
    return { intents: ["stock-analyst", "wealth-manager", "personal-finance"], symbol, kind: "stock-budget" };
  }
  if (symbol && stockIntent) return { intents: ["stock-analyst"], symbol, kind: "stock-analysis" };
  // BUDGET: hỏi ngân sách tiêu (có số tiền + từ khóa chi tiêu) → Budget Planner
  // (trước wealth/pf để không rơi về pipeline thị trường legacy)
  if (looksLikeBudgetQuestion(question)) return { intents: ["personal-finance"], kind: "budget-plan" };
  if (wealthIntent) return { intents: ["wealth-manager"], kind: "wealth" };
  if (pfIntent) return { intents: ["personal-finance"], kind: "personal-finance" };
  return { intents: [], kind: "unknown" };
}

export async function runFinancialOrchestrator(
  question: string,
  prefs: AgentPrefs = {},
  opts: { userId?: string | null; profileOverride?: unknown } = {},
): Promise<{ result: Record<string, unknown>; meta: Meta }> {
  const startedAt = Date.now();
  const cls = classifyFinancial(question);

  /* ------------------------- intent financial mới ------------------------- */
  if (cls.intents.length) {
    let profile: FinancialProfile | null = null;
    let consent = false;
    let authUserId = opts.userId ?? null;
    if (!authUserId) {
      // dynamic import để không kéo auth/db vào test runner
      const { getSessionUser } = await import("../auth").catch(() => ({ getSessionUser: null as never }));
      const sess = await getSessionUser?.().catch(() => null);
      authUserId = sess?.id ?? null;
    }
    if (authUserId) {
      const { getFinancialProfile } = await import("./financial-memory").catch(() => ({ getFinancialProfile: null as never }));
      const mem = await getFinancialProfile?.(authUserId).catch(() => null);
      if (mem) {
        profile = mem.profile;
        consent = mem.consent;
      }
    }
    if (opts.profileOverride) profile = opts.profileOverride as FinancialProfile;

    const agentCtx = { profile: profile ?? null, userId: authUserId, prefs, llm: !!llmConfigured() };
    const runs: AgentRun[] = [];
    const symbols: string[] = [];

    if (cls.intents.includes("stock-analyst")) {
      const symbol = cls.symbol ?? "HPG";
      symbols.push(symbol);
      const run = agentCtx.llm ? await runStockAnalystWithLLM(symbol, { llm: true }) : await runStockAnalyst(symbol);
      runs.push(run);
    }
    if (cls.intents.includes("wealth-manager")) runs.push(await runWealthManager(agentCtx));
    if (cls.intents.includes("personal-finance")) {
      if (cls.kind === "budget-plan") runs.push(await runBudgetPlanner(question));
      else runs.push(await runPersonalFinance(agentCtx));
    }

    const freshnesses = runs.map((r) => r.freshness);
    const dataFreshness = freshnesses.length ? worstFreshness(freshnesses as Meta["freshness"][]) : "UNAVAILABLE";
    const confidence = runs[0]?.confidence ?? null;
    const unavailable = runs.flatMap((r) => r.unavailable);
    const trace = runs.flatMap((r) => r.trace);

    const sections = runs.flatMap((r) => r.sections);
    const answer = composeAnswer(runs, prefs);
    const mode: string = runs.some((r) => r.trace.some((t) => t.startsWith("llm:"))) ? "llm" : "deterministic";

    const meta = buildMeta({
      source: `orca-orchestrator + ${mode}`,
      sourceTimestampMs: Date.now(),
      note: `Orchestrator: ${cls.kind ?? "unknown"} → agents: ${runs.map((r) => r.agent).join(", ")}${unavailable.length ? ` | thiếu: ${[...new Set(unavailable)].join(", ")}` : ""}`,
    });
    meta.freshness = dataFreshness;
    meta.qualityStatus = unavailable.length ? "SUSPECT" : "VALID";
    meta.dataConfidence = confidence;
    meta.providers = [...new Set(runs.flatMap((r) => r.sources))];
    meta.pipeline = pipelineTrace(`financial:${cls.kind ?? "unknown"}`, {
      quant: runs.flatMap((r) => r.sections.map((s) => s.id)),
      overlaid: 0,
      confidenceLevel: confidence?.level ?? null,
      llm: mode === "llm",
    });
    meta.note = `${meta.note ?? ""} | orchestrator:${startedAt}`;

    const result = {
      answer,
      mode,
      intent: `financial:${cls.kind ?? "unknown"}`,
      model: mode === "llm" ? "multi-model" : "orca-deterministic",
      confidence: confidence?.level ?? "LOW",
      dataQuality: qualityToLabel(meta.qualityStatus),
      dataFreshness,
      context: { sectionsUsed: runs.flatMap((r) => r.sections.map((s) => s.id)), symbols },
      agents: runs.map((r) => r.agent),
      sections: sections.map((s) => ({ agent: runs.find((rv) => rv.sections.includes(s))?.agent, id: s.id, title: s.title, label: s.label, body: s.body, sources: s.sources, unavailable: !!s.unavailable })),
      trace,
    };
    return { result, meta };
  }

  /* ---------------------- intent legacy → trả nguyên vẹn ------------------- */
  const { result, meta } = await answerQuestion(question, prefs);
  return { result: result as unknown as Record<string, unknown>, meta };
}

/** Tổng hợp narrative theo phong cách analyst VN: thesis → evidence → analysis → risk → scenario → conclusion. */
function composeAnswer(runs: AgentRun[], prefs: AgentPrefs): string {
  const parts: string[] = [];
  for (const run of runs) {
    const title = run.agent === "stock-analyst" ? "PHÂN TÍCH CỔ PHIẾU" : run.agent === "personal-finance" ? "TÀI CHÍNH CÁ NHÂN" : "QUẢN TRỊ TÀI SẢN";
    parts.push(`## ${title}\n${run.narrative}`);
  }
  if (prefs.depth === "concise") {
    return parts.map((p) => p.split("\n").filter((l) => !l.startsWith("## ")).slice(0, 6).join("\n")).join("\n\n");
  }
  return parts.join("\n\n");
}
