import "server-only";
import { buildMeta } from "../freshness";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import { getVnStockDetail } from "./stocks";
import type { CandlePattern, Meta, TechnicalSnapshot } from "../types";

export type RecoStance = "watch-long" | "watch-short" | "neutral";
export type RecoTone = "up" | "down" | "neutral";
export type TradeSignal = "MUA" | "BÁN" | "QUAN_SÁT";

export interface TechFactor {
  key: string;
  label: string;
  value: string;
  bias: RecoTone;
  weight: number;
  note: string;
}

export interface PatternHit {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  reliability: "high" | "medium" | "low";
}

export interface QuantTechReco {
  score: number;
  stance: RecoStance;
  signal: TradeSignal;
  label: string;
  tone: RecoTone;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidencePct: number;
  factors: TechFactor[];
  patterns: PatternHit[];
  summary: string;
}

export interface LlmTechReco {
  narrative: string;
  stance: RecoStance;
  keyDrivers: string[];
  risks: string[];
  invalidation: string | null;
  model: string;
  latencyMs: number;
}

export interface StockTechRecoResult {
  symbol: string;
  quant: QuantTechReco;
  llm: LlmTechReco | null;
  llmStatus: "ok" | "unavailable" | "skipped" | "failed";
}

function clamp(n: number) {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function stanceFromScore(score: number): {
  stance: RecoStance;
  signal: TradeSignal;
  label: string;
  tone: RecoTone;
} {
  if (score >= 25)
    return { stance: "watch-long", signal: "MUA", label: "Tín hiệu MUA (kỹ thuật)", tone: "up" };
  if (score <= -25)
    return { stance: "watch-short", signal: "BÁN", label: "Tín hiệu BÁN (kỹ thuật)", tone: "down" };
  return {
    stance: "neutral",
    signal: "QUAN_SÁT",
    label: "QUAN SÁT — chờ xác nhận",
    tone: "neutral",
  };
}

function confFromCoverage(n: number, absScore: number): QuantTechReco["confidence"] {
  if (n >= 5 && absScore >= 35) return "HIGH";
  if (n >= 3 && absScore >= 18) return "MEDIUM";
  return "LOW";
}

function confidencePctFrom(factorCount: number, absScore: number, patternBoost: number): number {
  const base = 32 + absScore * 0.5 + factorCount * 4 + patternBoost;
  return Math.max(12, Math.min(92, Math.round(base)));
}

export function computeStockTechReco(
  tech: TechnicalSnapshot | null,
  patterns: CandlePattern[],
  changePercent?: number | null,
): QuantTechReco {
  const factors: TechFactor[] = [];
  let score = 0;
  let patternBoost = 0;

  if (!tech) {
    return {
      score: 0,
      stance: "neutral",
      signal: "QUAN_SÁT",
      label: "Thiếu dữ liệu kỹ thuật",
      tone: "neutral",
      confidence: "LOW",
      confidencePct: 12,
      factors: [],
      patterns: [],
      summary: "Chưa đủ chuỗi giá để tổng hợp khuyến nghị kỹ thuật.",
    };
  }

  const trendMap: Record<string, { w: number; vi: string }> = {
    "strong-up": { w: 26, vi: "Tăng mạnh" },
    up: { w: 14, vi: "Tăng" },
    sideways: { w: 0, vi: "Đi ngang" },
    down: { w: -14, vi: "Giảm" },
    "strong-down": { w: -26, vi: "Giảm mạnh" },
  };
  const tr = trendMap[tech.trend.label] ?? { w: 0, vi: tech.trend.label };
  score += tr.w;
  factors.push({
    key: "trend",
    label: "Xu hướng",
    value: `${tr.vi} (${tech.trend.score >= 0 ? "+" : ""}${tech.trend.score.toFixed(1)})`,
    bias: tr.w > 0 ? "up" : tr.w < 0 ? "down" : "neutral",
    weight: tr.w,
    note: "Cấu trúc xu hướng từ SMA + slope",
  });

  if (tech.rsi14 != null) {
    let w = 0;
    let note = "Trung tính";
    if (tech.rsi14 >= 70) {
      w = -16;
      note = "Vùng quá mua — rủi ro điều chỉnh";
    } else if (tech.rsi14 <= 30) {
      w = 16;
      note = "Vùng quá bán — tiềm năng hồi";
    } else if (tech.rsi14 >= 55) {
      w = 8;
      note = "Đà mua chiếm ưu thế";
    } else if (tech.rsi14 <= 45) {
      w = -8;
      note = "Đà bán chiếm ưu thế";
    }
    score += w;
    factors.push({
      key: "rsi",
      label: "RSI(14)",
      value: tech.rsi14.toFixed(1),
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note,
    });
  }

  if (tech.macd) {
    const h = tech.macd.histogram;
    const w =
      h > 0 ? (h > Math.abs(tech.last) * 0.001 ? 12 : 6) : h < 0 ? (Math.abs(h) > Math.abs(tech.last) * 0.001 ? -12 : -6) : 0;
    score += w;
    factors.push({
      key: "macd",
      label: "MACD hist",
      value: h.toPrecision(3),
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: w > 0 ? "Histogram dương — đà tăng" : w < 0 ? "Histogram âm — đà giảm" : "Histogram quanh 0",
    });
  }

  for (const m of [
    { key: "sma20", label: "Giá / SMA20", v: tech.sma.sma20, w: 8 },
    { key: "sma50", label: "Giá / SMA50", v: tech.sma.sma50, w: 10 },
    { key: "sma200", label: "Giá / SMA200", v: tech.sma.sma200, w: 8 },
  ] as const) {
    if (m.v == null) continue;
    const above = tech.last >= m.v;
    const w = above ? m.w : -m.w;
    score += w;
    factors.push({
      key: m.key,
      label: m.label,
      value: above ? "Trên MA" : "Dưới MA",
      bias: above ? "up" : "down",
      weight: w,
      note: above ? "Cấu trúc ủng hộ phía mua" : "Cấu trúc nghiêng phía bán",
    });
  }

  if (tech.returns.d30 != null) {
    const r = tech.returns.d30;
    const w = r > 8 ? 10 : r > 2 ? 5 : r < -8 ? -10 : r < -2 ? -5 : 0;
    score += w;
    factors.push({
      key: "ret30",
      label: "Hiệu suất 30 ngày",
      value: `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`,
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: "Momentum trung hạn",
    });
  } else if (changePercent != null) {
    const w = changePercent > 2 ? 6 : changePercent < -2 ? -6 : 0;
    score += w;
    factors.push({
      key: "chg",
      label: "% phiên",
      value: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: "Biến động gần nhất",
    });
  }

  if (patterns.length) {
    let bull = 0;
    let bear = 0;
    for (const p of patterns) {
      const mult = p.reliability === "high" ? 3 : p.reliability === "medium" ? 2 : 1;
      if (p.type === "bullish") bull += mult;
      if (p.type === "bearish") bear += mult;
    }
    const w = bull > bear ? Math.min(16, 6 + bull * 2) : bear > bull ? -Math.min(16, 6 + bear * 2) : 0;
    score += w;
    patternBoost = Math.min(12, (bull + bear) * 2);
    factors.push({
      key: "pattern",
      label: "Mẫu hình nến",
      value: patterns.slice(0, 3).map((p) => p.nameVi).join(", ") || `${bull}↑/${bear}↓`,
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: `Bull ${bull} · Bear ${bear} (đã trọng số reliability)`,
    });
  }

  if (tech.support[0] != null && tech.last > 0) {
    const dist = ((tech.last - tech.support[0]) / tech.last) * 100;
    if (dist >= 0 && dist < 2) {
      score += 4;
      factors.push({
        key: "support",
        label: "Gần hỗ trợ",
        value: `${dist.toFixed(1)}%`,
        bias: "up",
        weight: 4,
        note: "Giá sát vùng hỗ trợ gần nhất",
      });
    }
  }
  if (tech.resistance[0] != null && tech.last > 0) {
    const dist = ((tech.resistance[0] - tech.last) / tech.last) * 100;
    if (dist >= 0 && dist < 2) {
      score -= 4;
      factors.push({
        key: "resist",
        label: "Gần kháng cự",
        value: `${dist.toFixed(1)}%`,
        bias: "down",
        weight: -4,
        note: "Giá sát vùng kháng cự gần nhất",
      });
    }
  }

  score = clamp(score);
  const { stance, signal, label, tone } = stanceFromScore(score);
  const confidence = confFromCoverage(factors.length, Math.abs(score));
  const confidencePct = confidencePctFrom(factors.length, Math.abs(score), patternBoost);
  const patternHits: PatternHit[] = patterns.slice(0, 6).map((p) => ({
    name: p.name,
    nameVi: p.nameVi,
    type: p.type,
    reliability: p.reliability,
  }));
  const top = [...factors].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3);
  const summary =
    top.length === 0
      ? "Chưa đủ tín hiệu kỹ thuật nổi bật."
      : `${signal} (${confidencePct}%): điểm ${score >= 0 ? "+" : ""}${score} · ${top.map((f) => f.label).join(" · ")}.`;

  return {
    score,
    stance,
    signal,
    label,
    tone,
    confidence,
    confidencePct,
    factors,
    patterns: patternHits,
    summary,
  };
}

const SYS = `Bạn là chuyên gia phân tích kỹ thuật chứng khoán Việt Nam của Orca Financial.
Nhiệm vụ: tổng hợp CÁC YẾU TỐ KỸ THUẬT đã cho (quant factors) thành khuyến nghị nghiên cứu ngắn bằng tiếng Việt.

Quy tắc cứng:
- Chỉ dùng số liệu / factor trong STRUCTURED CONTEXT — không invent giá, %, RSI, volume.
- Khuyến nghị thuộc nhóm nghiên cứu: watch-long | watch-short | neutral — KHÔNG viết "nên mua/bán ngay", không đặt lệnh.
- Trả lời ĐÚNG JSON, không markdown:
{"narrative":"3-5 câu tiếng Việt","stance":"watch-long|watch-short|neutral","keyDrivers":["ý 1","ý 2"],"risks":["rủi ro 1"],"invalidation":"điều kiện vô hiệu hóa tín hiệu hoặc null"}
- stance nên khớp quant trừ khi factors mâu thuẫn rõ (ghi trong narrative).
- keyDrivers 2-4 ý; risks 1-3 ý; invalidation 1 câu hoặc null.`;

async function enrichLlm(
  quant: QuantTechReco,
  contract: Record<string, unknown>,
): Promise<{ llm: LlmTechReco | null; status: StockTechRecoResult["llmStatus"] }> {
  if (!llmConfigured()) return { llm: null, status: "skipped" };
  const started = Date.now();
  try {
    const user = JSON.stringify(
      {
        quant: {
          score: quant.score,
          signal: quant.signal,
          stance: quant.stance,
          confidencePct: quant.confidencePct,
          summary: quant.summary,
          factors: quant.factors.map((f) => ({
            label: f.label,
            value: f.value,
            bias: f.bias,
            weight: f.weight,
          })),
          patterns: quant.patterns,
        },
        market: contract,
      },
      null,
      0,
    );
    const res = await llmChat({
      system: SYS,
      user: `STRUCTURED CONTEXT:\n${user}`,
      temperature: 0.2,
      maxTokens: 700,
    });
    const parsed = parseLlmJson(res.text);
    if (!parsed) return { llm: null, status: "failed" };
    const facts = collectFactNumbers(contract);
    const check = validateOutput(parsed.narrative, facts);
    if (!check.ok) return { llm: null, status: "failed" };
    return {
      llm: { ...parsed, model: res.model, latencyMs: Date.now() - started },
      status: "ok",
    };
  } catch {
    return { llm: null, status: "unavailable" };
  }
}

function parseLlmJson(text: string): Omit<LlmTechReco, "model" | "latencyMs"> | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const narrative = typeof j.narrative === "string" ? j.narrative.trim() : "";
    if (!narrative || narrative.length < 20) return null;
    const s = String(j.stance ?? "neutral").toLowerCase();
    const stance: RecoStance = s === "watch-long" || s === "watch-short" ? s : "neutral";
    const keyDrivers = Array.isArray(j.keyDrivers)
      ? j.keyDrivers.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 4)
      : [];
    const risks = Array.isArray(j.risks)
      ? j.risks.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3)
      : [];
    const invalidation =
      typeof j.invalidation === "string" && j.invalidation.trim()
        ? j.invalidation.trim().slice(0, 240)
        : null;
    return { narrative: narrative.slice(0, 1200), stance, keyDrivers, risks, invalidation };
  } catch {
    return null;
  }
}

export async function getStockTechReco(
  symbolRaw: string,
): Promise<{ data: StockTechRecoResult; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol || symbol.length > 12) return null;
  const detail = await getVnStockDetail(symbol);
  if (!detail) return null;
  const tech = detail.detail.technical;
  const patterns = detail.detail.patterns ?? [];
  const chg = detail.detail.quote?.changePercent ?? null;
  const quant = computeStockTechReco(tech, patterns, chg);
  const contract = {
    symbol,
    last: tech?.last ?? detail.detail.quote?.price ?? null,
    changePercent: chg,
    rsi14: tech?.rsi14 ?? null,
    trend: tech?.trend ?? null,
    sma: tech?.sma ?? null,
    macdHist: tech?.macd?.histogram ?? null,
    support: tech?.support?.slice(0, 3) ?? [],
    resistance: tech?.resistance?.slice(0, 3) ?? [],
    returns: tech?.returns ?? null,
    patterns: patterns.map((p) => ({ name: p.nameVi, type: p.type, reliability: p.reliability })),
  };
  const { llm, status } = await enrichLlm(quant, contract);
  return {
    data: { symbol, quant, llm, llmStatus: status },
    meta: buildMeta({
      source: status === "ok" && llm ? `tech-quant+llm:${llm.model}` : "tech-quant",
      sourceTimestampMs: Date.now(),
      note:
        status === "skipped"
          ? "LLM chưa cấu hình — chỉ điểm quant kỹ thuật"
          : status === "unavailable" || status === "failed"
            ? "LLM tạm lỗi — hiển thị điểm quant"
            : "Tổng hợp kỹ thuật · không phải khuyến nghị đầu tư",
    }),
  };
}
