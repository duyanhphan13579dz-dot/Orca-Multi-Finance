import "server-only";
import { VSDC } from "./vsdc-spec";

/**
 * Indicative initial margin rates from public VSDC notices (versioned) — P2.
 * NOT a trading recommendation — UI must show source + effectiveFrom.
 */

export interface MarginScheduleEntry {
  productId: string;
  /** Fraction of notional, e.g. 0.13 = 13% */
  initialMarginRate: number | null;
  maintenanceMarginRate: number | null;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  sourceUrl: string | null;
  note: string;
}

export const MARGIN_SCHEDULE: MarginScheduleEntry[] = [
  {
    productId: "VN30_INDEX_FUT",
    initialMarginRate: 0.13,
    maintenanceMarginRate: 0.1,
    currency: "VND",
    effectiveFrom: "2024-01-01T00:00:00+07:00",
    effectiveTo: null,
    source: VSDC,
    sourceUrl: "https://www.vsd.vn",
    note: "Indicative seed — verify against current VSDC notice before use",
  },
  {
    productId: "VN100_INDEX_FUT",
    initialMarginRate: 0.13,
    maintenanceMarginRate: 0.1,
    currency: "VND",
    effectiveFrom: "2024-01-01T00:00:00+07:00",
    effectiveTo: null,
    source: VSDC,
    sourceUrl: "https://www.vsd.vn",
    note: "Indicative seed — verify against current VSDC notice before use",
  },
  {
    productId: "GB05_BOND_FUT",
    initialMarginRate: null,
    maintenanceMarginRate: null,
    currency: "VND",
    effectiveFrom: "2024-01-01T00:00:00+07:00",
    effectiveTo: null,
    source: VSDC,
    sourceUrl: "https://www.vsd.vn",
    note: "Margin rate not seeded — requires VSDC bond futures notice",
  },
  {
    productId: "GB10_BOND_FUT",
    initialMarginRate: null,
    maintenanceMarginRate: null,
    currency: "VND",
    effectiveFrom: "2024-01-01T00:00:00+07:00",
    effectiveTo: null,
    source: VSDC,
    sourceUrl: "https://www.vsd.vn",
    note: "Margin rate not seeded — requires VSDC bond futures notice",
  },
];

export function getMarginForProduct(
  productId: string,
  at = new Date(),
): MarginScheduleEntry | null {
  const atMs = at.getTime();
  const rows = MARGIN_SCHEDULE.filter((m) => m.productId === productId)
    .filter((m) => {
      const from = Date.parse(m.effectiveFrom);
      if (!Number.isFinite(from) || from > atMs) return false;
      if (m.effectiveTo) {
        const to = Date.parse(m.effectiveTo);
        if (Number.isFinite(to) && to < atMs) return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  return rows[0] ?? null;
}

export function estimateInitialMarginVnd(
  productId: string,
  last: number | null,
  multiplier: number | null,
  at = new Date(),
): {
  notional: number | null;
  initialMargin: number | null;
  rate: number | null;
  entry: MarginScheduleEntry | null;
} {
  const entry = getMarginForProduct(productId, at);
  if (last == null || !Number.isFinite(last) || last <= 0) {
    return { notional: null, initialMargin: null, rate: entry?.initialMarginRate ?? null, entry };
  }
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 0) {
    return { notional: null, initialMargin: null, rate: entry?.initialMarginRate ?? null, entry };
  }
  const notional = last * multiplier;
  const rate = entry?.initialMarginRate ?? null;
  const initialMargin = rate != null ? notional * rate : null;
  return { notional, initialMargin, rate, entry };
}
