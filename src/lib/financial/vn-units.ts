/**
 * Vietnam equity price-unit helpers.
 *
 * VNDirect/SSI market quotes are commonly expressed in thousand VND while
 * financial statements and per-share ratios use full VND. Some feeds already
 * return full VND, so preserve the existing feed-contract heuristic in one
 * shared place rather than mixing units inside valuation formulas.
 */
export type VnPriceScale = 1 | 1_000;

export function vnPriceScale(priceQuote: number | null | undefined): VnPriceScale {
  if (typeof priceQuote !== "number" || !Number.isFinite(priceQuote) || priceQuote <= 0) {
    // VN market quote APIs default to thousand-VND units when no quote is present.
    return 1_000;
  }
  return priceQuote < 500 ? 1_000 : 1;
}

export function vnPriceQuoteToVnd(priceQuote: number | null | undefined): number | null {
  if (typeof priceQuote !== "number" || !Number.isFinite(priceQuote) || priceQuote <= 0) {
    return null;
  }
  return priceQuote * vnPriceScale(priceQuote);
}

export function vnVndPerShareToQuote(
  priceVnd: number | null | undefined,
  scale: VnPriceScale,
): number | null {
  if (typeof priceVnd !== "number" || !Number.isFinite(priceVnd)) return null;
  const value = priceVnd / scale;
  return Number.isFinite(value) ? value : null;
}
