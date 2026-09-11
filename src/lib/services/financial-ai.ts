import "server-only";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import { buildMeta } from "../freshness";
import type { Meta } from "../types";
import { getSectorTrendForSymbol } from "./sector-trend";
import { getVnStockDetail } from "./stocks";

export interface FinancialAiAnalysis {
  symbol: string;
  narrative: string;
  structured: {
    healthSummary: string;
    trendSummary: string;
    strengths: string[];
    risks: string[];
    watchpoints: string[];
    outlook: string;
  } | null;
  model: string | null;
  latencyMs: number | null;
  usedLlm: boolean;
  sourceNote: string;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pct(v: number | null): string {
  if (v == null) return "n/a";
  return `${(v * 100).toFixed(1)}%`;
}

function compact(v: number | null): string {
  if (v == null) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toFixed(0);
}

/** Xây context có cấu trúc từ snapshot BCTC + health engine + sector trend */
function buildContext(symbol: string, detail: NonNullable<Awaited<ReturnType<typeof getVnStockDetail>>>["detail"], sector: Awaited<ReturnType<typeof getSectorTrendForSymbol>>) {
  const income = (detail.financials.income ?? []) as Record<string, unknown>[];
  const balance = (detail.financials.balance ?? []) as Record<string, unknown>[];
  const cashflow = (detail.financials.cashflow ?? []) as Record<string, unknown>[];
  const ratios = (detail.financials.ratios ?? []) as Record<string, unknown>[];
  const latestI = income[0] ?? {};
  const latestB = balance[0] ?? {};
  const latestC = cashflow[0] ?? {};
  const h = detail.financialHealth;
  const g = detail.financialGrowth;
  const fm = detail.financialMeta;

  const periods = income.slice(0, 6).map((r) => ({
    period: r.period ?? `${r.year ?? ""}${r.quarter != null ? `Q${r.quarter}` : ""}`,
    netRevenue: num(r.netRevenue) ?? num(r.revenue),
    grossProfit: num(r.grossProfit),
    netIncome: num(r.netIncome) ?? num(r.netProfit),
  }));

  return {
    symbol,
    quote: detail.quote
      ? {
          price: detail.quote.price,
          changePercent: detail.quote.changePercent,
          volume: detail.quote.volume,
        }
      : null,
    financialMeta: {
      latestPeriod: fm?.latestPeriod ?? null,
      primarySource: fm?.primarySource ?? null,
      freshnessStatus: fm?.freshnessStatus ?? null,
      statementScope: fm?.statementScope ?? null,
      reportTypeLabel: fm?.reportTypeLabel ?? null,
    },
    latestIncome: {
      period: latestI.period ?? null,
      netRevenue: num(latestI.netRevenue) ?? num(latestI.revenue),
      grossProfit: num(latestI.grossProfit),
      operatingProfit: num(latestI.operatingProfit) ?? num(latestI.ebit),
      netIncome: num(latestI.netIncome) ?? num(latestI.netProfit),
    },
    latestBalance: {
      totalAssets: num(latestB.totalAssets),
      equity: num(latestB.equity),
      totalLiabilities: num(latestB.totalLiabilities),
      cash: num(latestB.cash),
      currentAssets: num(latestB.currentAssets),
      currentLiabilities: num(latestB.currentLiabilities),
    },
    latestCashflow: {
      operatingCashFlow: num(latestC.operatingCashFlow),
      investingCashFlow: num(latestC.investingCashFlow),
      financingCashFlow: num(latestC.financingCashFlow),
      freeCashFlow: num(latestC.freeCashFlow),
    },
    latestRatios: ratios[0]
      ? {
          grossMargin: num(ratios[0].grossMargin),
          operatingMargin: num(ratios[0].operatingMargin),
          netMargin: num(ratios[0].netMargin),
          roe: num(ratios[0].roe),
          roa: num(ratios[0].roa),
          debtToEquity: num(ratios[0].debtToEquity),
          currentRatio: num(ratios[0].currentRatio),
          ocfToNi: num(ratios[0].ocfToNi),
        }
      : null,
    health: h
      ? {
          overall: h.scores.overall,
          scores: h.scores,
          coverage: h.coverage,
          industry: h.industry,
          riskFlags: h.riskFlags.slice(0, 8),
          anchors: h.anchors,
        }
      : null,
    growth: g
      ? {
          latestPeriod: g.latestPeriod,
          yoy: g.yoy
            .filter((c) => c.changePct != null)
            .slice(0, 8)
            .map((c) => ({ metric: c.metric, changePct: c.changePct })),
          qoq: g.qoq
            .filter((c) => c.changePct != null)
            .slice(0, 8)
            .map((c) => ({ metric: c.metric, changePct: c.changePct })),
        }
      : null,
    incomeTrend: periods,
    sectorTrend: sector?.row
      ? {
          sector: sector.sector,
          trendScore: sector.row.trendScore,
          trendLabelVi: sector.row.trendLabelVi,
          avgChangePercent: sector.row.avgChangePercent,
          advances: sector.row.advances,
          declines: sector.row.declines,
          marketAvgChangePercent: sector.snapshot.marketAvgChangePercent,
        }
      : sector
        ? { sector: sector.sector, trendScore: null, trendLabelVi: "Chưa có dữ liệu ngành" }
        : null,
  };
}

function deterministicFallback(ctx: ReturnType<typeof buildContext>): FinancialAiAnalysis {
  const h = ctx.health;
  const overall = h?.overall;
  const sector = ctx.sectorTrend;
  const yoyNi = ctx.growth?.yoy.find((x) => x.metric === "netIncome" || x.metric === "netRevenue");
  const lines: string[] = [];

  lines.push(
    `**${ctx.symbol}** — đánh giá sức khỏe tài chính (engine nội bộ, không LLM).`,
  );
  lines.push(
    `Điểm tổng: **${overall != null ? Math.round(overall) : "n/a"}/100**` +
      (h?.industry ? ` · Ngành: ${h.industry.labelVi}` : "") +
      (ctx.financialMeta.latestPeriod ? ` · Kỳ: ${ctx.financialMeta.latestPeriod}` : ""),
  );

  if (h?.scores) {
    lines.push(
      `Trụ cột — Sinh lời: ${h.scores.profitability ?? "n/a"}, Thanh khoản: ${h.scores.liquidity ?? "n/a"}, Đòn bẩy: ${h.scores.leverage ?? "n/a"}, Dòng tiền: ${h.scores.cashflow ?? "n/a"}, Hiệu quả: ${h.scores.efficiency ?? "n/a"}.`,
    );
  }

  lines.push(
    `Snapshot BCTC — DT thuần: ${compact(ctx.latestIncome.netRevenue)}, LNST: ${compact(ctx.latestIncome.netIncome)}, Tổng TS: ${compact(ctx.latestBalance.totalAssets)}, VCSH: ${compact(ctx.latestBalance.equity)}, OCF: ${compact(ctx.latestCashflow.operatingCashFlow)}.`,
  );

  if (ctx.latestRatios) {
    lines.push(
      `Chỉ số — ROE ${pct(ctx.latestRatios.roe)}, ROA ${pct(ctx.latestRatios.roa)}, biên ròng ${pct(ctx.latestRatios.netMargin)}, Nợ/VCSH ${ctx.latestRatios.debtToEquity?.toFixed(2) ?? "n/a"}x.`,
    );
  }

  if (sector) {
    lines.push(
      `Xu hướng ngành **${sector.sector}**: ${sector.trendLabelVi ?? "—"}` +
        (sector.trendScore != null ? ` (điểm ${sector.trendScore})` : "") +
        (sector.avgChangePercent != null ? `, %TB ngành ${pct(sector.avgChangePercent / 100)}` : "") +
        ".",
    );
  }

  if (yoyNi?.changePct != null) {
    lines.push(`Tăng trưởng gần nhất (${yoyNi.metric} YoY): ${pct(yoyNi.changePct)}.`);
  }

  if (h?.riskFlags?.length) {
    lines.push(`Cờ rủi ro: ${h.riskFlags.slice(0, 4).join("; ")}.`);
  }

  lines.push("Gợi ý: bật AI_PROVIDER_KEY để có luận điểm AI chi tiết hơn (cùng số liệu snapshot BCTC).");

  return {
    symbol: ctx.symbol,
    narrative: lines.join("\n\n"),
    structured: {
      healthSummary: `Điểm ${overall != null ? Math.round(overall) : "n/a"}/100`,
      trendSummary: sector?.trendLabelVi ?? "Chưa có xu hướng ngành",
      strengths: [],
      risks: h?.riskFlags?.slice(0, 5) ?? [],
      watchpoints: ["Theo dõi kỳ BCTC tiếp theo", "Đối chiếu DStock"],
      outlook: "Phân tích deterministic — chờ LLM để có outlook định tính.",
    },
    model: null,
    latencyMs: null,
    usedLlm: false,
    sourceNote: "Deterministic từ snapshot BCTC + health engine + sector trend",
  };
}

function tryParseStructured(text: string): FinancialAiAnalysis["structured"] {
  // Tìm block JSON nếu model trả về
  const m = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/\{[\s\S]*"healthSummary"[\s\S]*\}/);
  if (!m) return null;
  try {
    const raw = m[1] ?? m[0];
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      healthSummary: String(j.healthSummary ?? ""),
      trendSummary: String(j.trendSummary ?? ""),
      strengths: Array.isArray(j.strengths) ? j.strengths.map(String).slice(0, 6) : [],
      risks: Array.isArray(j.risks) ? j.risks.map(String).slice(0, 6) : [],
      watchpoints: Array.isArray(j.watchpoints) ? j.watchpoints.map(String).slice(0, 6) : [],
      outlook: String(j.outlook ?? ""),
    };
  } catch {
    return null;
  }
}

const SYS = `Bạn là chuyên gia phân tích tài chính doanh nghiệp niêm yết Việt Nam (ORCA).
Nhiệm vụ: đánh giá SỨC KHỎE TÀI CHÍNH và XU HƯỚNG từ context JSON (snapshot BCTC + điểm engine + ngành).

Quy tắc bắt buộc:
1) CHỈ dùng số trong context — không bịa doanh thu, LN, ROE, điểm.
2) Viết tiếng Việt, rõ ràng, 4–7 đoạn ngắn.
3) Cấu trúc nội dung:
   - Tóm tắt sức khỏe (điểm tổng + trụ cột nổi bật)
   - Xu hướng kết quả KD / dòng tiền / ngành
   - Điểm mạnh (bullet)
   - Rủi ro & điểm cần theo dõi
   - Outlook ngắn (không khuyến nghị mua/bán tuyệt đối)
4) Cuối bài thêm một block JSON (fenced \\'\\'\\'json) với keys:
   healthSummary, trendSummary, strengths[], risks[], watchpoints[], outlook
5) Đơn vị tiền: nêu rõ nếu dùng tỷ/triệu; % ghi rõ.
6) Không disclaimer dài dòng.`;

export async function analyzeFinancialHealthAi(
  symbolRaw: string,
): Promise<{ analysis: FinancialAiAnalysis; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase();
  const detailRes = await getVnStockDetail(symbol);
  if (!detailRes?.detail) return null;

  const sector = await getSectorTrendForSymbol(symbol).catch(() => null);
  const ctx = buildContext(symbol, detailRes.detail, sector);

  const hasFs =
    (detailRes.detail.financials.income?.length ?? 0) > 0 ||
    (detailRes.detail.financials.balance?.length ?? 0) > 0;

  if (!hasFs && !detailRes.detail.financialHealth) {
    return {
      analysis: {
        symbol,
        narrative: `${symbol}: chưa có snapshot BCTC để phân tích sức khỏe tài chính.`,
        structured: null,
        model: null,
        latencyMs: null,
        usedLlm: false,
        sourceNote: "No financial snapshot",
      },
      meta: buildMeta({
        source: detailRes.meta.source,
        sourceTimestampMs: detailRes.meta.sourceTimestamp
          ? Date.parse(detailRes.meta.sourceTimestamp)
          : null,
        cached: detailRes.meta.cached,
        stale: true,
        note: "Thiếu BCTC",
      }),
    };
  }

  if (!llmConfigured()) {
    const fb = deterministicFallback(ctx);
    return {
      analysis: fb,
      meta: buildMeta({
        source: detailRes.meta.source,
        sourceTimestampMs: detailRes.meta.sourceTimestamp
          ? Date.parse(detailRes.meta.sourceTimestamp)
          : null,
        cached: detailRes.meta.cached,
        stale: detailRes.meta.stale,
        note: "AI chưa cấu hình — dùng engine deterministic",
      }),
    };
  }

  const user = `Phân tích sức khỏe tài chính và xu hướng cho ${symbol}.\n\nCONTEXT (JSON):\n${JSON.stringify(ctx)}`;

  let llm = await llmChat("analysis", {
    system: SYS,
    user,
    temperature: 0.35,
    maxTokens: 1400,
    timeoutMs: 45_000,
  });

  if (llm) {
    const facts = collectFactNumbers(ctx);
    const val = validateOutput(llm.text, facts, 0.05);
    if (!val.ok && val.unsupported.length > 0) {
      const repair = await llmChat("analysis", {
        system: `${SYS}\nSTRICT REPAIR: chỉ dùng số trong CONTEXT. Các claim trước bị loại: ${val.unsupported
          .slice(0, 6)
          .map((u) => u.raw)
          .join(", ")}.`,
        user,
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 40_000,
      });
      if (repair) llm = repair;
    }
  }

  if (!llm) {
    const fb = deterministicFallback(ctx);
    return {
      analysis: { ...fb, sourceNote: "LLM lỗi — fallback deterministic" },
      meta: buildMeta({
        source: detailRes.meta.source,
        sourceTimestampMs: detailRes.meta.sourceTimestamp
          ? Date.parse(detailRes.meta.sourceTimestamp)
          : null,
        cached: detailRes.meta.cached,
        stale: detailRes.meta.stale,
        note: "LLM unavailable",
      }),
    };
  }

  const structured = tryParseStructured(llm.text);
  // Bỏ block JSON khỏi narrative hiển thị nếu có
  const narrative = llm.text.replace(/```json[\s\S]*?```/gi, "").trim();

  return {
    analysis: {
      symbol,
      narrative,
      structured,
      model: llm.model,
      latencyMs: llm.latencyMs,
      usedLlm: true,
      sourceNote: "LLM analysis trên snapshot BCTC + health + sector trend",
    },
    meta: buildMeta({
      source: `${detailRes.meta.source}+llm:${llm.model}`,
      sourceTimestampMs: detailRes.meta.sourceTimestamp
        ? Date.parse(detailRes.meta.sourceTimestamp)
        : Date.now(),
      cached: false,
      stale: detailRes.meta.stale,
      note: `AI financial analysis · ${llm.latencyMs}ms`,
    }),
  };
}
