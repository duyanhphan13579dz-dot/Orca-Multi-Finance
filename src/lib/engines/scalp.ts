import "server-only";
import type { OhlcvBar } from "../types";
import { atr, ema, rsi, supportResistance } from "../technical";

/**
 * CRYPTO SCALPING INTELLIGENCE ENGINE — deterministic signal computation over
 * realtime klines (5m/15m). Outputs a structured signal; the LLM layer (when
 * enabled) only explains it. No invented prices, no hallucinated setups.
 */

export interface ScalpSignal {
  timeframe: string;
  direction: "watch-long" | "watch-short" | "neutral";
  strength: number; // 0..100
  score: number; // composite
  last: number;
  vwap: number | null;
  vwapDistPct: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi7: number | null;
  atr: number | null;
  atrPct: number | null;
  momentum: { bars3: number | null; bars6: number | null };
  volume: { ratioVsMedian: number | null; spike: boolean };
  entryZone: [number, number] | null;
  invalidation: number | null;
  micro: { support: number[]; resistance: number[] };
  riskNotes: string[];
  evidence: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function analyzeScalp(bars: OhlcvBar[], opts: { timeframe?: string; quoteVolume24h?: number | null } = {}): ScalpSignal | null {
  if (bars.length < 60) return null;
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];

  /* session VWAP over last ~288 bars (24h of 5m) */
  const session = bars.slice(-288);
  let pv = 0;
  let vv = 0;
  for (const b of session) {
    if (b.volume > 0) {
      pv += ((b.high + b.low + b.close) / 3) * b.volume;
      vv += b.volume;
    }
  }
  const vwap = vv > 0 ? pv / vv : null;
  const vwapDistPct = vwap ? (last / vwap - 1) * 100 : null;

  const ema9 = ema(closes, 9)[closes.length - 1] ?? null;
  const ema21 = ema(closes, 21)[closes.length - 1] ?? null;
  const rsi7 = rsi(closes, 7)[closes.length - 1] ?? null;
  const atrV = atr(bars, 14);
  const atrPct = atrV != null ? (atrV / last) * 100 : null;

  const mom3 = closes.length > 4 ? (last / closes[closes.length - 4] - 1) * 100 : null;
  const mom6 = closes.length > 7 ? (last / closes[closes.length - 7] - 1) * 100 : null;

  const vols = bars.map((b) => b.volume);
  const medWin = vols.slice(-101, -1).filter((v) => v > 0).sort((a, b) => a - b);
  const medianVol = medWin.length ? medWin[Math.floor(medWin.length / 2)] : 0;
  const volRatio = medianVol > 0 ? vols[vols.length - 1] / medianVol : null;
  const spike = volRatio != null && volRatio >= 1.8;

  /* composite score */
  let score = 0;
  const emaUp = ema9 != null && ema21 != null ? ema9 > ema21 : null;
  if (emaUp != null) score += emaUp ? 0.8 : -0.8;
  if (vwap != null) score += last > vwap ? 0.6 : -0.6;
  if (mom3 != null) score += Math.sign(mom3) * clamp(Math.abs(mom3) / 0.35, 0, 1) * 0.7;
  if (rsi7 != null) {
    if (rsi7 > 52 && rsi7 <= 70) score += 0.4;
    else if (rsi7 < 48 && rsi7 >= 30) score -= 0.4;
    else if (rsi7 > 82) score -= 0.5; // exhaustion
    else if (rsi7 < 18) score += 0.5; // capitulation bounce watch
  }
  if (spike && mom3 != null) score += Math.sign(mom3) * 0.5;
  score = clamp(score, -3, 3);

  const direction = score >= 1.3 ? "watch-long" : score <= -1.3 ? "watch-short" : "neutral";
  const strength = Math.round(clamp(Math.abs(score) / 3, 0, 1) * 100);

  const entryZone: [number, number] | null =
    atrV != null && direction === "watch-long" ? [last, last - 0.35 * atrV] : atrV != null && direction === "watch-short" ? [last, last + 0.35 * atrV] : null;
  const invalidation =
    direction === "watch-long"
      ? Math.min(ema21 ?? last, vwap ?? last) - 0.5 * (atrV ?? last * 0.004)
      : direction === "watch-short"
        ? Math.max(ema21 ?? last, vwap ?? last) + 0.5 * (atrV ?? last * 0.004)
        : null;

  const micro = supportResistance(bars.slice(-96), 96);

  const riskNotes: string[] = [];
  if (atrPct != null) {
    if (atrPct > 0.9) riskNotes.push(`ATR ${atrPct.toFixed(2)}%/nến — biên giãn, giảm size hoặc nới SL có kiểm soát`);
    else if (atrPct < 0.15) riskNotes.push(`ATR ${atrPct.toFixed(2)}%/nến — biên hẹp, cẩn thận breakout giả`);
  }
  if (vwapDistPct != null && Math.abs(vwapDistPct) > 0.8) riskNotes.push(`Giá lệch VWAP ${vwapDistPct.toFixed(2)}% — rủi ro mean reversion khi vào lệnh đuổi`);
  if (!spike) riskNotes.push("Chưa có volume spike xác nhận — ưu tiên chờ trigger rõ hơn");
  if (opts.quoteVolume24h != null && opts.quoteVolume24h < 50_000_000) riskNotes.push("Thanh khoản 24h dưới $50M — slipage cao khi scalping");

  const evidence: string[] = [
    `EMA9 ${ema9 != null && ema21 != null ? (ema9 > ema21 ? ">" : "<") : "?"} EMA21 · giá ${vwap != null ? (last > vwap ? "trên" : "dưới") : "?"} VWAP ${vwapDistPct != null ? `(${vwapDistPct >= 0 ? "+" : ""}${vwapDistPct.toFixed(2)}%)` : ""}`,
    `Momentum 3 nến ${mom3 != null ? `${mom3 >= 0 ? "+" : ""}${mom3.toFixed(2)}%` : "?"} · 6 nến ${mom6 != null ? `${mom6 >= 0 ? "+" : ""}${mom6.toFixed(2)}%` : "?"} · RSI7 ${rsi7?.toFixed(0) ?? "?"}`,
    `Volume ${volRatio != null ? `x${volRatio.toFixed(1)} median` : "n/a"}${spike ? " → SPIKE" : ""} · ATR ${atrV != null ? `${fmt(atrV)} (${atrPct?.toFixed(2)}%)` : "?"}`,
  ];

  return {
    timeframe: opts.timeframe ?? "5m",
    direction,
    strength,
    score: Number(score.toFixed(2)),
    last,
    vwap,
    vwapDistPct,
    ema9,
    ema21,
    rsi7,
    atr: atrV,
    atrPct,
    momentum: { bars3: mom3, bars6: mom6 },
    volume: { ratioVsMedian: volRatio, spike },
    entryZone,
    invalidation,
    micro,
    riskNotes,
    evidence,
  };
}

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 1 : 4 });
