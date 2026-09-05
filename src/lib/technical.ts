import type { CandlePattern, OhlcvBar, TechnicalSnapshot } from "./types";

/**
 * Technical analysis engine — deterministic quantitative computations.
 * All indicators are computed from real OHLCV series only.
 */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const valid = macdLine.filter((v): v is number => v != null);
  const signalValid = ema(valid, signalPeriod);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] != null) {
      signalLine[i] = signalValid[j] ?? null;
      j++;
    }
  }
  const last = macdLine[values.length - 1];
  const sig = signalLine[values.length - 1];
  return {
    line: macdLine,
    signal: signalLine,
    last: last != null && sig != null ? { macd: last, signal: sig, histogram: last - sig } : null,
  };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
}

export function atr(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** annualized volatility from log returns (assuming daily bars) */
export function annualizedVolatility(closes: number[], lookback = 30): number | null {
  if (closes.length < lookback + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - lookback; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function pctChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const prev = closes[closes.length - 1 - days];
  if (!prev) return null;
  return (closes[closes.length - 1] / prev - 1) * 100;
}

/** Swing-based support/resistance from recent local extrema + round levels */
export function supportResistance(bars: OhlcvBar[], lookback = 120): { support: number[]; resistance: number[] } {
  const slice = bars.slice(-lookback);
  if (slice.length < 10) return { support: [], resistance: [] };
  const last = slice[slice.length - 1].close;
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    const b = slice[i];
    if (b.high >= slice[i - 1].high && b.high >= slice[i - 2].high && b.high >= slice[i + 1].high && b.high >= slice[i + 2].high) highs.push(b.high);
    if (b.low <= slice[i - 1].low && b.low <= slice[i - 2].low && b.low <= slice[i + 1].low && b.low <= slice[i + 2].low) lows.push(b.low);
  }
  const cluster = (levels: number[], below: boolean): number[] => {
    const tolFor = (p: number) => p * 0.005;
    const sorted = levels.filter((l) => (below ? l < last * 0.995 : l > last * 1.005)).sort((a, b) => (below ? b - a : a - b));
    const out: number[] = [];
    for (const l of sorted) {
      if (out.some((o) => Math.abs(o - l) <= tolFor(l))) continue;
      out.push(l);
      if (out.length >= 3) break;
    }
    return out;
  };
  return { support: cluster(lows, true), resistance: cluster(highs, false) };
}

/* -------------------------------- patterns --------------------------------- */

export function detectPatterns(bars: OhlcvBar[]): CandlePattern[] {
  const out: CandlePattern[] = [];
  if (bars.length < 5) return out;
  const b = bars.slice(-5);
  const cur = b[b.length - 1];
  const prev = b[b.length - 2];
  const prev2 = b[b.length - 3];
  const prev3 = b[b.length - 4];
  const body = (x: OhlcvBar) => Math.abs(x.close - x.open);
  const range = (x: OhlcvBar) => Math.max(x.high - x.low, 1e-12);
  const avgBody = (body(cur) + body(prev) + body(prev2) + body(prev3)) / 4;
  const upperWick = cur.high - Math.max(cur.close, cur.open);
  const lowerWick = Math.min(cur.close, cur.open) - cur.low;
  const avgRange20 = bars.slice(-20).reduce((a, x) => a + range(x), 0) / Math.min(20, bars.length);

  if (body(cur) <= range(cur) * 0.1 && range(cur) >= avgRange20 * 0.7) {
    out.push({
      name: "Doji", nameVi: "Nến Doji", type: "neutral", reliability: "medium",
      description: "Thị trường lưỡng lự tại phiên gần nhất; lực mua và bán tạm thờ cân bằng — thường báo hiệu nhịp hiện tại đang chững lại.",
    });
  }
  if (lowerWick > body(cur) * 2 && upperWick < body(cur) && body(cur) > 0) {
    out.push({
      name: "Hammer", nameVi: "Nến Búa", type: "bullish", reliability: "medium",
      description: "Bóng dưới dài cho thấy lực bán bị hấp thụ và giá được kéo ngược lên cuối phiên — tín hiệu đảo chiều tăng nếu xuất hiện sau nhịp giảm.",
    });
  }
  if (upperWick > body(cur) * 2 && lowerWick < body(cur) && body(cur) > 0) {
    out.push({
      name: "Shooting Star", nameVi: "Sao băng", type: "bearish", reliability: "medium",
      description: "Giá bị đẩy lên trong phiên nhưng áp lực chốt lờ kéo về sát đáy — cảnh báo lực cầu suy yếu tại vùng cao.",
    });
  }
  if (prev.close < prev.open && cur.close > cur.open && body(cur) > avgBody && body(cur) > body(prev) * 1.1 && cur.close >= prev.open && cur.open <= prev.close) {
    out.push({
      name: "Bullish Engulfing", nameVi: "Nhấn chìm tăng", type: "bullish", reliability: "high",
      description: "Nến tăng hiện tại bao trùm thân nến giảm trước đó — phe mua giành lại quyền kiểm soát trong ngắn hạn.",
    });
  }
  if (prev.close > prev.open && cur.close < cur.open && body(cur) > avgBody && body(cur) > body(prev) * 1.1 && cur.close <= prev.open && cur.open >= prev.close) {
    out.push({
      name: "Bearish Engulfing", nameVi: "Nhấn chìm giảm", type: "bearish", reliability: "high",
      description: "Nến giảm hiện tại bao trùm thân nến tăng trước đó — áp lực bán áp đảo, rủi ro điều chỉnh tăng lên.",
    });
  }
  const firstBig = body(prev2) > avgBody * 1.2 && prev2.close < prev2.open;
  const midSmall = body(prev) < avgBody * 0.5;
  const lastBig = cur.close > cur.open && body(cur) > avgBody * 1.2 && cur.close > (prev2.open + prev2.close) / 2;
  if (firstBig && midSmall && lastBig) {
    out.push({
      name: "Morning Star", nameVi: "Sao mai", type: "bullish", reliability: "high",
      description: "Cấu trúc giảm mạnh — nến nhỏ lưỡng lự — tăng mạnh lấy lại thân nến đầu: mô hình đảo chiều đáy kinh điển.",
    });
  }
  const e1 = prev2.close > prev2.open && body(prev2) > avgBody * 1.2;
  const e2 = midSmall;
  const e3 = cur.close < cur.open && body(cur) > avgBody * 1.2 && cur.close < (prev2.open + prev2.close) / 2;
  if (e1 && e2 && e3) {
    out.push({
      name: "Evening Star", nameVi: "Sao hôm", type: "bearish", reliability: "high",
      description: "Sau nhịp tăng mạnh, nến doji nhỏ xuất hiện rồi bị nến giảm mạnh bứt phá — dấu hiệu hình thành đỉnh ngắn hạn.",
    });
  }
  const threeUp = [prev3, prev2, prev].every((x) => x.close > x.open) && prev3.close < prev2.close && prev2.close < prev.close;
  if (threeUp) {
    out.push({
      name: "Three White Soldiers", nameVi: "Ba chàng lính trắng", type: "bullish", reliability: "high",
      description: "Ba phiên tăng liên tiếp với thân nến đều đặn — đà tăng được củng cố bởi dòng tiền ổn định.",
    });
  }
  const threeDown = [prev3, prev2, prev].every((x) => x.close < x.open) && prev3.close > prev2.close && prev2.close > prev.close;
  if (threeDown) {
    out.push({
      name: "Three Black Crows", nameVi: "Ba con quạ đen", type: "bearish", reliability: "high",
      description: "Ba phiên giảm liên tiếp cho thấy áp lực phân phối kéo dài — cần thận trọng với vị thế mua đuổi.",
    });
  }
  return out.slice(0, 4);
}

/* ------------------------------ full snapshot ------------------------------ */

export function analyzeSeries(bars: OhlcvBar[]): TechnicalSnapshot | null {
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const rsiArr = rsi(closes, 14);
  const rsi14 = rsiArr[closes.length - 1] ?? null;
  const macdRes = macd(closes).last;
  const smaArr = (p: number) => sma(closes, p)[closes.length - 1] ?? null;
  const emaArr = (p: number) => ema(closes, p)[closes.length - 1] ?? null;
  const sma20 = smaArr(20);
  const sma50 = smaArr(50);
  const sma200 = smaArr(200);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atr(bars, 14);
  const vol = annualizedVolatility(closes, 30);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const ytdBase = bars.filter((b) => b.time < yearStart).pop();
  const ytd = ytdBase && ytdBase.close ? (last / ytdBase.close - 1) * 100 : pctChange(closes, 250);
  const highs = bars.slice(-252).map((b) => b.high);
  const lows = bars.slice(-252).map((b) => b.low);
  const high52w = highs.length ? Math.max(...highs) : null;
  const low52w = lows.length ? Math.min(...lows) : null;
  const sr = supportResistance(bars);

  /* trend score -3..+3 */
  let score = 0;
  if (sma20 != null) score += last > sma20 ? 1 : -1;
  if (sma50 != null) score += last > sma50 ? 1 : -1;
  if (sma200 != null) score += last > sma200 ? 1 : -1;
  if (sma20 != null && sma50 != null) score += sma20 > sma50 ? 0.5 : -0.5;
  if (macdRes) score += macdRes.histogram > 0 ? 0.5 : -0.5;
  if (rsi14 != null) score += rsi14 > 55 ? 0.5 : rsi14 < 45 ? -0.5 : 0;
  score = Math.max(-3, Math.min(3, score));
  const label =
    score >= 2 ? "strong-up" : score >= 0.5 ? "up" : score <= -2 ? "strong-down" : score <= -0.5 ? "down" : "sideways";

  const signals: string[] = [];
  if (rsi14 != null) {
    if (rsi14 >= 70) signals.push("RSI quá mua (>70) — dễ rung lắc ngắn hạn");
    else if (rsi14 <= 30) signals.push("RSI quá bán (<30) — khả năng hồi kỹ thuật");
    else signals.push(`RSI ${rsi14.toFixed(0)} — vùng cân bằng`);
  }
  if (macdRes) signals.push(macdRes.histogram > 0 ? "MACD hỗ trợ xu hướng tăng" : "MACD nghiêng về áp lực bán");
  if (sma50 != null) signals.push(last > sma50 ? "Giá duy trì trên SMA50 — xu hướng trung hạn còn nguyên" : "Giá nằm dưới SMA50 — xu hướng trung hạn suy yếu");
  if (bb) {
    const pos = (last - bb.lower) / (bb.upper - bb.lower);
    if (pos > 0.95) signals.push("Chạm biên trên Bollinger — độ nóng cao");
    else if (pos < 0.05) signals.push("Chạm biên dưới Bollinger — vùng hỗ trợ kỹ thuật");
  }
  if (high52w != null && last >= high52w * 0.98) signals.push("Tiệm cận đỉnh 52 tuần");
  if (low52w != null && last <= low52w * 1.02) signals.push("Tiệm cận đáy 52 tuần");

  return {
    last,
    rsi14,
    macd: macdRes,
    sma: { sma20, sma50, sma200 },
    ema: { ema12: emaArr(12), ema26: emaArr(26) },
    bollinger: bb,
    atr14,
    volatility30d: vol,
    maxDrawdown: maxDrawdown(closes.slice(-252)),
    returns: { d7: pctChange(closes, 7), d30: pctChange(closes, 30), ytd: ytd ?? null, y1: pctChange(closes, 252) },
    high52w,
    low52w,
    support: sr.support,
    resistance: sr.resistance,
    trend: { score, label },
    signals,
  };
}
