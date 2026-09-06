/**
 * MARKET REGIME ENGINE (Phase 3) — trạng thái thị trường toàn cục (VN).
 *
 * Khác với market-state.ts (định hướng từng mã) và market-condition.ts
 * (composite điểm cho dashboard): engine này đặt tên regime + risk appetite
 * từ bằng chứng: trend chỉ số (SMA50/200, ret 20/60 phiên), breadth, độ
 * phân tán ngành, biến động. Không gán regime khi thiếu dữ liệu cốt lõi.
 */

import type { OhlcvBar } from "../types";
import { sma } from "../technical";

export type MarketRegime =
  | "bull_trend"
  | "recovery"
  | "sideways"
  | "correction"
  | "bear_trend"
  | "unknown";

export interface RegimeInputs {
  indexBars?: OhlcvBar[] | null;
  indexChangePercent?: number | null;
  breadthScore?: number | null; // 0..100 từ breadth engine
  sectorDispersionPct?: number | null;
  conditionScore?: number | null; // 0..100 từ market-condition engine
  note?: string | null;
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  regimeLabelVi: string;
  riskAppetite: number; // 0..100 (50 trung tính)
  trendScore: number; // -3..+3
  volatilityRatio: number | null; // vol30 / vol120 (1 = bình thường)
  evidence: string[];
  available: boolean;
  note: string | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function pct(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (a / b - 1) * 100;
}

function realizedVol(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function computeMarketRegime(input: RegimeInputs): MarketRegimeResult {
  const evidence: string[] = [];
  const bars = input.indexBars ?? null;
  let trendScore = 0;
  let volatilityRatio: number | null = null;

  if (bars && bars.length >= 65) {
    const closes = bars.map((b) => b.close);
    const last = closes[closes.length - 1];
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const v50 = s50[closes.length - 1];
    const v200 = s200[closes.length - 1];
    if (v50 != null && v200 != null) {
      if (last > v50) trendScore += 1;
      else trendScore -= 1;
      if (v50 > v200) trendScore += 1;
      else trendScore -= 1;
      evidence.push(`Giá ${last > v50 ? "trên" : "dưới"} SMA50${v200 != null ? (v50 > v200 ? " (SMA50 > SMA200)" : " (SMA50 < SMA200)") : ""}`);
    }
    const r20 = pct(last, closes[closes.length - 21]);
    const r60 = closes.length > 61 ? pct(last, closes[closes.length - 61]) : null;
    if (r20 != null && r20 > 2) trendScore += 1;
    else if (r20 != null && r20 < -2) trendScore -= 1;
    if (r60 != null && r60 > 5) trendScore += 1;
    else if (r60 != null && r60 < -5) trendScore -= 1;
    if (r60 != null) evidence.push(`20 phiên ${(r20 ?? 0) >= 0 ? "+" : ""}${(r20 ?? 0).toFixed(1)}% · 60 phiên ${r60 >= 0 ? "+" : ""}${r60.toFixed(1)}%`);
    const v30 = realizedVol(closes, 30);
    const v120 = realizedVol(closes, 120);
    if (v30 != null && v120 != null && v120 > 0) {
      volatilityRatio = Number((v30 / v120).toFixed(2));
      evidence.push(`Biến động 30 phiên ${v30.toFixed(1)}% vs nền 120 phiên ${v120.toFixed(1)}% (×${volatilityRatio})`);
    }
  }

  const breadthScore = input.breadthScore;
  const conditionScore = input.conditionScore;
  const composite = [breadthScore, conditionScore].filter((x): x is number => x != null);
  const riskAppetite = composite.length
    ? Math.round(clamp(composite.reduce((a, b) => a + b, 0) / composite.length, 0, 100))
    : 50;

  if (breadthScore != null) {
    if (breadthScore >= 60) trendScore += 1;
    else if (breadthScore <= 40) trendScore -= 1;
    evidence.push(`Breadth ${breadthScore}/100`);
  }
  if (input.sectorDispersionPct != null && input.sectorDispersionPct >= 30) {
    evidence.push(`Phân tán ngành lớn (${input.sectorDispersionPct} điểm) — rotation diễn ra`);
  }

  let regime: MarketRegime = "sideways";
  if (bars == null && breadthScore == null) {
    regime = "unknown";
  } else if (trendScore >= 3) regime = "bull_trend";
  else if (trendScore == 2) regime = recoveryOrBull(input, riskAppetite, breadthScore);
  else if (trendScore <= -3) regime = "bear_trend";
  else if (trendScore <= -2) regime = "correction";
  else regime = "sideways";

  const labels: Record<MarketRegime, string> = {
    bull_trend: "Thị trường tăng — xu hướng mạnh",
    recovery: "Phục hồi — động lực tích cực nhưng chưa bền",
    sideways: "Đi ngang — tích lũy, chờ động lực",
    correction: "Điều chỉnh — áp lực bán gia tăng",
    bear_trend: "Thị trường giảm — xu hướng yếu",
    unknown: "Chưa xác định — thiếu dữ liệu",
  };

  return {
    regime,
    regimeLabelVi: labels[regime],
    riskAppetite,
    trendScore,
    volatilityRatio,
    evidence,
    available: regime !== "unknown",
    note: input.note ?? null,
  };
}

function recoveryOrBull(input: RegimeInputs, riskAppetite: number, breadthScore: number | null | undefined): MarketRegime {
  // trendScore = 2: phân biệt bull (breadth + appetite cao) vs recovery
  if ((breadthScore ?? 50) >= 62 && riskAppetite >= 58) return "bull_trend";
  return "recovery";
}
