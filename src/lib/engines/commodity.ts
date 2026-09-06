import type { FreshnessStatus } from "../types";

/**
 * COMMODITY ENGINE — deterministic, provider-agnostic core for the
 * Commodities module (performance, history normalization, market state,
 * per-row freshness and the evidence-based impact matrix).
 *
 * Rules enforced here (never in the UI):
 * - No fabricated numbers: everything is derived from a real source series.
 * - Performance uses the nearest valid trading observation at/before the
 *   target boundary (never interpolation, never random, never hard-coded).
 * - Correlation is NEVER presented as causation (see `correlate`).
 */

/* ------------------------------ performance -------------------------------- */

export type PerformanceWindow = "1D" | "1W" | "1M" | "1Q" | "1Y";

export const PERFORMANCE_WINDOWS: PerformanceWindow[] = ["1D", "1W", "1M", "1Q", "1Y"];

export const WINDOW_MS: Record<PerformanceWindow, number> = {
  "1D": 24 * 3_600_000,
  "1W": 7 * 24 * 3_600_000,
  "1M": 30 * 24 * 3_600_000,
  "1Q": 90 * 24 * 3_600_000,
  "1Y": 365 * 24 * 3_600_000,
};

export interface HistoricalPoint {
  /** epoch ms */
  timestamp: number;
  /** last valid price (closing or last traded) */
  price: number;
  /** true when the source only publishes a single close value */
  closeOnly?: boolean;
}

export interface PerformanceResult {
  window: PerformanceWindow;
  /** current price (latest observation) */
  current: number | null;
  /** observation used as base (nearest valid at/before boundary) */
  base: number | null;
  change: number | null;
  changePercent: number | null;
  currentTimestamp: number | null;
  baseTimestamp: number | null;
  /** how the result was obtained */
  basis: "historical" | "provider" | "insufficient";
  note?: string;
}

/**
 * Compute change/changePercent for every window from a real, time-ordered
 * series using the NEAREST VALID observation at/before the boundary.
 * `now` is injected for determinism in tests.
 */
export function computePerformance(
  series: HistoricalPoint[],
  opts: { now?: number; provider?: Partial<Record<PerformanceWindow, { change: number; changePercent: number }>> } = {},
): PerformanceResult[] {
  const now = opts.now ?? Date.now();
  // normalize series: drop invalid, sort ascending, dedupe by timestamp
  const points = [...series]
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((p, i, arr) => i === 0 || p.timestamp !== arr[i - 1].timestamp);
  const last = points[points.length - 1] ?? null;
  const current = last?.price ?? null;

  return PERFORMANCE_WINDOWS.map((window) => {
    if (points.length < 2) {
      const p = opts.provider?.[window];
      if (p && Number.isFinite(p.change) && Number.isFinite(p.changePercent)) {
        return { window, current, base: null, change: p.change, changePercent: p.changePercent, currentTimestamp: last?.timestamp ?? null, baseTimestamp: null, basis: "provider" as const };
      }
      return { window, current, base: null, change: null, changePercent: null, currentTimestamp: last?.timestamp ?? null, baseTimestamp: null, basis: "insufficient" as const, note: "Chưa đủ dữ liệu lịch sử cho cửa sổ này" };
    }
    const cutoff = now - WINDOW_MS[window];
    // nearest valid observation at OR BEFORE the boundary (rightmost point with timestamp <= cutoff)
    let base: HistoricalPoint | null = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].timestamp <= cutoff) {
        base = points[i];
        break;
      }
    }
    if (!base || !current) {
      const p = opts.provider?.[window];
      if (p && Number.isFinite(p.change) && Number.isFinite(p.changePercent)) {
        return { window, current, base: null, change: p.change, changePercent: p.changePercent, currentTimestamp: last?.timestamp ?? null, baseTimestamp: null, basis: "provider" as const };
      }
      return { window, current, base: null, change: null, changePercent: null, currentTimestamp: last?.timestamp ?? null, baseTimestamp: null, basis: "insufficient" as const, note: "Cửa sổ vượt quá phạm vi dữ liệu lịch sử" };
    }
    const change = current - base.price;
    const changePercent = base.price > 0 ? (change / base.price) * 100 : null;
    return {
      window,
      current,
      base: base.price,
      change,
      changePercent,
      currentTimestamp: last?.timestamp ?? null,
      baseTimestamp: base.timestamp,
      basis: "historical",
    };
  });
}

/* -------------------------------- history ---------------------------------- */

export interface NormalizedHistoryPoint {
  symbol: string;
  timestamp: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  source: string;
  /** CLOSE_ONLY when the provider did not supply OHLC */
  priceType: "OHLC" | "CLOSE_ONLY";
}

export interface NormalizeHistoryResult {
  points: NormalizedHistoryPoint[];
  dropped: number;
  priceType: "OHLC" | "CLOSE_ONLY";
  /** true when high<low / non-positive prices were found and removed */
  hadInvalid: boolean;
}

/**
 * Validate + normalize a raw provider history series.
 * Rejects: NaN/Infinity, non-positive prices, high<low, out-of-order
 * (sorted), duplicates (first wins). Never throws — returns drop stats so
 * the caller can surface partial status instead of crashing.
 */
export function normalizeHistory(
  symbol: string,
  source: string,
  raw: { timestamp: number; open?: number | null; high?: number | null; low?: number | null; close: number; volume?: number | null }[],
): NormalizeHistoryResult {
  let dropped = 0;
  let hadInvalid = false;
  let hasOhlc = false;
  let hasOhlcAll = true;
  const seen = new Set<number>();
  const points: NormalizedHistoryPoint[] = [];
  for (const r of raw) {
    const close = Number(r.close);
    if (!Number.isFinite(r.timestamp) || !Number.isFinite(close) || close <= 0) {
      dropped++;
      hadInvalid = true;
      continue;
    }
    const open = r.open != null ? Number(r.open) : null;
    const high = r.high != null ? Number(r.high) : null;
    const low = r.low != null ? Number(r.low) : null;
    const volume = r.volume != null ? Number(r.volume) : null;
    const ohlcValid =
      open != null && high != null && low != null &&
      Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low) &&
      open > 0 && high > 0 && low > 0 && high >= low && high >= open && high >= close && low <= open && low <= close;
    if (ohlcValid) {
      hasOhlc = true;
    } else if (open != null || high != null || low != null) {
      dropped++;
      hadInvalid = true;
      continue; // partial OHLC is considered invalid — never mix
    }
    if (open != null && high == null) hasOhlcAll = false;
    if (seen.has(r.timestamp)) {
      dropped++;
      continue;
    }
    seen.add(r.timestamp);
    points.push({
      symbol,
      timestamp: r.timestamp,
      open: ohlcValid ? open : null,
      high: ohlcValid ? high : null,
      low: ohlcValid ? low : null,
      close,
      volume: volume != null && Number.isFinite(volume) && volume >= 0 ? volume : null,
      source,
      priceType: ohlcValid ? "OHLC" : "CLOSE_ONLY",
    });
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  const priceType: "OHLC" | "CLOSE_ONLY" = hasOhlc && hasOhlcAll ? "OHLC" : "CLOSE_ONLY";
  return { points, dropped, priceType, hadInvalid };
}

/* ------------------------------ market state ------------------------------- */

export type CommodityMarketState = "OPEN" | "CLOSED" | "UNKNOWN";

/**
 * Heuristic market session for western commodity/futures venues expressed in
 * local (UTC+7) wall time. Informational only — never used to fabricate data.
 * Model (per the venue's published sessions): the week runs Mon 06:00 ICT →
 * Sat 05:30 ICT with a daily 05:00–06:00 ICT settlement halt; Sunday closed.
 *
 * NOTE: getUTCDay() is 0=Sunday — compute ICT day explicitly, never shift
 * raw JS day numbers (previous off-by-one treated Friday as Saturday).
 */
export function commodityMarketState(nowMs: number): CommodityMarketState {
  // shift +7h so UTC getters directly read ICT wall time (handles day rollover)
  const ict = new Date(nowMs + 7 * 3_600_000);
  const ictDay = ict.getUTCDay(); // 0=Sun … 6=Sat
  const hrs = ict.getUTCHours() + ict.getUTCMinutes() / 60;
  if (ictDay === 0) return "CLOSED"; // Sunday: closed (reopens Mon 06:00 ICT)
  if (ictDay === 6) return hrs < 5.5 ? "OPEN" : "CLOSED"; // Sat until 05:30 ICT
  if (hrs >= 5 && hrs < 6) return "CLOSED"; // daily settlement halt 05:00–06:00 ICT
  return "OPEN";
}

/* ------------------------------- freshness --------------------------------- */

export interface CommodityFreshness {
  status: FreshnessStatus;
  marketState: CommodityMarketState;
  note?: string;
}

/**
 * Per-row freshness for scraped/polled commodity quotes.
 * - No data                         → UNAVAILABLE
 * - No source timestamp             → DELAYED (valid, but not verifiable realtime)
 * - ts within fresh SLA (30 min)    → FRESH (never LIVE: page-scraped, not streamed)
 * - within 24h                      → DELAYED
 * - older / beyond 24h              → STALE
 * MARKET_CLOSED is reported alongside so UI can explain a valid, older quote.
 */
export function commodityFreshness(
  sourceTimestampMs: number | null,
  opts: { hasData: boolean; now?: number; freshSlaMs?: number; delayedSlaMs?: number },
): CommodityFreshness {
  const now = opts.now ?? Date.now();
  const marketState = commodityMarketState(now);
  if (!opts.hasData) return { status: "UNAVAILABLE", marketState };
  if (sourceTimestampMs == null || !Number.isFinite(sourceTimestampMs)) {
    return { status: "DELAYED", marketState, note: "Nguồn không công bố timestamp — dữ liệu trang công khai, không phải realtime" };
  }
  const ageMs = Math.max(0, now - sourceTimestampMs);
  const freshSlaMs = opts.freshSlaMs ?? 30 * 60_000;
  const delayedSlaMs = opts.delayedSlaMs ?? 24 * 3_600_000;
  if (ageMs <= freshSlaMs) return { status: "FRESH", marketState };
  if (ageMs <= delayedSlaMs) return { status: "DELAYED", marketState, note: marketState === "CLOSED" ? "Thị trường đóng cửa — giá chốt phiên gần nhất" : undefined };
  return { status: "STALE", marketState, note: `Dữ liệu cũ hơn ${Math.round(ageMs / 3_600_000)} giờ` };
}

/* --------------------------------- impact ---------------------------------- */

export type RelationshipType =
  | "INPUT_COST"
  | "REVENUE_DRIVER"
  | "SELLING_PRICE"
  | "INVENTORY"
  | "TRADING"
  | "HEDGE"
  | "CAPEX"
  | "MACRO_SENSITIVITY"
  | "INDIRECT";

export type ImpactDirection = "POSITIVE" | "NEGATIVE" | "MIXED" | "CONDITIONAL";
export type ImpactStrength = "HIGH" | "MEDIUM" | "LOW";

export interface CommodityImpactRow {
  commodity: string;
  stock: string;
  sector: string | null;
  relationshipType: RelationshipType;
  direction: ImpactDirection;
  impactStrength: ImpactStrength;
  transmissionChannel: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
  /** economic-exposure: mechanism-based. related-source: published related list. */
  basis: "economic-exposure" | "related-source";
}

/**
 * IMPACT MATRIX — centrally managed, evidence-based.
 * - economic-exposure rows come from verified business mechanisms per commodity
 *   (source: published industry descriptions) — direction stays CONDITIONAL
 *   unless the mechanism is unambiguous.
 * - related-source rows come from a provider's published "related stocks" list
 *   (real evidence of relevance, NOT of direction) → CONDITIONAL + LOW.
 * Correlation is deliberately NOT used to build this matrix.
 */
export interface ImpactRelationInput {
  relationshipType?: RelationshipType;
  direction?: ImpactDirection;
  impactStrength?: ImpactStrength;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  channel?: string;
}

export function buildImpactRows(
  commodity: string,
  exposure: { sector: string; stocks: string[]; mechanism: string; relations?: Record<string, ImpactRelationInput> } | null,
  relatedStocks: string[],
  opts: { transmissionChannel?: string } = {},
): CommodityImpactRow[] {
  const rows: CommodityImpactRow[] = [];
  const channel = opts.transmissionChannel ?? "Giá hàng hóa → chi phí/doanh thu ngành → kết quả kinh doanh doanh nghiệp";
  if (exposure && exposure.stocks.length > 0) {
    for (const stock of exposure.stocks) {
      const rel = exposure.relations?.[stock];
      rows.push({
        commodity,
        stock,
        sector: exposure.sector,
        relationshipType: rel?.relationshipType ?? "MACRO_SENSITIVITY",
        direction: rel?.direction ?? "CONDITIONAL",
        impactStrength: rel?.impactStrength ?? "MEDIUM",
        transmissionChannel: rel?.channel ?? channel,
        confidence: rel?.confidence ?? "MEDIUM",
        evidence: `Economic exposure: ${exposure.mechanism}`,
        basis: "economic-exposure",
      });
    }
  }
  for (const stock of relatedStocks) {
    if (rows.some((r) => r.stock === stock)) continue;
    rows.push({
      commodity,
      stock,
      sector: null,
      relationshipType: "MACRO_SENSITIVITY",
      direction: "CONDITIONAL",
      impactStrength: "LOW",
      transmissionChannel: channel,
      confidence: "LOW",
      evidence: "Nguồn công khai liệt kê là cổ phiếu liên quan — chưa xác định hướng tác động",
      basis: "related-source",
    });
  }
  return rows;
}

/* ------------------------------- correlation -------------------------------- */

export interface CorrelationResult {
  /** Pearson correlation between commodity price and stock/benchmark returns */
  r: number | null;
  observations: number;
  window: PerformanceWindow;
  status: "OK" | "INSUFFICIENT_DATA";
  note: string;
}

/** Economic exposure basis labels — never conflate correlation with causality */
export const EXPOSURE_BASIS = "economic-exposure";
export const CORRELATION_BASIS = "historical-correlation";

export interface SensitivityResult {
  /** Pearson correlation of aligned daily returns */
  r: number | null;
  /** statistical beta: 1% benchmark move ↔ beta% commodity move (history only) */
  beta: number | null;
  observations: number;
  window: PerformanceWindow;
  status: "OK" | "INSUFFICIENT_DATA";
  note: string;
}

/**
 * Correlation + statistical sensitivity of commodity returns vs a benchmark
 * (e.g. VNINDEX). Daily series are aligned by UTC date bucket (trading-day
 * equivalence), returns computed on consecutive aligned observations.
 * Requires ≥30 aligned return pairs (default) — otherwise INSUFFICIENT_DATA.
 * CORRELATION/SENSITIVITY ARE HISTORICAL STATISTICS, NOT CAUSAL EVIDENCE —
 * callers must surface `note`.
 */
export function computeSensitivity(
  commodity: HistoricalPoint[],
  benchmark: HistoricalPoint[],
  window: PerformanceWindow,
  opts: { minObservations?: number } = {},
): SensitivityResult {
  const min = opts.minObservations ?? 30;
  const DAY_MS = 24 * 3_600_000;
  const bByDay = new Map<number, number>();
  for (const p of benchmark) {
    if (!Number.isFinite(p.timestamp) || !Number.isFinite(p.price) || p.price <= 0) continue;
    const day = Math.floor(p.timestamp / DAY_MS);
    if (!bByDay.has(day)) bByDay.set(day, p.price); // first of the day wins
  }
  const aligned: { t: number; a: number; b: number }[] = [];
  for (const p of commodity) {
    if (!Number.isFinite(p.timestamp) || !Number.isFinite(p.price) || p.price <= 0) continue;
    const b = bByDay.get(Math.floor(p.timestamp / DAY_MS));
    if (b != null) aligned.push({ t: p.timestamp, a: p.price, b });
  }
  aligned.sort((x, y) => x.t - y.t); // chronological order for return computation
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const a0 = aligned[i - 1].a;
    const a1 = aligned[i].a;
    const b0 = aligned[i - 1].b;
    const b1 = aligned[i].b;
    if (a0 > 0 && b0 > 0) {
      ra.push(a1 / a0 - 1);
      rb.push(b1 / b0 - 1);
    }
  }
  if (ra.length < min) {
    return {
      r: null,
      beta: null,
      observations: ra.length,
      window,
      status: "INSUFFICIENT_DATA",
      note: `Chưa đủ ${min} quan sát khớp — không ước lượng tương quan/độ nhạy (${CORRELATION_NOT_CAUSATION})`,
    };
  }
  const n = ra.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - ma;
    const db = rb[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  const r = denom > 0 ? cov / denom : null;
  const beta = vb > 0 ? cov / vb : null;
  return {
    r,
    beta,
    observations: n,
    window,
    status: "OK",
    note: `Hệ số tương quan (r) và độ nhạy thống kê (β) tính trên ${n} ngày khớp — ${CORRELATION_NOT_CAUSATION}`,
  };
}

export const CORRELATION_NOT_CAUSATION = "CORRELATION IS NOT CAUSATION — chỉ là chỉ số bổ sung";

/**
 * Pearson correlation of two aligned return series (same timestamps, nearest
 * match). Requires ≥ 30 aligned observations; otherwise INSUFFICIENT_DATA.
 * Never used as causal evidence — callers must surface `note`.
 */
export function correlateReturns(
  a: HistoricalPoint[],
  b: HistoricalPoint[],
  window: PerformanceWindow,
  opts: { minObservations?: number } = {},
): CorrelationResult {
  const min = opts.minObservations ?? 30;
  const bByTs = new Map(b.map((p) => [p.timestamp, p.price]));
  const aligned: { a: number; b: number }[] = [];
  for (const p of a) {
    const q = bByTs.get(p.timestamp);
    if (q != null) aligned.push({ a: p.price, b: q });
  }
  if (aligned.length < min + 1) {
    return { r: null, observations: aligned.length, window, status: "INSUFFICIENT_DATA", note: `Chưa đủ ${min} quan sát khớp — không ước lượng tương quan (${CORRELATION_NOT_CAUSATION})` };
  }
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const a0 = aligned[i - 1].a;
    const a1 = aligned[i].a;
    const b0 = aligned[i - 1].b;
    const b1 = aligned[i].b;
    if (a0 > 0 && b0 > 0) {
      ra.push(a1 / a0 - 1);
      rb.push(b1 / b0 - 1);
    }
  }
  if (ra.length < min) {
    return { r: null, observations: ra.length, window, status: "INSUFFICIENT_DATA", note: `Chưa đủ ${min} quan sát — không ước lượng tương quan (${CORRELATION_NOT_CAUSATION})` };
  }
  const n = ra.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - ma;
    const db = rb[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  const r = denom > 0 ? cov / denom : null;
  return {
    r,
    observations: n,
    window,
    status: "OK",
    note: CORRELATION_NOT_CAUSATION,
  };
}
