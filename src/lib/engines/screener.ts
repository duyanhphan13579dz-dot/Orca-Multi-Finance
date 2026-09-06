/**
 * SCREENER ENGINE — pure filter/sort over quote rows (any asset class).
 * Used by both crypto (`screenCrypto`) and the VN equity universe.
 */

export interface ScreenerRow {
  symbol: string;
  changePercent?: number | null;
  quoteVolume?: number | null;
}

export interface ScreenerParams {
  minChange?: number;
  maxChange?: number;
  minQuoteVolume?: number;
  sort?: "gainers" | "losers" | "volume";
  limit?: number;
}

/** Keep rows passing filters, then sort (default: volume desc) and cap. */
export function filterAndSortRows<T extends ScreenerRow>(rows: T[], params: ScreenerParams): T[] {
  let out = rows;
  if (params.minChange != null) out = out.filter((r) => (r.changePercent ?? 0) >= (params.minChange as number));
  if (params.maxChange != null) out = out.filter((r) => (r.changePercent ?? 0) <= (params.maxChange as number));
  if (params.minQuoteVolume != null) out = out.filter((r) => (r.quoteVolume ?? 0) >= (params.minQuoteVolume as number));
  if (params.sort === "gainers") out = [...out].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  else if (params.sort === "losers") out = [...out].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  else out = [...out].sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
  return out.slice(0, Math.max(1, params.limit ?? 40));
}
