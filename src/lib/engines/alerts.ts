/**
 * ALERT EVALUATION ENGINE — pure, deterministic, no I/O.
 *
 * Conditions (mirrors the `alerts.condition` column):
 *   price_above | price_below          — last price vs threshold
 *   pct_change                         — |daily change %| ≥ threshold
 *   rsi                                — RSI(14) ≥ threshold (overbought trigger)
 *   volume_spike                       — volume multiple vs 20-bar average ≥ threshold
 */

export type AlertCondition =
  | "price_above"
  | "price_below"
  | "pct_change"
  | "rsi"
  | "volume_spike";

export const ALERT_CONDITIONS: AlertCondition[] = [
  "price_above",
  "price_below",
  "pct_change",
  "rsi",
  "volume_spike",
];

export interface AlertSnapshot {
  price?: number | null;
  changePercent?: number | null;
  rsi?: number | null;
  volumeRatio?: number | null; // current volume / average volume
}

export interface AlertEvaluation {
  condition: AlertCondition;
  threshold: number;
  triggered: boolean;
  value: number | null;
  reason: string | null;
}

const valid = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** Evaluate one condition against a snapshot. Never throws; always explains. */
export function evaluateAlert(
  condition: AlertCondition,
  threshold: number,
  s: AlertSnapshot,
): AlertEvaluation {
  if (!Number.isFinite(threshold)) {
    return { condition, threshold, triggered: false, value: null, reason: "ngưỡng không hợp lệ" };
  }
  switch (condition) {
    case "price_above": {
      const v = valid(s.price) ? s.price : null;
      return v == null
        ? { condition, threshold, triggered: false, value: null, reason: "thiếu giá hiện tại" }
        : { condition, threshold, triggered: v >= threshold, value: v, reason: v >= threshold ? `giá ${v} ≥ ${threshold}` : `giá ${v} < ${threshold}` };
    }
    case "price_below": {
      const v = valid(s.price) ? s.price : null;
      return v == null
        ? { condition, threshold, triggered: false, value: null, reason: "thiếu giá hiện tại" }
        : { condition, threshold, triggered: v <= threshold, value: v, reason: v <= threshold ? `giá ${v} ≤ ${threshold}` : `giá ${v} > ${threshold}` };
    }
    case "pct_change": {
      const v = valid(s.changePercent) ? Math.abs(s.changePercent) : null;
      return v == null
        ? { condition, threshold, triggered: false, value: null, reason: "thiếu % thay đổi" }
        : { condition, threshold, triggered: v >= threshold, value: s.changePercent ?? null, reason: v >= threshold ? `|${s.changePercent}%| ≥ ${threshold}%` : `|${s.changePercent}%| < ${threshold}%` };
    }
    case "rsi": {
      const v = valid(s.rsi) ? s.rsi : null;
      return v == null
        ? { condition, threshold, triggered: false, value: null, reason: "thiếu RSI" }
        : { condition, threshold, triggered: v >= threshold, value: v, reason: v >= threshold ? `RSI ${v} ≥ ${threshold}` : `RSI ${v} < ${threshold}` };
    }
    case "volume_spike": {
      const v = valid(s.volumeRatio) ? s.volumeRatio : null;
      return v == null
        ? { condition, threshold, triggered: false, value: null, reason: "thiếu tỷ lệ khối lượng" }
        : { condition, threshold, triggered: v >= threshold, value: v, reason: v >= threshold ? `khối lượng ×${v.toFixed(2)} ≥ ×${threshold}` : `khối lượng ×${v.toFixed(2)} < ×${threshold}` };
    }
  }
}

/** Human-readable label (UI + audit trail). */
export const ALERT_CONDITION_LABELS: Record<AlertCondition, string> = {
  price_above: "Giá trên",
  price_below: "Giá dưới",
  pct_change: "Biến động %",
  rsi: "RSI ≥",
  volume_spike: "Khối lượng đột biến",
};
