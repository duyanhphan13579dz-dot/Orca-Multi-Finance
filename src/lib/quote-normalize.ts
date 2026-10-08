import "server-only";
import type { Quote } from "./types";

/**
 * QUOTE UNIT NORMALIZATION
 *
 * VN feeds disagree on price units:
 *  - VNDirect DStock / VPS / Entrade / VPS-hist → **nghìn VND** (VCB = 62.5)
 *  - một số nguồn (Vietcap IQ `currentPrice`, Yahoo `.VN` tuỳ endpoint) → **VND đầy đủ** (VCB = 62 500)
 *
 * Multi-source merge phải so sánh cùng đơn vị trước khi phát hiện conflict, nếu không
 * một mã chỉ có ở tier-2 có thể bị trả về lệch 1000 lần. Quy tắc ở đây chỉ chỉnh khi
 * lệch mang tính đơn vị (≥ 200× hoặc ≤ 1/200×) — không bao giờ "san phẳng" chênh lệch giá thật.
 */

/** Ratio từ mức này trở lên được coi là lệch đơn vị (nghìn VND ↔ VND đầy đủ). */
export const UNIT_SCALE_RATIO = 200;
export const UNIT_SCALE_FACTOR = 1_000;

/** Các field giá cần scale cùng lúc với `price`. */
const PRICE_FIELDS = [
  "price",
  "open",
  "high",
  "low",
  "referencePrice",
  "ceilingPrice",
  "floorPrice",
] as const;

function scaleFields(q: Quote, factor: number): Quote {
  const out: Quote = { ...q };
  for (const f of PRICE_FIELDS) {
    const v = out[f];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[f] = v * factor;
    }
  }
  return out;
}

/**
 * Align `candidate` to the unit used by `reference` (same symbol, different source).
 * Returns the candidate unchanged when there is no reference or the gap is not a unit gap.
 */
export function normalizeQuoteScale(candidate: Quote, reference?: Quote | null): Quote {
  const refPrice = Number(reference?.price);
  const price = Number(candidate?.price);
  if (!(refPrice > 0) || !(price > 0)) return candidate;
  const ratio = price / refPrice;
  if (ratio >= UNIT_SCALE_RATIO) return scaleFields(candidate, 1 / UNIT_SCALE_FACTOR);
  if (ratio <= 1 / UNIT_SCALE_RATIO) return scaleFields(candidate, UNIT_SCALE_FACTOR);
  return candidate;
}

/** True when both quotes look like the same instrument in the same unit. */
export function samePriceUnit(a: Quote, b: Quote): boolean {
  const pa = Number(a?.price);
  const pb = Number(b?.price);
  if (!(pa > 0) || !(pb > 0)) return true;
  const ratio = pa / pb;
  return ratio < UNIT_SCALE_RATIO && ratio > 1 / UNIT_SCALE_RATIO;
}
