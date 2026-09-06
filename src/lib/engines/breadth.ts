/**
 * MARKET BREADTH ENGINE (Phase 3) — độ rộng thị trường từ dữ liệu thật.
 *
 * Không tag "thị trường khoẻ/yếu" từ dấu chỉ số: breadth là participation
 * thực của các mã. Mọi chỉ số phụ (new highs/lows, % trên SMA) chỉ tính khi
 * có chuỗi OHLCV; nếu không có → fields null + note, không suy diễn.
 */

export interface BreadthQuoteInput {
  symbol: string;
  changePercent: number | null;
  price?: number | null;
  volume?: number | null;
  quoteVolume?: number | null;
  /** tuỳ chọn: bars cho các chỉ số độ sâu */
  bars?: { close: number; high: number; low: number; time: number; volume: number }[] | null;
}

export interface BreadthResult {
  advancers: number;
  decliners: number;
  unchanged: number;
  total: number;
  advanceRatio: number; // advancers / (advancers+decliners), 0..1
  netAdvance: number; // advancers - decliners
  /** volume-weighted participation */
  upVolume: number;
  downVolume: number;
  volumeRatio: number | null; // upVolume / downVolume (null nếu down = 0)
  /** % mã trên SMA20 / SMA50 (cần bars) */
  pctAboveSma20: number | null;
  pctAboveSma50: number | null;
  /** new highs / new lows trong 20 phiên (cần bars) */
  newHighs20: number | null;
  newLows20: number | null;
  /** composite 0..100 (50 = cân bằng) */
  score: number;
  note: string | null;
}

function smaLast(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

export function computeBreadth(quotes: BreadthQuoteInput[]): BreadthResult {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let upVolume = 0;
  let downVolume = 0;
  let above20 = 0;
  let above50 = 0;
  let high20 = 0;
  let low20 = 0;
  let depthCount = 0;
  let sma20Count = 0;
  let sma50Count = 0;

  for (const q of quotes) {
    const ch = q.changePercent ?? 0;
    if (ch > 0) advancers += 1;
    else if (ch < 0) decliners += 1;
    else unchanged += 1;
    const vol = q.quoteVolume ?? q.volume ?? 0;
    if (ch > 0) upVolume += vol;
    else if (ch < 0) downVolume += vol;

    const bars = q.bars;
    if (bars && bars.length >= 20) {
      depthCount += 1;
      const closes = bars.map((b) => b.close);
      const last = closes[closes.length - 1];
      const s20 = smaLast(closes, 20);
      const s50 = smaLast(closes, 50);
      if (s20 != null) {
        sma20Count += 1;
        if (last > s20) above20 += 1;
      }
      if (s50 != null) {
        sma50Count += 1;
        if (last > s50) above50 += 1;
      }
      // new high/low trong 20 phiên (so với close trước đó)
      const window = bars.slice(-21, -1);
      if (window.length >= 10) {
        const maxPrev = Math.max(...window.map((b) => b.high));
        const minPrev = Math.min(...window.map((b) => b.low));
        if (last > maxPrev) high20 += 1;
        if (last < minPrev) low20 += 1;
      }
    }
  }

  const total = advancers + decliners + unchanged;
  const directional = advancers + decliners;
  const advanceRatio = directional > 0 ? advancers / directional : 0;
  const score = directional > 0 ? Math.round(((advancers + unchanged * 0.5) / total) * 100) : 50;
  const depthNote =
    depthCount > 0
      ? null
      : "Chưa có chuỗi OHLCV cho từng mã — %SMA và new highs/lows không tính (không suy diễn).";

  return {
    advancers,
    decliners,
    unchanged,
    total,
    advanceRatio: Number(advanceRatio.toFixed(4)),
    netAdvance: advancers - decliners,
    upVolume,
    downVolume,
    volumeRatio: downVolume > 0 ? Number((upVolume / downVolume).toFixed(3)) : upVolume > 0 ? null : null,
    pctAboveSma20: sma20Count > 0 ? Math.round((above20 / sma20Count) * 100) : null,
    pctAboveSma50: sma50Count > 0 ? Math.round((above50 / sma50Count) * 100) : null,
    newHighs20: depthCount > 0 ? high20 : null,
    newLows20: depthCount > 0 ? low20 : null,
    score,
    note: depthNote,
  };
}
