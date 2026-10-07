import type { ChartCandle } from "../chart-const";

/** VN OHLCV is board-lot (58 = 58k VND); live quote is full VND. Unify to full VND. */
export function scaleVnStockToFullVnd(candles: ChartCandle[]): ChartCandle[] {
  if (candles.length < 3) return candles;
  const sample = candles.slice(-Math.min(30, candles.length));
  const maxClose = Math.max(...sample.map((c) => c.close));
  if (!(maxClose > 0) || maxClose >= 1_000) return candles;
  return candles.map((c) => ({
    ...c,
    open: c.open * 1_000,
    high: c.high * 1_000,
    low: c.low * 1_000,
    close: c.close * 1_000,
  }));
}

export function finalizeStockSeries<T extends { candles: ChartCandle[] }>(r: T): T {
  if (!r.candles.length) return r;
  return { ...r, candles: scaleVnStockToFullVnd(r.candles) };
}
