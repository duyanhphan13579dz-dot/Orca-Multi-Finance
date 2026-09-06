import "server-only";
import type { OhlcvBar } from "../types";
import { getVndQuotes } from "../providers/vndirect";
import { simplizeProvider } from "../providers/simplize";
import { env } from "../env";

/**
 * VN PROVIDER DATA COMPARISON ENGINE (Phase 5).
 *
 * During any provider migration ORCA compares normalized snapshots from the
 * two sources and only routes traffic when the verdict is acceptable:
 *   - price/change delta within tolerance,
 *   - timestamps within tolerance (freshness),
 *   - no missing symbols/candles,
 *   - no invalid data.
 *
 * IMPORTANT: comparison only runs between REAL provider outputs. Today the
 * Simplize data getters return UNAVAILABLE (no API rights), so
 * `runMigrationComparison()` reports SKIPPED with the exact reason — it never
 * fabricates a second snapshot to "compare against".
 */

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  timestamp: number | null;
}

export type CompareVerdict = "MATCH" | "DIFF" | "MISSING" | "TIMESTAMP-DIFF";

export interface CompareDiff {
  field: keyof QuoteSnapshot | "candle";
  a: unknown;
  b: unknown;
  delta?: number;
  pct?: number;
  tolerance?: number;
}

export interface QuoteComparison {
  verdict: CompareVerdict;
  symbol: string;
  diffs: CompareDiff[];
  note: string;
}

/** pure: compare two normalized quote snapshots (any provider) */
export function compareQuoteSnapshots(
  a: QuoteSnapshot | null,
  b: QuoteSnapshot | null,
  opts: { priceTolerancePct?: number; timestampToleranceMs?: number } = {},
): QuoteComparison {
  const priceTol = opts.priceTolerancePct ?? 0;
  const tsTol = opts.timestampToleranceMs ?? 5 * 60_000;
  if (!a || !b) {
    return {
      verdict: "MISSING",
      symbol: a?.symbol ?? b?.symbol ?? "?",
      diffs: [],
      note: !a && !b ? "Cả hai nguồn đều không có snapshot" : `Thiếu snapshot ${!a ? "nguồn A" : "nguồn B"}`,
    };
  }
  const diffs: CompareDiff[] = [];
  if (Math.abs(a.price - b.price) > 1e-9) {
    const delta = b.price - a.price;
    const pct = a.price > 0 ? (delta / a.price) * 100 : null;
    if (pct == null || Math.abs(pct) > priceTol) {
      diffs.push({ field: "price", a: a.price, b: b.price, delta, pct: pct ?? undefined, tolerance: priceTol });
    }
  }
  for (const f of ["change", "changePercent"] as const) {
    const av = f === "change" ? a.change : a.changePercent;
    const bv = f === "change" ? b.change : b.changePercent;
    if (av != null && bv != null && Math.abs(av - bv) > (f === "changePercent" ? Math.max(priceTol, 0.01) : 0.0001)) {
      diffs.push({ field: f, a: av, b: bv, delta: bv - av });
    }
  }
  if (a.timestamp != null && b.timestamp != null && Math.abs(a.timestamp - b.timestamp) > tsTol) {
    return {
      verdict: "TIMESTAMP-DIFF",
      symbol: a.symbol,
      diffs: [{ field: "timestamp", a: new Date(a.timestamp).toISOString(), b: new Date(b.timestamp).toISOString(), delta: b.timestamp - a.timestamp, tolerance: tsTol }],
      note: "Timestamp lệch vượt tolerance — xem lại freshness (không đánh giá số liệu cũ là realtime)",
    };
  }
  if (diffs.length) {
    return { verdict: "DIFF", symbol: a.symbol, diffs, note: `${a.symbol}: ${diffs.length} trường lệch ngoài tolerance — chưa chuyển traffic` };
  }
  return { verdict: "MATCH", symbol: a.symbol, diffs: [], note: `${a.symbol}: khớp (price ±${priceTol}%, timestamp ±${Math.round(tsTol / 1000)}s)` };
}

export interface CandleSeriesComparison {
  verdict: "MATCH" | "DIFF" | "MISSING";
  missingCount: number;
  outOfRangeCount: number;
  sampled: { ts: number; a: OhlcvBar | null; b: OhlcvBar | null }[];
  note: string;
}

/** pure: compare two OHLCV series on timestamp alignment (same-day buckets) */
export function compareCandleSeries(
  a: OhlcvBar[],
  b: OhlcvBar[],
  opts: { priceTolerancePct?: number } = {},
): CandleSeriesComparison {
  const tol = opts.priceTolerancePct ?? 0.1;
  if (!a.length || !b.length) {
    return { verdict: "MISSING", missingCount: Math.max(a.length, b.length) === 0 ? 0 : Math.abs(a.length - b.length), outOfRangeCount: 0, sampled: [], note: !a.length || !b.length ? "Một trong hai chuỗi rỗng — chưa thể so sánh" : "" };
  }
  const bByTs = new Map(b.map((c) => [c.time, c]));
  let missingCount = 0;
  let outOfRangeCount = 0;
  const sampled: CandleSeriesComparison["sampled"] = [];
  for (const c of a) {
    const d = bByTs.get(c.time);
    if (!d) {
      missingCount++;
      if (sampled.length < 10) sampled.push({ ts: c.time, a: c, b: null });
      continue;
    }
    if (Math.abs(c.close - d.close) / c.close > tol / 100) {
      outOfRangeCount++;
      if (sampled.length < 10) sampled.push({ ts: c.time, a: c, b: d });
    }
  }
  const verdict = missingCount + outOfRangeCount === 0 ? "MATCH" : "DIFF";
  return {
    verdict,
    missingCount,
    outOfRangeCount,
    sampled,
    note: missingCount + outOfRangeCount === 0
      ? `${a.length} candles khớp (close ±${tol}%)`
      : `${a.length} candles: ${missingCount} thiếu, ${outOfRangeCount} lệch giá — chưa chuyển chart traffic`,
  };
}

export interface MigrationComparisonResult {
  status: "SKIPPED" | "COMPARED";
  reason: string | null;
  results: QuoteComparison[];
  ranAt: string;
}

/**
 * Migration runner. Chỉ chạy so sánh khi Simplize có data access hợp lệ;
 * nếu không → SKIPPED với reason (không tạo snapshot giả).
 */
export async function runMigrationComparison(symbols: string[]): Promise<MigrationComparisonResult> {
  const ranAt = new Date().toISOString();
  const access = env.simplizeDataAccess ?? "none";
  if (access !== "approved-api") {
    return {
      status: "SKIPPED",
      reason: `Simplize chưa có quyền dữ liệu (SIMPLIZE_DATA_ACCESS=${access}). Data comparison chỉ hợp lệ giữa 2 nguồn thật; không tạo snapshot giả để so sánh. Migration steps đang BLOCKED-RIGHTS — xem /api/v1/providers/vn.`,
      results: [],
      ranAt,
    };
  }
  try {
    const a = await getVndQuotes(symbols);
    const vnd: QuoteSnapshot[] = a.quotes.map((q) => ({
      symbol: q.symbol,
      price: q.price,
      change: q.change ?? null,
      changePercent: q.changePercent ?? null,
      timestamp: a.sourceTs,
    }));
    const results: QuoteComparison[] = [];
    for (const snap of vnd) {
      const sb = await simplizeProvider.quote(snap.symbol);
      if (!sb.available) {
        results.push({ verdict: "MISSING", symbol: snap.symbol, diffs: [], note: `Simplize: ${sb.reason}` });
        continue;
      }
      results.push(
        compareQuoteSnapshots(snap, {
          symbol: sb.data.symbol,
          price: sb.data.price,
          change: sb.data.change,
          changePercent: sb.data.changePercent,
          timestamp: sb.data.timestamp,
        }),
      );
    }
    const worst = results.some((r) => r.verdict !== "MATCH") ? "DIFF" : "MATCH";
    return { status: "COMPARED", reason: worst, results, ranAt };
  } catch (e) {
    return { status: "SKIPPED", reason: `So sánh thất bại: ${e instanceof Error ? e.message : String(e)} — giữ VNDirect`, results: [], ranAt };
  }
}
