import "server-only";
import { executeTool } from "./tools";
import { numVn, pctVn, type AgentRun, type AgentSection } from "./agent-types";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import type { ToolResult } from "./tool-types";

/**
 * STOCK ANALYST AGENT — phân tích cổ phiếu VN theo cấu trúc:
 * thesis → sức mạnh → động lực → định giá → kỹ thuật → xúc tác → rủi ro →
 * invalidation → kết luận. KHÔNG kết luận từ 1 chỉ số: cần ≥ 2 nhóm bằng chứng.
 * Mọi số liệu từ Tool Layer (data engine); thiếu → DATA_UNAVAILABLE, không bịa.
 */

const STOPWORDS = new Set([
  "THE", "THI", "CUA", "GIA", "CO", "KHONG", "MUA", "BAN", "PHAN", "TICH", "HOM", "NAY", "NHU", "THE", "NAO", "GIUP",
  "AN", "DANH", "MUC", "VIET", "TOT", "VUA", "PHU", "HOP", "TIEN", "BAC", "VON", "LO", "THEM", "DANG", "NANG", "CAO",
]);

const VN_KEYWORDS = new Set([
  "HPG", "VNM", "VIC", "VHM", "TCB", "CTG", "BID", "VCB", "MBB", "ACB", "SSI", "VND", "FPT", "MWG", "PNJ",
  "GAS", "PLX", "CTD", "KBC", "NLG", "DIG", "KDH", "GEX", "DPM", "AAA", "HSG", "NKG", "POW", "EIB", "STB", "LPB",
  "OCB", "VIB", "TPB", "HDB", "TCB", "NVL", "QCG", "DXG", "HAH", "VOS", "VTO", "DBC", "HUT", "ROX", "BCM", "SAB",
]);

interface ToolFacts {
  quote: ToolResult | null;
  profile: ToolResult | null;
  financials: ToolResult | null;
  valuation: ToolResult | null;
  technicals: ToolResult | null;
  history: ToolResult | null;
  news: ToolResult | null;
  market: ToolResult | null;
  sectors: ToolResult | null;
}

export function extractStockSymbol(question: string): string | null {
  const upper = question.toUpperCase();
  const tokens = upper.match(/\b[A-Z]{3,4}\b/g) ?? [];
  for (const t of tokens) {
    if (VN_KEYWORDS.has(t) && !STOPWORDS.has(t)) return t;
  }
  return null;
}

export async function runStockAnalyst(symbol: string, ctx: { llm?: boolean } = {}): Promise<AgentRun> {
  const trace: string[] = ["stock-analyst"];
  const unavailable: string[] = [];

  const [quote, profile, financials, valuation, technicals, history, news, market, sectors] = await Promise.all([
    executeTool("get_stock_quote", { symbol }, {}),
    executeTool("get_stock_profile", { symbol }, {}),
    executeTool("get_stock_financials", { symbol }, {}),
    executeTool("get_stock_valuation", { symbol }, {}),
    executeTool("get_stock_technicals", { symbol }, {}),
    executeTool("get_stock_history", { symbol, limit: 250 }, {}),
    executeTool("get_stock_news", { symbol, limit: 5 }, {}),
    executeTool("market_context", {}, {}),
    executeTool("sector_context", {}, {}),
  ]);

  const facts: ToolFacts = { quote, profile, financials, valuation, technicals, history, news, market, sectors };

  if (!quote?.ok) unavailable.push("quote");
  if (!financials?.ok) unavailable.push("financials");
  if (!valuation?.ok) unavailable.push("valuation");
  if (!technicals?.ok) unavailable.push("technicals");
  if (!news?.ok) unavailable.push("news");
  if (!market?.ok) unavailable.push("market_context");

  const sections: AgentSection[] = [];

  // 1. THESIS (FACT/data-driven tổng hợp) — luôn có section, thiếu → UNAVAILABLE
  if (quote?.ok) {
    const q = quote.data as { symbol: string; name: string | null; price: number; changePercent: number | null; high: number | null; low: number | null; volume: number | null; currency: string };
    sections.push({
      id: "quote",
      title: "Bức tranh hiện tại",
      label: "FACT",
      body: `${q.name ?? q.symbol} đang giao dịch tại ${numVn(q.price)} ${q.currency ?? "VND"}${q.changePercent != null ? ` (${pctVn(q.changePercent)} trong phiên)` : ""}${q.high != null && q.low != null ? `; phiên: cao ${numVn(q.high)} / thấp ${numVn(q.low)}` : ""}${q.volume != null ? `; khối lượng ${q.volume.toLocaleString("vi-VN")} cp` : ""}.`,
      data: q,
      sources: [quote.meta?.source ?? "vndirect"],
    });
  } else {
    sections.push({ id: "quote", title: "Bức tranh hiện tại", label: "FACT", body: `Không lấy được báo giá ${symbol} (VNDirect offline) — không suy diễn giá.`, data: null, sources: [], unavailable: true });
  }

  if (profile?.ok) {
    const pr = profile.data as Record<string, unknown>;
    sections.push({
      id: "profile",
      title: "Hồ sơ doanh nghiệp",
      label: "FACT",
      body: `${symbol}${pr.name ? ` — ${pr.name}` : ""}${pr.exchange ? `, sàn ${pr.exchange}` : ""}${pr.industry ? `, ngành ${pr.industry}` : ""}${pr.listingDate ? `, niêm yết ${pr.listingDate}` : ""}${pr.establishedYear ? `, thành lập ${pr.establishedYear}` : ""}.`,
      data: pr,
      sources: ["vndirect"],
    });
  }

  // 2. SỨC MẠNH / ĐỘNG LỰC (financial health + valuation + news)
  const healthEvidence: string[] = [];
  if (financials?.ok) {
    const f = financials.data as { financialHealth?: { scores?: { overall?: number | null }; groups?: Record<string, { roe?: number | null; debtToEquity?: number | null; fcfTtm?: number | null }> }; valuation?: { multiples?: { pe?: number | null; pb?: number | null } } | null; notes?: string[] };
    const h = f.financialHealth;
    const g = h?.groups;
    const roe = g?.profitability?.roe;
    const de = g?.leverage?.debtToEquity;
    const fcf = g?.cashflow?.fcfTtm;
    if (h?.scores?.overall != null) {
      healthEvidence.push(`Sức khỏe tài chính ${h.scores.overall}/100`);
      if (roe != null) healthEvidence.push(`ROE ${(roe * 100).toFixed(1)}%`);
      if (de != null) healthEvidence.push(`D/E ${de.toFixed(2)}x`);
      if (fcf != null) healthEvidence.push(`FCF TTM ${numVn(fcf)}`);
    }
    if (h?.scores?.overall == null && (f.notes?.length)) unavailable.push("financials-detail");
    sections.push({
      id: "financials",
      title: "Sức mạnh tài chính",
      label: "DATA-DRIVEN",
      body: healthEvidence.length ? healthEvidence.join(" · ") + "." : "Chưa đủ dữ liệu báo cáo tài chính để đánh giá — hệ thống không suy diễn.",
      data: f,
      sources: ["vndirect-financials", "financial-health-engine"],
      unavailable: !healthEvidence.length,
    });
  } else {
    sections.push({ id: "financials", title: "Sức mạnh tài chính", label: "DATA-DRIVEN", body: "Dữ liệu tài chính không khả dụng (VNDirect offline) — không suy diễn con số.", data: null, sources: [], unavailable: true });
  }

  // 3. ĐỊNH GIÁ
  if (valuation?.ok) {
    const v = valuation.data as { multiples?: { pe?: number | null; pb?: number | null }; dcf?: { label?: string; intrinsicPerShare?: number }[] | null };
    const pe = v.multiples?.pe;
    const pb = v.multiples?.pb;
    const dcfBase = v.dcf?.find((s) => s.label === "Base");
    const lines = [
      pe != null ? `P/E ${pe.toFixed(1)}x` : null,
      pb != null ? `P/B ${pb.toFixed(1)}x` : null,
      dcfBase?.intrinsicPerShare != null ? `DCF Base ${numVn(dcfBase.intrinsicPerShare)}đ/cp` : null,
    ].filter(Boolean);
    sections.push({
      id: "valuation",
      title: "Định giá",
      label: "DATA-DRIVEN",
      body: lines.length ? `Theo valuation engine: ${lines.join(" · ")}. Định giá chỉ có ý nghĩa khi đối chiếu với tăng trưởng và rủi ro — không kết luận từ một chỉ số.` : "Chưa đủ dữ liệu để định giá (cần báo cáo + giá).",
      data: v,
      sources: ["valuation-engine"],
      unavailable: !lines.length,
    });
  } else {
    sections.push({ id: "valuation", title: "Định giá", label: "DATA-DRIVEN", body: "Chưa lấy được dữ liệu định giá (cần báo cáo + giá từ VNDirect).", data: null, sources: [], unavailable: true });
  }

  // 4. KỸ THUẬT
  if (technicals?.ok) {
    const t = technicals.data as Record<string, unknown>;
    const signals = Array.isArray(t.signals) ? (t.signals as string[]).join(", ") : null;
    const rsi = t.rsi14 as number | null;
    const trend = t.trend as string | null;
    const su = t.support as number | null;
    const res = t.resistance as number | null;
    const atr = t.atr14 as number | null;
    const lines = [
      trend ? `Xu hướng: ${trend}` : null,
      rsi != null ? `RSI14 ${rsi.toFixed(1)}` : null,
      su != null ? `Hỗ trợ ${numVn(su)}` : null,
      res != null ? `Kháng cự ${numVn(res)}` : null,
      atr != null ? `ATR14 ${numVn(atr)}` : null,
      signals ? `Tín hiệu: ${signals}` : null,
    ].filter(Boolean);
    sections.push({
      id: "technicals",
      title: "Phân tích kỹ thuật",
      label: "DATA-DRIVEN",
      body: lines.length ? lines.join(" · ") + "." : "Chưa đủ dữ liệu OHLCV.",
      data: t,
      sources: ["technical-engine"],
      unavailable: !lines.length,
    });
  } else {
    sections.push({ id: "technicals", title: "Phân tích kỹ thuật", label: "DATA-DRIVEN", body: "Chưa đủ dữ liệu OHLCV (VNDirect offline) — không suy diễn tín hiệu.", data: null, sources: [], unavailable: true });
  }

  // 5. XÚC TÁC (news + market)
  if (news?.ok) {
    const n = news.data as { articles: { title: string; source: string; publishedAt: string }[] };
    sections.push({
      id: "catalysts",
      title: "Xúc tác gần đây",
      label: "FACT",
      body: n.articles.length ? n.articles.slice(0, 4).map((a) => `"${a.title}" (${a.source}, ${a.publishedAt.slice(0, 10)})`).join("; ") : "Không có tin mới đáng chú ý.",
      data: n,
      sources: ["rss-multifeed"],
      unavailable: !n.articles.length,
    });
  } else {
    sections.push({ id: "catalysts", title: "Xúc tác gần đây", label: "FACT", body: "Không lấy được tin mới cho mã này — phần xúc tác bỏ trống (không bịa).", data: null, sources: [], unavailable: true });
  }

  // 6. RỦI RO & BỐI CẢNH
  const riskLines: string[] = [];
  if (market?.ok) {
    const m = market.data as { regime?: { regimeLabelVi?: string; riskAppetite?: number | null; volatilityRatio?: number | null; note?: string | null } | null };
    if (m.regime) {
      riskLines.push(`Thị trường: ${m.regime.regimeLabelVi ?? "—"}${m.regime.riskAppetite != null ? ` (risk appetite ${m.regime.riskAppetite}/100)` : ""}${m.regime.volatilityRatio != null ? `, vol30/vol120 ${m.regime.volatilityRatio.toFixed(2)}x` : ""}`);
    }
  }
  if (technicals?.ok) {
    const t = technicals.data as { volatility30d?: number | null; max_drawdown_52w?: number | null };
    if (t.volatility30d != null) riskLines.push(`Biến động 30 ngày ${t.volatility30d.toFixed(1)}%`);
    if (t.max_drawdown_52w != null) riskLines.push(`drawdown 52 tuần ${(t.max_drawdown_52w * 100).toFixed(0)}%`);
  }
  sections.push({
    id: "risks",
    title: "Rủi ro cần theo dõi",
    label: "DATA-DRIVEN",
    body: riskLines.length ? riskLines.join(" · ") + "." : "Chưa đủ dữ liệu rủi ro — cần phiên bản đầy đủ (volatility/drawdown/regime).",
    data: { regime: market?.ok ? (market.data as Record<string, unknown>).regime : null, technicals: technicals?.ok ? technicals.data : null },
    sources: ["market-regime-engine", "technical-engine"],
    unavailable: !riskLines.length,
  });

  // 7. INVALIDATION + 8. KẾT LUẬN — luôn có evidence tiers
  const conviction = buildConviction({ sections, unavailable });
  sections.push({
    id: "invalidation",
    title: "Khi nào luận điểm sai",
    label: "MODEL-INFERENCE",
    body: conviction.invalidation,
    data: { rules: conviction.rules },
    sources: ["stock-analyst-rules"],
  });
  sections.push({
    id: "conclusion",
    title: "Kết luận",
    label: conviction.level === "LOW" ? "OPINION" : "DATA-DRIVEN",
    body: conviction.conclusion,
    data: { level: conviction.level, evidenceCount: conviction.evidenceCount, maxRating: "KHÔNG PHẢI KHUYẾN NGHỊ" },
    sources: ["stock-analyst-synthesis"],
  });

  const narrative = sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
  const freshness = sourcesFreshness([quote, financials, valuation, technicals, news, market, profile]);
  return {
    agent: "stock-analyst",
    sections,
    narrative,
    symbols: [symbol],
    sources: [...new Set(sections.flatMap((s) => s.sources))],
    freshness,
    confidence: null,
    unavailable,
    trace: [...trace, `levels:${conviction.level}`, `evidence:${conviction.evidenceCount}`],
  };
}

function sourcesFreshness(results: (ToolResult | null)[]): AgentRun["freshness"] {
  const statuses = results.filter((r) => r?.meta?.freshness).map((r) => r!.meta!.freshness!) as ("LIVE" | "FRESH" | "DELAYED" | "STALE" | "DEGRADED" | "UNAVAILABLE")[];
  if (!statuses.length) return "UNAVAILABLE";
  const rank: Record<string, number> = { LIVE: 4, FRESH: 3, DELAYED: 2, DEGRADED: 1, STALE: 0, UNAVAILABLE: 0 };
  const worst = statuses.reduce((a, b) => (rank[a] <= rank[b] ? a : b));
  return worst as AgentRun["freshness"];
}

/** Đánh giá mức độ thuyết phục dựa trên SỐ NHÓM BẰNG CHỨNG (không từ 1 chỉ số). */
function buildConviction(args: { sections: AgentSection[]; unavailable: string[] }): {
  level: "HIGH" | "MEDIUM" | "LOW";
  evidenceCount: number;
  invalidation: string;
  conclusion: string;
  rules: string[];
} {
  const dataDriven = args.sections.filter((s) => s.label === "DATA-DRIVEN" && !s.unavailable);
  const facts = args.sections.filter((s) => s.label === "FACT" && !s.unavailable);
  const count = dataDriven.length + facts.length;
  const level: "HIGH" | "MEDIUM" | "LOW" = count >= 5 ? "HIGH" : count >= 3 ? "MEDIUM" : count >= 2 ? "LOW" : "LOW";
  const missingNote = args.unavailable.length ? ` (còn thiếu: ${args.unavailable.join(", ")})` : "";
  const invalidation =
    level === "HIGH"
      ? "Luận điểm bị bác khi: giá đóng cửa dưới vùng hỗ trợ kỹ thuật đã nêu, hoặc báo cáo quý tới cho thấy ROE/Dòng tiền suy giảm so với kỳ vọng, hoặc thị trường chuyển sang risk-off mạnh (regime xấu đi)."
      : "Với dữ liệu hiện có, chưa đủ cơ sở để nêu invalidation cụ thể — cần thêm báo cáo tài chính, định giá và kỹ thuật.";
  const conclusion =
    level === "HIGH"
      ? `Dữ liệu hiện có cho thấy ${count} nhóm bằng chứng nhất quán; đây là phân tích định lượng, KHÔNG PHẢI KHUYẾN NGHỊ đầu tư${missingNote}. Hãy đối chiếu thêm thanh khoản và kế hoạch quản trị rủi ro trước khi hành động.`
      : level === "MEDIUM"
        ? `Có ${count} nhóm bằng chứng nhưng chưa đủ để kết luận mạnh${missingNote}. Giá trị chính của phân tích là các con số FACT đã trình bày — không suy diễn thêm.`
        : `Chưa đủ dữ liệu để kết luận (chỉ ${count} nhóm bằng chứng, thiếu: ${args.unavailable.join(", ") || "không xác định"}). Hệ thống KHÔNG bịa — hãy kiểm tra nguồn dữ liệu (VNDirect) hoặc thử lại sau.`;
  return { level, evidenceCount: count, invalidation, conclusion, rules: ["min-2-evidence", "no-single-metric-conclusion", "no-fabrication"] };
}

export async function runStockAnalystWithLLM(symbol: string, ctx: { llm?: boolean } = {}): Promise<AgentRun> {
  const base = await runStockAnalyst(symbol, ctx);
  if (!ctx.llm || !llmConfigured()) return base;
  try {
    const user = `Phân tích cổ phiếu ${symbol} — chỉ dùng dữ liệu trong các section sau:\n${base.narrative}`;
    const facts = new Set<number>(collectFactNumbers(base.narrative));
    const res = await llmChat("analysis", {
      system:
        "Bạn là Stock Analyst VN. Viết lại phân tích tự nhiên, phong cách analyst: thesis → bằng chứng → rủi ro → kịch bản → kết luận. TUYỆT ĐỐI chỉ dùng số đã cho; không thêm P/E, target value, recommendation hay bất kỳ con số nào không có trong dữ liệu.",
      user,
      temperature: 0.3,
      maxTokens: 900,
    });
    if (!res) {
      base.trace.push("llm:fallback-deterministic");
      return base;
    }
    const val = validateOutput(res.text, facts);
    if (val.ok) {
      base.sections = [...base.sections, { id: "llm-synthesis", title: "Tổng hợp", label: "DATA-DRIVEN", body: res.text, data: null, sources: [`orca-agent + ${res.model}`] }];
      base.narrative = res.text;
      base.trace.push(`llm:${res.model}`);
    }
  } catch {
    base.trace.push("llm:fallback-deterministic");
  }
  return base;
}
