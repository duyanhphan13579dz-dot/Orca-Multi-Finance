import "server-only";
import type { OhlcvBar, QualityStatus, Quote } from "./types";

/**
 * DATA QUALITY ENGINE — every market record passes through validation.
 * Suspicious records are never silently dropped: they are flagged and logged.
 * Statuses: VALID · SUSPECT · INVALID · STALE.
 */

export interface QualityFlag {
  check: string;
  severity: "warn" | "fail";
  message: string;
  value?: unknown;
}

export interface QualityResult {
  status: QualityStatus;
  score: number; // 0..1
  flags: QualityFlag[];
}

const fail = (flags: QualityFlag[]) => flags.some((f) => f.severity === "fail");

export function combineQuality(parts: QualityResult[]): QualityResult {
  const flags = parts.flatMap((p) => p.flags);
  if (parts.some((p) => p.status === "INVALID")) return { status: "INVALID", score: 0, flags };
  if (parts.some((p) => p.status === "STALE")) return { status: "STALE", score: 0.4, flags };
  if (fail(flags)) return { status: "INVALID", score: 0, flags };
  if (flags.length) return { status: "SUSPECT", score: 0.7, flags };
  return { status: "VALID", score: 1, flags: [] };
}

/* --------------------------------- quotes --------------------------------- */

const DEVIATION_LIMITS: Record<string, number> = { crypto: 35, forex: 8, stock: 25, commodity: 25, index: 15 };

export function validateQuote(
  q: Pick<Quote, "price" | "open" | "high" | "low" | "volume" | "changePercent" | "updatedAt">,
  ctx: { assetClass: string; now?: number; staleMs?: number; sourceTimestampMs?: number | null },
): QualityResult {
  const flags: QualityFlag[] = [];
  const now = ctx.now ?? Date.now();

  if (!Number.isFinite(q.price) || q.price <= 0) {
    flags.push({ check: "invalid_price", severity: "fail", message: "Giá không hợp lệ hoặc <= 0", value: q.price });
  }
  if (q.high != null && q.low != null) {
    if (q.high < q.low) flags.push({ check: "hl_inverted", severity: "fail", message: "high < low", value: { h: q.high, l: q.low } });
    else {
      const span = q.high - q.low;
      const tol = Math.max(span * 0.002, q.high * 1e-6);
      if (q.price < q.low - tol || q.price > q.high + tol) {
        flags.push({ check: "price_out_of_day_range", severity: "warn", message: "Giá nằm ngoài biên high/low phiên", value: { price: q.price, low: q.low, high: q.high } });
      }
    }
  }
  if (q.open != null && q.open <= 0) flags.push({ check: "invalid_open", severity: "warn", message: "Open <= 0", value: q.open });
  if (q.volume != null && q.volume < 0) flags.push({ check: "negative_volume", severity: "fail", message: "Volume âm", value: q.volume });

  if (q.changePercent != null && Number.isFinite(q.changePercent)) {
    const limit = DEVIATION_LIMITS[ctx.assetClass] ?? 30;
    if (Math.abs(q.changePercent) > limit) {
      flags.push({ check: "extreme_deviation", severity: "warn", message: `Biến động ${q.changePercent.toFixed(1)}% vượt ngưỡng ${limit}%`, value: q.changePercent });
    }
  }

  let staleHit = false;
  const ts = ctx.sourceTimestampMs ?? (q.updatedAt ? Date.parse(q.updatedAt) : null);
  if (ts != null && Number.isFinite(ts)) {
    if (ts > now + 5 * 60_000) {
      flags.push({ check: "future_timestamp", severity: "warn", message: "Timestamp ở tương lai > 5 phút", value: new Date(ts).toISOString() });
    }
    if (ctx.staleMs && now - ts > ctx.staleMs) staleHit = true;
  }

  if (fail(flags)) return { status: "INVALID", score: 0, flags };
  if (staleHit) return { status: "STALE", score: 0.4, flags };
  if (flags.length) return { status: "SUSPECT", score: 0.7, flags };
  return { status: "VALID", score: 1, flags: [] };
}

/* ---------------------------------- bars ---------------------------------- */

export function validateBars(bars: OhlcvBar[]): QualityResult & { cleaned: OhlcvBar[] } {
  const flags: QualityFlag[] = [];
  if (!bars.length) return { status: "INVALID", score: 0, flags: [{ check: "empty_series", severity: "fail", message: "Chuỗi rỗng" }], cleaned: [] };

  const cleaned: OhlcvBar[] = [];
  let prevTime = -1;
  let dupes = 0;
  let outOfOrder = 0;
  const seen = new Set<number>();

  for (const b of bars) {
    const bad =
      !Number.isFinite(b.open) || !Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close) ||
      b.high < b.low || b.open <= 0 || b.close <= 0 || b.high <= 0 || b.low <= 0 || b.volume < 0;
    if (bad) {
      flags.push({ check: "invalid_bar", severity: "warn", message: "Nến không hợp lệ (đã loại khỏi tính toán)", value: b });
      continue;
    }
    if (seen.has(b.time)) { dupes++; continue; }
    if (b.time < prevTime) outOfOrder++;
    seen.add(b.time);
    prevTime = Math.max(prevTime, b.time);
    cleaned.push(b);
  }
  if (dupes) flags.push({ check: "duplicate_bars", severity: "warn", message: `${dupes} nến trùng timestamp (đã khử trùng)`, value: dupes });
  if (outOfOrder) flags.push({ check: "out_of_order", severity: "warn", message: `${outOfOrder} nến sai thứ tự thờ gian (đã sắp xếp lại)`, value: outOfOrder });

  // extreme single-bar move check (unit/currency error heuristics)
  for (let i = 1; i < cleaned.length; i++) {
    const r = cleaned[i].close / cleaned[i - 1].close;
    if (r > 3 || r < 0.33) {
      flags.push({ check: "extreme_bar_move", severity: "warn", message: `Biến động bất thường giữa 2 nến (x${r.toFixed(2)}) — nghi lỗi đơn vị/tiền tệ`, value: { t: cleaned[i].time, r } });
      break;
    }
  }

  const sorted = outOfOrder ? [...cleaned].sort((a, b) => a.time - b.time) : cleaned;
  if (fail(flags)) return { status: "INVALID", score: 0, flags, cleaned: sorted };
  if (flags.length) return { status: "SUSPECT", score: 0.7, flags, cleaned: sorted };
  return { status: "VALID", score: 1, flags: [], cleaned: sorted };
}

/* ------------------------------- series gaps ------------------------------ */

export function detectGaps(bars: OhlcvBar[], expectedMs: number): QualityFlag | null {
  if (bars.length < 3 || expectedMs <= 0) return null;
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].time - bars[i - 1].time > expectedMs * 2.5) gaps++;
  }
  if (!gaps) return null;
  return { check: "missing_data", severity: "warn", message: `${gaps} khoảng trống dữ liệu trong chuỗi`, value: gaps };
}

/* ---------------------------- quality logging ----------------------------- */

export async function logQualityEvent(provider: string, context: string, result: QualityResult) {
  if (result.status === "VALID") return;
  try {
    const { db } = await import("@/db");
    const { providerLogs } = await import("@/db/schema");
    await db.insert(providerLogs).values({
      provider,
      event: `quality_${result.status.toLowerCase()}`,
      message: `${context}: ${result.flags.map((f) => f.check).join(", ")}`,
      meta: { flags: result.flags.slice(0, 10) },
    });
  } catch {
    /* best-effort */
  }
}

/** map engine confidence for intelligence outputs */
export function qualityToLabel(status: QualityStatus | undefined): "HIGH" | "MEDIUM" | "LOW" {
  if (status === "VALID") return "HIGH";
  if (status === "SUSPECT" || status === "STALE") return "MEDIUM";
  return "LOW";
}
