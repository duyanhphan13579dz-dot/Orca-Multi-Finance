import "server-only";
import { buildMeta } from "../freshness";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import { getVnStockDetail } from "./stocks";
import type { CandlePattern, Meta, TechnicalSnapshot, DivergenceSignal } from "../types";
import { buildStockTradePlan, type StockTradePlan } from "../engines/stock-trade-plan";

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
  /** Entry / SL / TP when signal is MUA or BÁN; null for QUAN SÁT. */
  plan: StockTradePlan | null;
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

function divergenceFactorWeight(d: DivergenceSignal): number {
  const conf = d.confidence ?? 0.5;
  let base = 0;
  switch (d.kind) {
    case "regular_bullish":
      base = d.strength === "A" ? 18 : 14;
      break;
    case "regular_bearish":
      base = d.strength === "A" ? -18 : -14;
      break;
    case "hidden_bullish":
      base = 10;
      break;
    case "hidden_bearish":
      base = -10;
      break;
  }
  return Math.round(base * conf);
}

const KIND_VI: Record<string, string> = {
  regular_bullish: "Phân kỳ tăng",
  regular_bearish: "Phân kỳ giảm",
  hidden_bullish: "Phân kỳ ẩn tăng",
  hidden_bearish: "Phân kỳ ẩn giảm",
};

const OSC_SHORT: Record<string, string> = {
  rsi: "RSI",
  macd_hist: "MACD hist",
  macd_line: "MACD",
  stoch: "Stoch",
};

export function computeStockTechReco(
  tech: TechnicalSnapshot | null | undefined,
  patterns: CandlePattern[],
  changePercent: number | null,
): QuantTechReco {
  const factors: TechFactor[] = [];
  let score = 0;
  let patternBoost = 0;

  if (!tech) {
    return {
      score: 0,
      stance: "neutral",
      signal: "QUAN_SÁT",
      label: "QUAN SÁT — thiếu dữ liệu kỹ thuật",
      tone: "neutral",
      confidence: "LOW",
      confidencePct: 12,
      factors: [],
      patterns: [],
      summary: "Chưa đủ dữ liệu kỹ thuật.",
      plan: null,
    };
  }

  if (tech.trend) {
    const w = Math.round(tech.trend.score * 0.35);
    score += w;
    factors.push({
      key: "trend",
      label: "Xu hướng",
      value: tech.trend.label,
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: `Điểm xu hướng ${tech.trend.score}`,
    });
  }

  if (tech.rsi14 != null) {
    let w = 0;
    if (tech.rsi14 >= 70) w = -12;
    else if (tech.rsi14 <= 30) w = 12;
    else if (tech.rsi14 >= 55) w = 6;
    else if (tech.rsi14 <= 45) w = -6;
    score += w;
    factors.push({
      key: "rsi",
      label: "RSI 14",
      value: tech.rsi14.toFixed(1),
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: w > 0 ? "Vùng hỗ trợ / quá bán" : w < 0 ? "Vùng kháng cự / quá mua" : "Trung tính",
    });
  }

  if (tech.macd) {
    const h = tech.macd.histogram;
    const w = h > 0 ? 10 : h < 0 ? -10 : 0;
    score += w;
    factors.push({
      key: "macd",
      label: "MACD hist",
      value: h.toFixed(3),
      bias: w > 0 ? "up" : w < 0 ? "down" : "neutral",
      weight: w,
      note: h > 0 ? "Momentum tăng" : h < 0 ? "Momentum giảm" : "Phẳng",
    });
  }

  if (tech.sma?.sma20 != null && tech.last > 0) {
    const above = tech.last > tech.sma.sma20;
    const w = above ? 8 : -8;
    score += w;
    factors.push({
      key: "sma20",
      label: "Giá vs SMA20",
      value: above ? "Trên" : "Dưới",
      bias: above ? "up" : "down",
      weight: w,
      note: `SMA20 ${tech.sma.sma20.toFixed(2)}`,
    });
  }

  if (tech.sma?.sma50 != null && tech.last > 0) {
    const above = tech.last > tech.sma.sma50;
    const w = above ? 10 : -10;
    score += w;
    factors.push({
      key: "sma50",
      label: "Giá vs SMA50",
      value: above ? "Trên" : "Dưới",
      bias: above ? "up" : "down",
      weight: w,
      note: `SMA50 ${tech.sma.sma50.toFixed(2)}`,
    });
  }

  if (tech.support?.[0] != null && tech.last > 0) {
    const dist = ((tech.last - tech.support[0]) / tech.last) * 100;
    if (dist >= 0 && dist < 3) {
      score += 6;
      factors.push({
        key: "support",
        label: "Gần hỗ trợ",
        value: `${dist.toFixed(1)}%`,
        bias: "up",
        weight: 6,
        note: `Hỗ trợ ${tech.support[0].toFixed(2)}`,
      });
    }
  }

  if (tech.resistance?.[0] != null && tech.last > 0) {
    const dist = ((tech.resistance[0] - tech.last) / tech.last) * 100;
    if (dist >= 0 && dist < 3) {
      score -= 6;
      factors.push({
        key: "resistance",
        label: "Gần kháng cự",
        value: `${dist.toFixed(1)}%`,
        bias: "down",
        weight: -6,
        note: `Kháng cự ${tech.resistance[0].toFixed(2)}`,
      });
    }
  }

  if (changePercent != null) {
    const w = changePercent > 2 ? 5 : changePercent < -2 ? -5 : 0;
    if (w !== 0) {
      score += w;
      factors.push({
        key: "session",
        label: "% phiên",
        value: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
        bias: w > 0 ? "up" : "down",
        weight: w,
        note: "Biến động phiên hiện tại",
      });
    }
  }

  for (const p of patterns.slice(0, 4)) {
    if (p.type === "neutral") continue;
    const rel = p.reliability === "high" ? 8 : p.reliability === "medium" ? 5 : 3;
    const w = p.type === "bullish" ? rel : -rel;
    score += w;
    patternBoost += Math.abs(w) * 0.4;
    factors.push({
      key: `pat-${p.name}`,
      label: p.nameVi || p.name,
      value: p.type,
      bias: p.type === "bullish" ? "up" : "down",
      weight: w,
      note: `Độ tin cậy ${p.reliability}`,
    });
  }

  if (tech.divergences?.length) {
    const top = [...tech.divergences].sort((a, b) => b.confidence - a.confidence)[0]!;
    const w = divergenceFactorWeight(top);
    if (w !== 0) {
      score += w;
      factors.push({
        key: "divergence",
        label: "Phân kỳ",
        value: `${KIND_VI[top.kind] ?? top.kind} · ${OSC_SHORT[top.oscillator] ?? top.oscillator}`,
        bias: w > 0 ? "up" : "down",
        weight: w,
        note: `conf ${(top.confidence * 100).toFixed(0)}%`,
      });
    }
  }

  score = clamp(score);
  let { stance, signal, label, tone } = stanceFromScore(score);
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
      : `${signal === "QUAN_SÁT" ? "QUAN SÁT" : signal} (${confidencePct}%): điểm ${score >= 0 ? "+" : ""}${score} · ${top.map((f) => f.label).join(" · ")}.`;

  let plan: StockTradePlan | null = null;
  if ((signal === "MUA" || signal === "BÁN") && tech.last > 0) {
    plan = buildStockTradePlan(signal === "MUA" ? "buy" : "sell", {
      last: tech.last,
      atr14: tech.atr14,
      support: tech.support,
      resistance: tech.resistance,
      volatility30d: tech.volatility30d,
    });
  }

  // Align with composite engine tradeSignal when present
  if (tech.tradeSignal) {
    const ts = tech.tradeSignal;
    if ((ts.action === "buy" || ts.action === "sell") && ts.plan && (ts.confidence ?? 0) >= 58) {
      signal = ts.action === "buy" ? "MUA" : "BÁN";
      stance = ts.action === "buy" ? "watch-long" : "watch-short";
      tone = ts.action === "buy" ? "up" : "down";
      label = signal === "MUA" ? "Tín hiệu MUA (kỹ thuật)" : "Tín hiệu BÁN (kỹ thuật)";
      plan = {
        side: ts.action,
        sideVi: ts.action === "buy" ? "MUA" : "BÁN",
        entry: ts.plan.entry,
        stopLoss: ts.plan.stopLoss,
        takeProfit: ts.plan.takeProfit,
        takeProfit1: ts.plan.takeProfit1,
        takeProfit2: ts.plan.takeProfit2,
        takeProfit3: ts.plan.takeProfit3,
        riskReward: ts.plan.riskReward,
        riskPct: ts.plan.riskPct,
        rewardPct: ts.plan.rewardPct,
        riskPerShare: Math.abs(ts.plan.entry - ts.plan.stopLoss),
        invalidation: ts.plan.invalidation,
        basis: ts.plan.basis,
        notes: ts.plan.notes,
      };
    } else if (ts.action === "watch" && (ts.confidence ?? 0) >= 45) {
      signal = "QUAN_SÁT";
      stance = "neutral";
      tone = "neutral";
      label = "QUAN SÁT — chờ xác nhận";
      plan = null;
    }
  }

  if (signal === "QUAN_SÁT") plan = null;

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
    plan,
  };
}

const SYS = `Bạn là chuyên gia phân tích kỹ thuật chứng khoán Việt Nam của Orca Financial.
Nhiệm vụ: tổng hợp CÁC YẾU TỐ KỸ THUẬT đã cho thành khuyến nghị nghiên cứu ngắn bằng tiếng Việt.
Quy tắc: Chỉ dùng số liệu trong context — không invent. Trả JSON: {"narrative":"...","stance":"watch-long|watch-short|neutral","keyDrivers":[],"risks":[],"invalidation":null}`;

async function enrichLlm(
  quant: QuantTechReco,
  contract: Record<string, unknown>,
): Promise<{ llm: LlmTechReco | null; status: StockTechRecoResult["llmStatus"] }> {
  if (!llmConfigured()) return { llm: null, status: "skipped" };
  const started = Date.now();
  try {
    const res = await llmChat({
      system: SYS,
      user: JSON.stringify({ quant, contract }),
      temperature: 0.2,
      maxTokens: 800,
    });
    const text = res.text ?? "";
    const parsed = parseLlmJson(text);
    if (!parsed) return { llm: null, status: "failed" };
    const facts = collectFactNumbers(JSON.stringify(contract));
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
  const quant = computeStockTechReco(tech, patterns, detail.detail.quote?.changePercent ?? null);
  const contract = {
    symbol,
    last: tech?.last ?? detail.detail.quote?.price ?? null,
    changePercent: detail.detail.quote?.changePercent ?? null,
    rsi14: tech?.rsi14 ?? null,
    score: quant.score,
  };
  const { llm, status } = await enrichLlm(quant, contract);
  return {
    data: {
      symbol,
      quant,
      llm,
      llmStatus: status,
    },
    meta: buildMeta({
      source: "stock-tech-reco",
      sourceTimestampMs: Date.now(),
      note: quant.label,
    }),
  };
}
