import type { ChartCandle } from "./chart-const";

/**
 * PERFORMANCE ENGINE — hiệu suất 1D / 1W / 1M / 1Q / 1Y từ chuỗi OHLC thật.
 *
 * Quy tắc (không số giả):
 *  - Chỉ tính trên candles THẬT của provider; đầu vào rỗng / <2 nến → null.
 *  - Mốc so sánh theo LỊCH: nến mới nhất trừ đi 1/7/30/90/365 ngày rồi chọn
 *    nến gần nhất KHÔNG MUỘN HƠN mốc đó (không nội suy, không đoán giá giữa
 *    2 nến).
 *  - Nếu chuỗi không đủ dài tới mốc → null cho mốc đó (không hiển thị số giả).
 */

export interface PerformanceResult {
  /** % thay đổi so với mốc trước (null = chưa đủ dữ liệu) */
  d1: number | null;
  w1: number | null;
  m1: number | null;
  q1: number | null;
  y1: number | null;
  /** timestamp nến cuối dùng làm gốc tính (epoch ms) */
  asOf: number | null;
  /** số nến nguồn đã dùng */
  bars: number;
}

export const PERFORMANCE_WINDOWS = [
  { key: "d1", days: 1 },
  { key: "w1", days: 7 },
  { key: "m1", days: 30 },
  { key: "q1", days: 90 },
  { key: "y1", days: 365 },
] as const;

export type PerformanceKey = (typeof PERFORMANCE_WINDOWS)[number]["key"];

/** Nến gần nhất có `time <= cutoff` (chuỗi đã sort tăng dần). */
function pivotBar(candles: ChartCandle[], cutoff: number): ChartCandle | null {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time <= cutoff) return candles[i];
  }
  return null;
}

export function computeDailyPerformance(candles: ChartCandle[]): PerformanceResult | null {
  if (!candles.length) return null;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const last = sorted[sorted.length - 1];
  if (sorted.length < 2 || !Number.isFinite(last.close) || last.close <= 0) return null;

  const out = {} as Record<PerformanceKey, number | null>;
  for (const w of PERFORMANCE_WINDOWS) {
    const cutoff = last.time - w.days * 86_400_000;
    const pivot = pivotBar(sorted, cutoff);
    out[w.key] = pivot && Number.isFinite(pivot.close) && pivot.close > 0 ? (last.close / pivot.close - 1) * 100 : null;
  }
  return { ...out, asOf: last.time, bars: sorted.length };
}
