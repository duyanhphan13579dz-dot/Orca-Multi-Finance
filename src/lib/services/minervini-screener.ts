import "server-only";
import { buildMeta } from "../freshness";
import { sma } from "../technical";
import { getVnOhlcv, getVnQuotes } from "./stocks";
import { LIQUID_BOARD } from "../providers/public-vn-feed";
import { getSecurity, sectorOf } from "../vn/master";
import type { Meta, OhlcvBar } from "../types";

/**
 * Mark Minervini — Trend Template screener (SEPA universe filter).
 *
 * Sources (secondary, widely corroborated):
 *   Trade Like a Stock Market Wizard — 8-point Stage-2 checklist.
 * All 8 criteria are binary pass/fail; no partial credit for "buy" flag.
 *
 * Criterion 8 (IBD RS Rating) is proprietary — we proxy with percentile rank
 * of ~12-month (or 6-month if shorter history) total return vs the scanned
 * universe, mapped 0–100. Threshold ≥ 70 matches Minervini's floor.
 */

export interface MinerviniCriteria {
  priceAbove150And200: boolean;
  ma150Above200: boolean;
  ma200Rising: boolean;
  ma50AboveLonger: boolean;
  priceAbove50: boolean;
  above52wLow30pct: boolean;
  within25pctOf52wHigh: boolean;
  rsAtLeast70: boolean;
}

export interface MinerviniMetrics {
  close: number;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  sma200Prev30: number | null;
  high52w: number | null;
  low52w: number | null;
  pctAbove52wLow: number | null;
  pctBelow52wHigh: number | null;
  ret126: number | null;
  ret252: number | null;
  rsRating: number | null;
  volume20: number | null;
  volume60: number | null;
  volumeContracting: boolean;
}

export interface MinerviniScreenRow {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  passCount: number;
  passAll: boolean;
  stage2: boolean;
  criteria: MinerviniCriteria;
  metrics: MinerviniMetrics;
  notes: string[];
}

const CRITERION_KEYS: (keyof MinerviniCriteria)[] = [
  "priceAbove150And200",
  "ma150Above200",
  "ma200Rising",
  "ma50AboveLonger",
  "priceAbove50",
  "above52wLow30pct",
  "within25pctOf52wHigh",
  "rsAtLeast70",
];

export const CRITERION_LABELS_VI: Record<keyof MinerviniCriteria, string> = {
  priceAbove150And200: "Giá > SMA150 & SMA200",
  ma150Above200: "SMA150 > SMA200",
  ma200Rising: "SMA200 đang dốc lên (≥1 tháng)",
  ma50AboveLonger: "SMA50 > SMA150 & SMA200",
  priceAbove50: "Giá > SMA50",
  above52wLow30pct: "Giá ≥ +30% so với đáy 52T",
  within25pctOf52wHigh: "Giá trong 25% đỉnh 52T",
  rsAtLeast70: "RS rank ≥ 70 (proxy)",
};

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function lastSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const series = sma(closes, period);
  const v = series[series.length - 1];
  return v == null || !Number.isFinite(v) ? null : v;
}

function smaAt(closes: number[], period: number, offsetFromEnd: number): number | null {
  if (closes.length < period + offsetFromEnd) return null;
  const slice = closes.slice(0, closes.length - offsetFromEnd);
  if (slice.length < period) return null;
  return lastSma(slice, period);
}

function pctRet(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const a = closes[closes.length - 1 - lookback];
  const b = closes[closes.length - 1];
  if (a == null || b == null || a <= 0) return null;
  return ((b - a) / a) * 100;
}

function avgVol(bars: OhlcvBar[], n: number): number | null {
  if (bars.length < n) return null;
  const slice = bars.slice(-n);
  const sum = slice.reduce((s, b) => s + (b.volume ?? 0), 0);
  return sum / n;
}

interface RawPack {
  symbol: string;
  bars: OhlcvBar[];
  close: number;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  sma200Prev30: number | null;
  high52w: number | null;
  low52w: number | null;
  ret126: number | null;
  ret252: number | null;
  volume20: number | null;
  volume60: number | null;
}

function analyzeBars(symbol: string, bars: OhlcvBar[]): RawPack | null {
  if (bars.length < 60) return null;
  const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < 60) return null;
  const close = closes[closes.length - 1]!;
  const lookHigh = bars.slice(-252);
  const highs = lookHigh.map((b) => b.high);
  const lows = lookHigh.map((b) => b.low);
  const high52w = highs.length ? Math.max(...highs) : null;
  const low52w = lows.length ? Math.min(...lows) : null;

  return {
    symbol,
    bars,
    close,
    sma50: lastSma(closes, 50),
    sma150: lastSma(closes, 150),
    sma200: lastSma(closes, 200),
    sma200Prev30: smaAt(closes, 200, 30),
    high52w,
    low52w,
    ret126: pctRet(closes, Math.min(126, closes.length - 1)),
    ret252: pctRet(closes, Math.min(252, closes.length - 1)),
    volume20: avgVol(bars, 20),
    volume60: avgVol(bars, 60),
  };
}

function buildCriteria(raw: RawPack, rsRating: number | null): {
  criteria: MinerviniCriteria;
  metrics: MinerviniMetrics;
  notes: string[];
} {
  const { close, sma50, sma150, sma200, sma200Prev30, high52w, low52w } = raw;
  const notes: string[] = [];

  const priceAbove150And200 = sma150 != null && sma200 != null && close > sma150 && close > sma200;
  const ma150Above200 = sma150 != null && sma200 != null && sma150 > sma200;
  const ma200Rising = sma200 != null && sma200Prev30 != null && sma200 > sma200Prev30;
  const ma50AboveLonger = sma50 != null && sma150 != null && sma200 != null && sma50 > sma150 && sma50 > sma200;
  const priceAbove50 = sma50 != null && close > sma50;

  let pctAbove52wLow: number | null = null;
  let above52wLow30pct = false;
  if (low52w != null && low52w > 0) {
    pctAbove52wLow = ((close - low52w) / low52w) * 100;
    above52wLow30pct = close >= low52w * 1.3;
  } else {
    notes.push("Thiếu đáy 52T");
  }

  let pctBelow52wHigh: number | null = null;
  let within25pctOf52wHigh = false;
  if (high52w != null && high52w > 0) {
    pctBelow52wHigh = ((high52w - close) / high52w) * 100;
    within25pctOf52wHigh = close >= high52w * 0.75;
  } else {
    notes.push("Thiếu đỉnh 52T");
  }

  const rsAtLeast70 = rsRating != null && rsRating >= 70;
  if (rsRating == null) notes.push("Chưa xếp được RS proxy");

  if (sma200 == null) notes.push("Chưa đủ nến cho SMA200");
  else if (!ma200Rising) notes.push("SMA200 chưa dốc lên rõ (≥1 tháng)");

  const volumeContracting =
    raw.volume20 != null && raw.volume60 != null && raw.volume60 > 0 && raw.volume20 < raw.volume60 * 0.85;

  const criteria: MinerviniCriteria = {
    priceAbove150And200,
    ma150Above200,
    ma200Rising,
    ma50AboveLonger,
    priceAbove50,
    above52wLow30pct,
    within25pctOf52wHigh,
    rsAtLeast70,
  };

  const metrics: MinerviniMetrics = {
    close,
    sma50,
    sma150,
    sma200,
    sma200Prev30,
    high52w,
    low52w,
    pctAbove52wLow,
    pctBelow52wHigh,
    ret126: raw.ret126,
    ret252: raw.ret252,
    rsRating,
    volume20: raw.volume20,
    volume60: raw.volume60,
    volumeContracting,
  };

  return { criteria, metrics, notes };
}

export async function screenMinervini(args?: {
  symbols?: string[];
  minPass?: number;
  onlyPassAll?: boolean;
  sector?: string;
  minRs?: number;
  limit?: number;
}): Promise<{ rows: MinerviniScreenRow[]; scanned: number; skipped: number; meta: Meta } | null> {
  const uniq = [
    ...new Set((args?.symbols?.length ? args.symbols : LIQUID_BOARD).map((s) => s.toUpperCase()).filter(Boolean)),
  ].slice(0, 80);

  const quotesPack = await getVnQuotes(uniq).catch(() => null);
  const quoteMap = new Map((quotesPack?.quotes ?? []).map((q) => [q.symbol, q]));

  let skipped = 0;
  const packs = await mapPool(uniq, 5, async (symbol) => {
    const ohlcv = await getVnOhlcv(symbol, 280).catch(() => null);
    const bars = ohlcv?.bars ?? [];
    const pack = analyzeBars(symbol, bars);
    if (!pack) {
      skipped += 1;
      return null;
    }
    return pack;
  });

  const valid = packs.filter((p): p is RawPack => p != null);
  if (!valid.length) return null;

  const retKey = (p: RawPack) => p.ret252 ?? p.ret126;
  const ranked = valid
    .map((p) => ({ symbol: p.symbol, ret: retKey(p) }))
    .filter((x) => x.ret != null) as { symbol: string; ret: number }[];
  ranked.sort((a, b) => a.ret - b.ret);
  const rsMap = new Map<string, number>();
  if (ranked.length >= 3) {
    ranked.forEach((x, i) => {
      const pct = Math.round((i / (ranked.length - 1)) * 100);
      rsMap.set(x.symbol, pct);
    });
  }

  const minPass = args?.minPass ?? 6;
  const minRs = args?.minRs ?? 0;
  const onlyPassAll = args?.onlyPassAll ?? false;

  const rows: MinerviniScreenRow[] = [];
  for (const pack of valid) {
    const rs = rsMap.get(pack.symbol) ?? null;
    const { criteria, metrics, notes } = buildCriteria(pack, rs);
    const passCount = CRITERION_KEYS.filter((k) => criteria[k]).length;
    const passAll = passCount === 8;
    if (onlyPassAll && !passAll) continue;
    if (passCount < minPass) continue;
    if (minRs > 0 && (rs == null || rs < minRs)) continue;

    const q = quoteMap.get(pack.symbol);
    const sec = getSecurity(pack.symbol);
    const sector = sectorOf(pack.symbol) ?? sec?.sector ?? null;
    if (args?.sector && sector !== args.sector) continue;

    rows.push({
      symbol: pack.symbol,
      name: sec?.name ?? q?.name ?? null,
      sector,
      price: q?.price ?? pack.close,
      changePercent: q?.changePercent ?? null,
      volume: q?.quoteVolume ?? q?.volume ?? pack.bars[pack.bars.length - 1]?.volume ?? null,
      passCount,
      passAll,
      stage2: passAll,
      criteria,
      metrics,
      notes,
    });
  }

  rows.sort((a, b) => {
    if (b.passCount !== a.passCount) return b.passCount - a.passCount;
    const rsA = a.metrics.rsRating ?? 0;
    const rsB = b.metrics.rsRating ?? 0;
    if (rsB !== rsA) return rsB - rsA;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });

  const limit = Math.min(args?.limit ?? 40, 80);
  const sliced = rows.slice(0, limit);

  return {
    rows: sliced,
    scanned: uniq.length,
    skipped,
    meta: buildMeta({
      source: "minervini-trend-template",
      sourceTimestampMs: Date.now(),
      note: `Trend Template · quét ${uniq.length} mã · pass≥${minPass}${onlyPassAll ? " · chỉ 8/8" : ""} · RS = percentile return trong universe`,
      hasData: sliced.length > 0,
      partial: skipped > 0,
      slas: { liveSlaMs: 60_000, freshSlaMs: 300_000, delayedSlaMs: 900_000 },
    }),
  };
}
