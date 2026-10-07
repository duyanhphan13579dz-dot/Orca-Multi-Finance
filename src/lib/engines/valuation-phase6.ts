/**
 * VALUATION ENGINE — Phase 6
 * AI Valuation Analyst: explains Phase 1–5 outputs only.
 * HARD RULES: never invent numbers; never recalculate; null → say so; deterministic always works.
 */

import "server-only";
import { llmChat, llmConfigured } from "../ai/gateway";

export const VALUATION_ENGINE_VERSION_PHASE6 = "2.5.0-phase6";

/** Structural input from computeValuation — avoids circular import with valuation.ts */
export interface AnalystEngineResult {
  price: number;
  marketCap: number | null;
  enterpriseValue: number | null;
  multiples: {
    pe: number | null;
    pb: number | null;
    ps: number | null;
    pfcf: number | null;
    pcf: number | null;
    evEbitda: number | null;
    fcfYield: number | null;
    earningsYield: number | null;
    dividendYield: number | null;
  };
  dcf: {
    label: string;
    intrinsicPerShare: number;
    growthY1to5: number;
    terminalGrowth: number;
    discountRate: number;
  }[] | null;
  fairValue?: {
    blendedFairValue: number | null;
    upsidePct: number | null;
    valuationStatus: string | null;
    confidence?: string | null;
    methods: {
      dcfBase: number | null;
      dcfBear: number | null;
      dcfBull: number | null;
      peBased: number | null;
      pbBased: number | null;
      evEbitdaBased: number | null;
      pfcfBased: number | null;
    };
  } | null;
  phase4?: {
    methodPrices: {
      residualIncome: number | null;
      ddm: number | null;
      nav: number | null;
      sotp: number | null;
    };
    ddm?: { status: string } | null;
    sotp?: { status: string } | null;
  } | null;
  phase5?: {
    finalFairValue: number | null;
    valuationScore: number;
    grade: string;
    valuationStatus: string;
    profileId: string | null;
    confidenceBands: {
      low: number | null;
      base: number | null;
      high: number | null;
      bandWidthPct: number | null;
    };
    score: {
      upsidePct: number | null;
      breakdown: {
        upsideScore: number;
        agreementScore: number;
        dataQualityScore: number;
        coverageScore: number;
        drivers: string[];
      };
      industryBlend: { methodsUsed: string[]; methodCount: number };
    };
  } | null;
  dataQuality: number | null;
  confidence: string;
  notes: string[];
  valuationEngineVersion: string;
}

export interface ValuationAnalystSnapshot {
  symbol: string | null;
  asOf: string;
  engineVersion: string;
  market: {
    price: number | null;
    marketCap: number | null;
    enterpriseValue: number | null;
  };
  multiples: {
    pe: number | null;
    pb: number | null;
    ps: number | null;
    pfcf: number | null;
    pcf: number | null;
    evEbitda: number | null;
    fcfYieldPct: number | null;
    earningsYieldPct: number | null;
    dividendYieldPct: number | null;
  };
  fairValue: {
    blended: number | null;
    low: number | null;
    base: number | null;
    high: number | null;
    bandWidthPct: number | null;
    upsidePct: number | null;
    status: string | null;
    methods: Record<string, number | null>;
  };
  score: {
    value: number | null;
    grade: string | null;
    drivers: string[];
    breakdown: Record<string, number> | null;
  };
  industry: {
    profileId: string | null;
    methodsUsed: string[];
  };
  dcf: {
    available: boolean;
    scenarios: {
      label: string;
      fairPrice: number | null;
      growth: number | null;
      terminalGrowth: number | null;
      discountRate: number | null;
    }[];
  };
  dataQuality: number | null;
  confidence: string | null;
  notes: string[];
  gaps: string[];
}

function gapsFromResult(v: AnalystEngineResult): string[] {
  const g: string[] = [];
  const m = v.multiples;
  if (m.pe == null) g.push("Thiếu P/E (EPS ≤ 0 hoặc không có)");
  if (m.pb == null) g.push("Thiếu P/B");
  if (m.pfcf == null) g.push("Thiếu P/FCF (FCF ≤ 0 hoặc không có)");
  if (m.evEbitda == null) g.push("Thiếu EV/EBITDA");
  if (!v.dcf?.length) g.push("DCF không chạy được (thiếu FCF dương hoặc shares)");
  if (v.phase4?.ddm?.status === "not_applicable") g.push("DDM không áp dụng (không có cổ tức dương)");
  if (v.phase4?.sotp?.status === "not_applicable") g.push("SOTP không có segment breakdown");
  if (v.fairValue?.blendedFairValue == null && v.phase5?.finalFairValue == null) {
    g.push("Chưa tổng hợp được Fair Value blended");
  }
  if (v.dataQuality != null && v.dataQuality < 50) g.push("Data quality thấp (<50)");
  if ((v.phase5?.score.industryBlend.methodCount ?? 0) <= 1) {
    g.push("Ít hơn 2 phương pháp định giá có data");
  }
  return g;
}

function mOr(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function buildAnalystSnapshot(
  v: AnalystEngineResult,
  symbol?: string | null,
): ValuationAnalystSnapshot {
  const fv = v.fairValue;
  const p5 = v.phase5;
  const methods: Record<string, number | null> = {
    dcfBase: fv?.methods.dcfBase ?? null,
    dcfBear: fv?.methods.dcfBear ?? null,
    dcfBull: fv?.methods.dcfBull ?? null,
    peBased: fv?.methods.peBased ?? null,
    pbBased: fv?.methods.pbBased ?? null,
    evEbitdaBased: fv?.methods.evEbitdaBased ?? null,
    pfcfBased: fv?.methods.pfcfBased ?? null,
    residualIncome: v.phase4?.methodPrices.residualIncome ?? null,
    ddm: v.phase4?.methodPrices.ddm ?? null,
    nav: v.phase4?.methodPrices.nav ?? null,
    sotp: v.phase4?.methodPrices.sotp ?? null,
  };

  return {
    symbol: symbol ?? null,
    asOf: new Date().toISOString(),
    engineVersion: v.valuationEngineVersion,
    market: {
      price: v.price > 0 ? v.price : null,
      marketCap: v.marketCap,
      enterpriseValue: v.enterpriseValue,
    },
    multiples: {
      pe: mOr(v.multiples.pe),
      pb: mOr(v.multiples.pb),
      ps: mOr(v.multiples.ps),
      pfcf: mOr(v.multiples.pfcf),
      pcf: mOr(v.multiples.pcf),
      evEbitda: mOr(v.multiples.evEbitda),
      fcfYieldPct: mOr(v.multiples.fcfYield),
      earningsYieldPct: mOr(v.multiples.earningsYield),
      dividendYieldPct: mOr(v.multiples.dividendYield),
    },
    fairValue: {
      blended: p5?.finalFairValue ?? fv?.blendedFairValue ?? null,
      low: p5?.confidenceBands.low ?? null,
      base: p5?.confidenceBands.base ?? null,
      high: p5?.confidenceBands.high ?? null,
      bandWidthPct: p5?.confidenceBands.bandWidthPct ?? null,
      upsidePct: p5?.score.upsidePct ?? fv?.upsidePct ?? null,
      status: p5?.valuationStatus ?? fv?.valuationStatus ?? null,
      methods,
    },
    score: {
      value: p5?.valuationScore ?? null,
      grade: p5?.grade ?? null,
      drivers: p5?.score.breakdown.drivers ?? [],
      breakdown: p5?.score.breakdown
        ? {
            upsideScore: p5.score.breakdown.upsideScore,
            agreementScore: p5.score.breakdown.agreementScore,
            dataQualityScore: p5.score.breakdown.dataQualityScore,
            coverageScore: p5.score.breakdown.coverageScore,
          }
        : null,
    },
    industry: {
      profileId: p5?.profileId ?? null,
      methodsUsed: p5?.score.industryBlend.methodsUsed ?? [],
    },
    dcf: {
      available: Boolean(v.dcf?.length),
      scenarios: (v.dcf ?? []).map((s) => ({
        label: s.label,
        fairPrice: s.intrinsicPerShare || null,
        growth: s.growthY1to5,
        terminalGrowth: s.terminalGrowth,
        discountRate: s.discountRate,
      })),
    },
    dataQuality: v.dataQuality,
    confidence: fv?.confidence ?? v.confidence,
    notes: v.notes.slice(0, 40),
    gaps: gapsFromResult(v),
  };
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("vi-VN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function statusVi(s: string | null): string {
  const map: Record<string, string> = {
    deep_undervalued: "định giá thấp rõ rệt (deep undervalued)",
    undervalued: "có vẻ đang rẻ hơn fair value (undervalued)",
    fairly_valued: "gần vùng hợp lý (fairly valued)",
    overvalued: "có vẻ đang đắt hơn fair value (overvalued)",
    deep_overvalued: "định giá cao rõ rệt (deep overvalued)",
    insufficient_data: "không đủ dữ liệu để kết luận",
  };
  return s ? map[s] ?? s : "chưa xác định";
}

export function buildDeterministicNarrative(snap: ValuationAnalystSnapshot): string {
  const lines: string[] = [];
  const sym = snap.symbol ?? "Mã này";

  lines.push(`## Phân tích định giá ${sym}`);
  lines.push("");
  lines.push(
    `**Giá hiện tại:** ${fmt(snap.market.price)} · **Fair value (blended):** ${fmt(snap.fairValue.blended)} · **Upside:** ${pct(snap.fairValue.upsidePct)}`,
  );
  if (snap.fairValue.low != null || snap.fairValue.high != null) {
    lines.push(
      `**Dải tin cậy:** ${fmt(snap.fairValue.low)} – ${fmt(snap.fairValue.base)} – ${fmt(snap.fairValue.high)}` +
        (snap.fairValue.bandWidthPct != null
          ? ` (độ rộng ~${snap.fairValue.bandWidthPct}% fair value)`
          : ""),
    );
  }
  lines.push(`**Kết luận định giá:** ${statusVi(snap.fairValue.status)}`);
  if (snap.score.value != null) {
    lines.push(
      `**Valuation Score:** ${snap.score.value}/100 (hạng ${snap.score.grade ?? "—"})` +
        (snap.industry.profileId ? ` · ngành ${snap.industry.profileId}` : ""),
    );
  }
  lines.push("");

  lines.push("### Multiples quan sát");
  const multParts = [
    snap.multiples.pe != null ? `P/E ${snap.multiples.pe}` : null,
    snap.multiples.pb != null ? `P/B ${snap.multiples.pb}` : null,
    snap.multiples.ps != null ? `P/S ${snap.multiples.ps}` : null,
    snap.multiples.pfcf != null ? `P/FCF ${snap.multiples.pfcf}` : null,
    snap.multiples.evEbitda != null ? `EV/EBITDA ${snap.multiples.evEbitda}` : null,
    snap.multiples.fcfYieldPct != null ? `FCF yield ${snap.multiples.fcfYieldPct}%` : null,
  ].filter(Boolean);
  lines.push(multParts.length ? multParts.join(" · ") : "Chưa có multiple hợp lệ từ engine.");
  lines.push("");

  lines.push("### Các phương pháp đã dùng");
  const used = Object.entries(snap.fairValue.methods)
    .filter(([, v]) => v != null && v > 0)
    .map(([k, v]) => `- **${k}:** ${fmt(v)}`);
  if (used.length) lines.push(...used);
  else lines.push("- Không có method nào cho ra fair price.");
  if (snap.industry.methodsUsed.length) {
    lines.push(`Trọng số ngành áp dụng cho: ${snap.industry.methodsUsed.join(", ")}.`);
  }
  lines.push("");

  if (snap.dcf.available && snap.dcf.scenarios.length) {
    lines.push("### DCF (Bear / Base / Bull)");
    for (const s of snap.dcf.scenarios) {
      lines.push(
        `- **${s.label}:** fair ~${fmt(s.fairPrice)} (g=${s.growth != null ? (s.growth * 100).toFixed(1) : "n/a"}%, terminal g=${s.terminalGrowth != null ? (s.terminalGrowth * 100).toFixed(1) : "n/a"}%, r=${s.discountRate != null ? (s.discountRate * 100).toFixed(1) : "n/a"}%)`,
      );
    }
    lines.push("");
  }

  if (snap.score.drivers.length) {
    lines.push("### Điểm nhấn score");
    for (const d of snap.score.drivers) lines.push(`- ${d}`);
    lines.push("");
  }

  if (snap.gaps.length) {
    lines.push("### Hạn chế dữ liệu (engine báo cáo)");
    for (const g of snap.gaps) lines.push(`- ${g}`);
    lines.push("");
  }

  lines.push("### Lưu ý");
  lines.push(
    "Toàn bộ số liệu trên lấy từ Valuation Engine (Phase 1–5). Analyst **không tính lại** và **không bịa** số liệu thiếu. Đây là phân tích định lượng hỗ trợ quyết định, không phải khuyến nghị mua/bán.",
  );
  lines.push(`_Engine ${snap.engineVersion} · ${snap.asOf}_`);

  return lines.join("\n");
}

const SYSTEM_PROMPT = `Bạn là ORCA Valuation Analyst — chuyên gia giải thích định giá cổ phiếu Việt Nam.

QUY TẮC BẮT BUỘC:
1. CHỈ dùng số liệu trong JSON snapshot được cung cấp. Không bịa giá, multiple, FCF, fair value.
2. Không tính toán lại công thức (DCF, WACC, P/E…). Chỉ diễn giải ý nghĩa.
3. Nếu field = null hoặc nằm trong "gaps", phải nói rõ "engine không có dữ liệu / không áp dụng".
4. Không đưa khuyến nghị mua/bán tuyệt đối. Có thể nêu thiên hướng định giá (rẻ/đắt/hợp lý) dựa trên valuationStatus và upsidePct trong snapshot.
5. Viết tiếng Việt, rõ ràng, cấu trúc: Tóm tắt → Multiples → Phương pháp → Rủi ro/hạn chế → Kết luận ngắn.
6. Không thêm số % hay giá trị không có trong snapshot.`;

export interface AnalystLlmResult {
  narrative: string;
  usedLlm: boolean;
  model: string | null;
  latencyMs: number | null;
  fallbackReason: string | null;
}

export async function explainValuationWithLlm(
  snap: ValuationAnalystSnapshot,
): Promise<AnalystLlmResult> {
  const deterministic = buildDeterministicNarrative(snap);

  if (!llmConfigured()) {
    return {
      narrative: deterministic,
      usedLlm: false,
      model: null,
      latencyMs: null,
      fallbackReason: "LLM chưa cấu hình (thiếu API key)",
    };
  }

  try {
    const user = [
      "Hãy giải thích kết quả định giá sau. Nhắc lại: chỉ dùng số trong JSON, không bịa thêm.",
      "",
      "```json",
      JSON.stringify(snap, null, 0).slice(0, 12_000),
      "```",
      "",
      "Nếu cần, có thể tham khảo bản tóm tắt deterministic (đã đúng số) nhưng hãy viết lại mạch lạc hơn:",
      deterministic.slice(0, 3_000),
    ].join("\n");

    const r = await llmChat("analysis", {
      system: SYSTEM_PROMPT,
      user,
      temperature: 0.25,
      maxTokens: 1600,
      timeoutMs: 40_000,
    });

    if (!r?.text?.trim()) {
      return {
        narrative: deterministic,
        usedLlm: false,
        model: null,
        latencyMs: null,
        fallbackReason: "LLM không trả về nội dung",
      };
    }

    return {
      narrative: r.text.trim(),
      usedLlm: true,
      model: r.model,
      latencyMs: r.latencyMs,
      fallbackReason: null,
    };
  } catch (e) {
    return {
      narrative: deterministic,
      usedLlm: false,
      model: null,
      latencyMs: null,
      fallbackReason: e instanceof Error ? e.message : "LLM error",
    };
  }
}

export interface Phase6ValuationResult {
  snapshot: ValuationAnalystSnapshot;
  deterministicNarrative: string;
  narrative: string;
  usedLlm: boolean;
  model: string | null;
  latencyMs: number | null;
  fallbackReason: string | null;
  valuationEngineVersion: string;
}

export async function buildPhase6Valuation(input: {
  valuation: AnalystEngineResult;
  symbol?: string | null;
  useLlm?: boolean;
}): Promise<Phase6ValuationResult> {
  const snapshot = buildAnalystSnapshot(input.valuation, input.symbol);
  const deterministicNarrative = buildDeterministicNarrative(snapshot);

  if (!input.useLlm) {
    return {
      snapshot,
      deterministicNarrative,
      narrative: deterministicNarrative,
      usedLlm: false,
      model: null,
      latencyMs: null,
      fallbackReason: null,
      valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE6,
    };
  }

  const llm = await explainValuationWithLlm(snapshot);
  return {
    snapshot,
    deterministicNarrative,
    narrative: llm.narrative,
    usedLlm: llm.usedLlm,
    model: llm.model,
    latencyMs: llm.latencyMs,
    fallbackReason: llm.fallbackReason,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE6,
  };
}

export function buildPhase6ValuationSync(input: {
  valuation: AnalystEngineResult;
  symbol?: string | null;
}): Phase6ValuationResult {
  const snapshot = buildAnalystSnapshot(input.valuation, input.symbol);
  const deterministicNarrative = buildDeterministicNarrative(snapshot);
  return {
    snapshot,
    deterministicNarrative,
    narrative: deterministicNarrative,
    usedLlm: false,
    model: null,
    latencyMs: null,
    fallbackReason: null,
    valuationEngineVersion: VALUATION_ENGINE_VERSION_PHASE6,
  };
}
