import "server-only";
import { buildMeta } from "../freshness";
import { llmChat, llmConfigured } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import { getCryptoDetail } from "./crypto";
import { getForexDetail } from "./forex";
import type { CandlePattern, Meta, TechnicalSnapshot } from "../types";

export type SentimentTone = "up" | "down" | "neutral";

export interface SentimentFactor {
  w: number;
  text: string;
}

export interface QuantSentiment {
  score: number;
  label: string;
  tone: SentimentTone;
  factors: SentimentFactor[];
}

export interface LlmSentiment {
  narrative: string;
  stance: "confirm" | "diverge" | "neutral";
  risks: string[];
  model: string;
  latencyMs: number;
}

export interface SentimentResult {
  assetType: "crypto" | "forex";
  symbol: string;
  quant: QuantSentiment;
  llm: LlmSentiment | null;
  llmStatus: "ok" | "unavailable" | "skipped" | "failed";
}

function clampScore(n: number) {
  return Math.max(-100, Math.min(100, Math.round(n)));
}

function labelTone(score: number): { label: string; tone: SentimentTone } {
  if (score >= 35) return { label: "LẠC QUAN", tone: "up" };
  if (score >= 12) return { label: "HƠI LẠC QUAN", tone: "up" };
  if (score <= -35) return { label: "BI QUAN", tone: "down" };
  if (score <= -12) return { label: "HƠI BI QUAN", tone: "down" };
  return { label: "TRUNG LẬP", tone: "neutral" };
}

export function computeQuantSentiment(args: {
  changePercent: number | null | undefined;
  price?: number | null;
  tech: TechnicalSnapshot | null;
  patterns?: CandlePattern[];
  mode: "crypto" | "forex";
}): QuantSentiment {
  let score = 0;
  const factors: SentimentFactor[] = [];
  const chg = args.changePercent ?? null;
  const hi = args.mode === "crypto" ? 3 : 0.4;
  const mid = args.mode === "crypto" ? 0.5 : 0.08;

  if (chg != null) {
    if (chg > hi) {
      score += 28;
      factors.push({ w: 1, text: `Biến động +${chg.toFixed(2)}% — momentum tăng mạnh` });
    } else if (chg > mid) {
      score += 14;
      factors.push({ w: 1, text: `Biến động +${chg.toFixed(2)}% — bias nhẹ tăng` });
    } else if (chg < -hi) {
      score -= 28;
      factors.push({ w: -1, text: `Biến động ${chg.toFixed(2)}% — áp lực bán rõ` });
    } else if (chg < -mid) {
      score -= 14;
      factors.push({ w: -1, text: `Biến động ${chg.toFixed(2)}% — bias nhẹ giảm` });
    } else {
      factors.push({ w: 0, text: `Biến động ${chg.toFixed(2)}% — biên độ hẹp` });
    }
  } else {
    factors.push({ w: 0, text: "Chưa có % thay đổi gần nhất" });
  }

  const tech = args.tech;
  if (tech?.rsi14 != null) {
    if (tech.rsi14 >= 70) {
      score -= 18;
      factors.push({ w: -1, text: `RSI ${tech.rsi14.toFixed(0)} — vùng quá mua` });
    } else if (tech.rsi14 <= 30) {
      score += 18;
      factors.push({ w: 1, text: `RSI ${tech.rsi14.toFixed(0)} — vùng quá bán` });
    } else if (tech.rsi14 >= 55) {
      score += 8;
      factors.push({ w: 1, text: `RSI ${tech.rsi14.toFixed(0)} — nghiêng mua` });
    } else if (tech.rsi14 <= 45) {
      score -= 8;
      factors.push({ w: -1, text: `RSI ${tech.rsi14.toFixed(0)} — nghiêng bán` });
    } else {
      factors.push({ w: 0, text: `RSI ${tech.rsi14.toFixed(0)} — trung tính` });
    }
  }

  if (tech?.trend) {
    const map: Record<string, number> = {
      "strong-up": 22,
      up: 12,
      sideways: 0,
      down: -12,
      "strong-down": -22,
    };
    const w = map[tech.trend.label] ?? 0;
    score += w;
    const labelVi: Record<string, string> = {
      "strong-up": "xu hướng tăng mạnh",
      up: "xu hướng tăng",
      sideways: "đi ngang",
      down: "xu hướng giảm",
      "strong-down": "xu hướng giảm mạnh",
    };
    factors.push({
      w,
      text: `Trend: ${labelVi[tech.trend.label] ?? tech.trend.label} (score ${tech.trend.score})`,
    });
  }

  if (tech?.sma.sma50 != null && tech.last != null) {
    if (tech.last >= tech.sma.sma50) {
      score += 8;
      factors.push({ w: 1, text: "Giá trên SMA50 — cấu trúc trung hạn ủng hộ" });
    } else {
      score -= 8;
      factors.push({ w: -1, text: "Giá dưới SMA50 — cấu trúc trung hạn yếu" });
    }
  }

  if (args.patterns?.length) {
    let bull = 0;
    let bear = 0;
    for (const p of args.patterns) {
      if (p.type === "bullish") bull += 1;
      if (p.type === "bearish") bear += 1;
    }
    if (bull > bear) {
      score += 6;
      factors.push({ w: 1, text: `Mẫu hình nến nghiêng tăng (${bull} bull / ${bear} bear)` });
    } else if (bear > bull) {
      score -= 6;
      factors.push({ w: -1, text: `Mẫu hình nến nghiêng giảm (${bear} bear / ${bull} bull)` });
    }
  }

  score = clampScore(score);
  const { label, tone } = labelTone(score);
  return { score, label, tone, factors: factors.slice(0, 6) };
}

const SYS = `Bạn là chuyên gia phân tích tâm lý thị trường (sentiment) của Orca Multi-Finance.
Nhiệm vụ: diễn giải NGẮN gọn bằng tiếng Việt dựa HOÀN TOÀN trên STRUCTURED CONTEXT (điểm quant + chỉ báo).
Quy tắc:
- Không invent số liệu mới; chỉ dùng số đã có trong context.
- Không đưa khuyến nghị mua/bán cụ thể ("nên long/short ngay").
- Trả lời ĐÚNG JSON, không markdown, không code fence:
{"narrative":"2-4 câu tiếng Việt","stance":"confirm|diverge|neutral","risks":["rủi ro 1","rủi ro 2"]}
- stance=confirm nếu diễn giải khớp điểm quant; diverge nếu có mâu thuẫn (vd RSI quá mua nhưng score lạc quan); neutral nếu trung tính.
- risks: 1-3 ý ngắn về rủi ro đọc sai tín hiệu / bối cảnh.`;

async function enrichWithLlm(
  quant: QuantSentiment,
  contract: Record<string, unknown>,
): Promise<{ llm: LlmSentiment | null; status: SentimentResult["llmStatus"] }> {
  if (!llmConfigured()) return { llm: null, status: "skipped" };

  const user = `STRUCTURED CONTEXT:\n${JSON.stringify({ quant, ...contract }, null, 1).slice(0, 6000)}\n\nViết JSON sentiment theo schema.`;
  const first = await llmChat("analysis", {
    system: SYS,
    user,
    temperature: 0.25,
    maxTokens: 420,
    timeoutMs: 20_000,
  });
  if (!first) return { llm: null, status: "unavailable" };

  const facts = collectFactNumbers({ quant, ...contract });
  void validateOutput(first.text, facts);
  const parsed = parseLlmJson(first.text);
  if (!parsed) return { llm: null, status: "failed" };

  return {
    llm: {
      narrative: parsed.narrative,
      stance: parsed.stance,
      risks: parsed.risks,
      model: first.model,
      latencyMs: first.latencyMs,
    },
    status: "ok",
  };
}

function parseLlmJson(text: string): { narrative: string; stance: LlmSentiment["stance"]; risks: string[] } | null {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) raw = brace[0];
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const narrative = typeof j.narrative === "string" ? j.narrative.trim() : "";
    if (!narrative || narrative.length < 12) return null;
    const stanceRaw = String(j.stance ?? "neutral").toLowerCase();
    const stance: LlmSentiment["stance"] =
      stanceRaw === "confirm" || stanceRaw === "diverge" ? stanceRaw : "neutral";
    const risks = Array.isArray(j.risks)
      ? j.risks.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3)
      : [];
    return { narrative: narrative.slice(0, 800), stance, risks };
  } catch {
    return null;
  }
}

export async function getCryptoSentiment(symbolRaw: string): Promise<{ data: SentimentResult; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const detail = await getCryptoDetail(symbol, "1h");
  if (!detail) return null;
  const t = detail.detail.ticker;
  const tech = detail.detail.technical;
  const patterns = detail.detail.patterns ?? [];
  const quant = computeQuantSentiment({
    changePercent: t.changePercent,
    price: t.price,
    tech,
    patterns,
    mode: "crypto",
  });
  const contract = {
    assetType: "crypto",
    symbol: detail.detail.symbol,
    price: t.price,
    changePercent: t.changePercent,
    quoteVolume: t.quoteVolume,
    rsi14: tech?.rsi14 ?? null,
    trend: tech?.trend ?? null,
    sma50: tech?.sma.sma50 ?? null,
    patterns: patterns.map((p) => ({ name: p.name, type: p.type, reliability: p.reliability })),
  };
  const { llm, status } = await enrichWithLlm(quant, contract);
  const data: SentimentResult = {
    assetType: "crypto",
    symbol: detail.detail.symbol,
    quant,
    llm,
    llmStatus: status,
  };
  const meta = buildMeta({
    source: status === "ok" && llm ? `quant+llm:${llm.model}` : "quant-sentiment",
    sourceTimestampMs: Date.now(),
    note:
      status === "skipped"
        ? "LLM chưa cấu hình (AI_PROVIDER_KEY) — chỉ điểm quant"
        : status === "unavailable" || status === "failed"
          ? "LLM tạm lỗi — hiển thị điểm quant"
          : undefined,
  });
  return { data, meta };
}

export async function getForexSentiment(pairRaw: string): Promise<{ data: SentimentResult; meta: Meta } | null> {
  const pair = pairRaw.toUpperCase().replace(/[^A-Z]/g, "");
  const detail = await getForexDetail(pair);
  if (!detail) return null;
  const cur = detail.detail.current;
  const tech = detail.detail.technical;
  const patterns = detail.detail.patterns ?? [];
  const quant = computeQuantSentiment({
    changePercent: cur?.changePercent,
    price: cur?.price,
    tech,
    patterns,
    mode: "forex",
  });
  const contract = {
    assetType: "forex",
    pair: detail.detail.pair,
    price: cur?.price ?? null,
    changePercent: cur?.changePercent ?? null,
    rsi14: tech?.rsi14 ?? null,
    trend: tech?.trend ?? null,
    sma50: tech?.sma.sma50 ?? null,
    patterns: patterns.map((p) => ({ name: p.name, type: p.type, reliability: p.reliability })),
  };
  const { llm, status } = await enrichWithLlm(quant, contract);
  const data: SentimentResult = {
    assetType: "forex",
    symbol: detail.detail.pair,
    quant,
    llm,
    llmStatus: status,
  };
  const meta = buildMeta({
    source: status === "ok" && llm ? `quant+llm:${llm.model}` : "quant-sentiment",
    sourceTimestampMs: Date.now(),
    note:
      status === "skipped"
        ? "LLM chưa cấu hình (AI_PROVIDER_KEY) — chỉ điểm quant"
        : status === "unavailable" || status === "failed"
          ? "LLM tạm lỗi — hiển thị điểm quant"
          : undefined,
  });
  return { data, meta };
}
