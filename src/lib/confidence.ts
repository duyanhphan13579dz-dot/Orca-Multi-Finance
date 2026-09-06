/**
 * DATA CONFIDENCE MODEL (Phase 2) — pure scoring that answers:
 * "mức độ tin cậy của dữ liệu này là bao nhiêu, vì sao?"
 *
 * Không phải trung bình provider: điểm được cộng dồn từ các bằng chứng độc lập:
 *   - provider agreement (nhiều nguồn khớp nhau → điểm cao; lệch → hạ điểm + ghi factor)
 *   - quality status (VALID/SUSPECT/STALE/INVALID)
 *   - freshness so với SLA theo phiên VN
 *   - provider health (circuit/độ trễ)
 *   - fallback (archive/secondary-only → trừ điểm, không bao giờ gọi là high)
 *
 * ConfidenceLevel: high ≥ .85 · medium ≥ .55 · low ≥ .30 · unverified < .30
 * Single-provider tối đa .80 → luôn medium (không bao giờ high khi chưa có
 * đối chiếu chéo) — đây là ngữ nghĩa cốt lõi của Phase 2.
 */

import type { QualityStatus } from "./types";

export type ConfidenceLevel = "high" | "medium" | "low" | "unverified";

export interface DataConfidence {
  score: number; // 0..1
  level: ConfidenceLevel;
  factors: string[];
}

export interface QuoteConfidenceInput {
  providerCount: number; // số provider trả về symbol này (1 hoặc 2+)
  deviationPct: number | null; // độ lệch max-min giữa các provider (%); null nếu <2 nguồn
  quality: QualityStatus;
  ageMs: number | null;
  validSlaMs: number; // ngưỡng mới nhất theo phiên (dùng SLA fresh)
  providerHealthy: boolean;
  secondaryOnly?: boolean; // chỉ có fallback/secondary
}

export interface BarConfidenceInput {
  quality: QualityStatus;
  gapRatio: number; // 0..1 — tỷ lệ gap so với series
  source: "primary" | "secondary" | "archive" | "live";
  barCount: number;
  historySufficient: boolean; // đủ dài để technical có ý nghĩa (≥ 120 bars)
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function levelOf(score: number): ConfidenceLevel {
  if (score >= 0.85) return "high";
  if (score >= 0.55) return "medium";
  if (score >= 0.3) return "low";
  return "unverified";
}

export function computeQuoteConfidence(input: QuoteConfidenceInput): DataConfidence {
  const factors: string[] = [];
  let score = 0;

  // 1) provider agreement (max +0.30)
  if (input.providerCount >= 2) {
    const dev = input.deviationPct ?? 0;
    if (dev <= 0.3) {
      score += 0.3;
      factors.push(`2 nguồn khớp nhau (lệch ${dev.toFixed(2)}%)`);
    } else if (dev <= 0.8) {
      score += 0.2;
      factors.push(`2 nguồn, lệch nhẹ ${dev.toFixed(2)}% (trong tolerance)`);
    } else {
      score += 0.05;
      factors.push(`2 nguồn lệch lớn ${dev.toFixed(2)}% — ưu tiên theo rule, không lấy trung bình`);
    }
  } else {
    score += 0.1;
    factors.push("1 nguồn cung cấp (chưa đối chiếu chéo)");
  }

  // 2) quality (max +0.30)
  if (input.quality === "VALID") {
    score += 0.3;
    factors.push("quote hợp lệ (data quality VALID)");
  } else if (input.quality === "SUSPECT") {
    score += 0.15;
    factors.push("quote có cảnh báo chất lượng (SUSPECT)");
  } else if (input.quality === "STALE") {
    score += 0.05;
    factors.push("quote STALE (không còn bản mới)");
  } else {
    factors.push("quote INVALID — không nên phục vụ");
  }

  // 3) freshness (max +0.20)
  const ageMs = input.ageMs ?? Number.POSITIVE_INFINITY;
  if (ageMs <= input.validSlaMs) {
    score += 0.2;
  } else if (ageMs <= input.validSlaMs * 3) {
    score += 0.1;
    factors.push(`tuổi dữ liệu ${Math.round(ageMs / 1000)}s — trong vùng chấp nhận`);
  } else if (ageMs <= input.validSlaMs * 10) {
    score += 0.04;
    factors.push(`tuổi dữ liệu ${Math.round(ageMs / 60000)}p — gần hết hạn phiên`);
  } else {
    factors.push(`dữ liệu cũ ${Math.round(ageMs / 60000)}p — vượt cửa sổ phiên`);
  }

  // 4) provider health (max +0.20)
  if (input.providerHealthy) {
    score += 0.2;
  } else {
    score += 0.05;
    factors.push("provider nguồn đang degraded/không đo được health");
  }

  // 5) fallback penalty
  if (input.secondaryOnly) {
    score -= 0.15;
    factors.push("fallback — nguồn chính không khả dụng");
  }

  const s = clamp01(score);
  return { score: Number(s.toFixed(3)), level: levelOf(s), factors };
}

export function computeBarConfidence(input: BarConfidenceInput): DataConfidence {
  const factors: string[] = [];
  let score = 0;

  if (input.quality === "VALID") {
    score += 0.45;
    factors.push("chuỗi OHLCV hợp lệ");
  } else if (input.quality === "SUSPECT") {
    score += 0.25;
    factors.push("chuỗi OHLCV cảnh báo (SUSPECT)");
  } else {
    score += 0.1;
    factors.push("chuỗi OHLCV không sạch");
  }

  score += clamp01(1 - input.gapRatio) * 0.25;
  if (input.gapRatio > 0.1) factors.push(`có ${(input.gapRatio * 100).toFixed(0)}% gap ngày`);

  if (input.source === "live") score += 0.2;
  else if (input.source === "primary") score += 0.15;
  else if (input.source === "secondary") {
    score += 0.1;
    factors.push("nguồn thứ cấp (VNDirect)");
  } else {
    score += 0.08;
    factors.push("nến lấy từ archive lịch sử (provider offline)");
  }

  score += input.historySufficient ? 0.1 : 0.05;
  if (!input.historySufficient) factors.push(`chuỗi ngắn ${input.barCount} bars — technical chưa đủ ý nghĩa`);

  const s = clamp01(score);
  return { score: Number(s.toFixed(3)), level: levelOf(s), factors };
}

const SEVERITY: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1, unverified: 0 };

/** Worst-of confidence aggregation cho một loạt quote (meta trả cho client). */
export function aggregateConfidence(parts: DataConfidence[]): DataConfidence | null {
  if (!parts.length) return null;
  const worst = parts.reduce((a, b) => {
    const sa = SEVERITY[a.level];
    const sb = SEVERITY[b.level];
    if (sa !== sb) return sa < sb ? a : b;
    return a.score <= b.score ? a : b;
  });
  return worst;
}
