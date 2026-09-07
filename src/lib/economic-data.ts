/** Contracts and display helpers for the two standalone VietnamBiz data pages. */
export type EconomicDataset = "macro-economic" | "currency-interest-rate";
export type EconomicFrequency = "day" | "month" | "quarter" | "year" | "other";

export const ECONOMIC_DATASETS = {
  "macro-economic": {
    title: "Kinh tế vĩ mô",
    description: "Theo dõi tăng trưởng, lạm phát, sản xuất, đầu tư và thương mại Việt Nam theo kỳ công bố.",
    sourceUrl: "https://data.vietnambiz.vn/macro-economic",
    searchPlaceholder: "Tìm chỉ tiêu: GDP, CPI, xuất khẩu…",
    hasReleaseSchedule: true,
  },
  "currency-interest-rate": {
    title: "Lãi suất tiền tệ",
    description: "Theo dõi cung tiền, tín dụng, tỷ giá và mặt bằng lãi suất Việt Nam theo kỳ công bố.",
    sourceUrl: "https://data.vietnambiz.vn/currency-interest-rate",
    searchPlaceholder: "Tìm chỉ tiêu: tỷ giá, tín dụng, huy động…",
    hasReleaseSchedule: false,
  },
} as const;

export const ECONOMIC_FREQUENCIES: { key: EconomicFrequency; label: string }[] = [
  { key: "day", label: "Ngày" },
  { key: "month", label: "Tháng" },
  { key: "quarter", label: "Quý" },
  { key: "year", label: "Năm" },
  { key: "other", label: "Khác" },
];

export interface EconomicValue {
  /** Source formatting is retained; missing/invalid values are never coerced to zero. */
  text: string;
  value: number | null;
  isPercent: boolean;
}

export interface EconomicIndicator {
  id: string;
  name: string;
  period: string;
  frequency: EconomicFrequency;
  current: EconomicValue;
  previous: EconomicValue;
  /** Source wording, not an estimated date. Monetary indicators may not supply it. */
  nextRelease: string | null;
}

export interface EconomicSnapshot {
  dataset: EconomicDataset;
  sourceUrl: string;
  rows: EconomicIndicator[];
  /** Time ORCA retrieved the board, NOT the publication time of any indicator. */
  fetchedAt: string;
  warnings: string[];
}

export function normalizeEconomicText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
}

export function economicFrequency(period: string): EconomicFrequency {
  const label = normalizeEconomicText(period);
  if (/^ngay\b/.test(label)) return "day";
  if (/^thang\b/.test(label)) return "month";
  if (/^quy\b/.test(label)) return "quarter";
  if (/^nam\b/.test(label)) return "year";
  return "other";
}

/** Absolute change. Percentage-valued indicators use percentage POINTS, not relative %. */
export function economicChange(row: EconomicIndicator): { value: number; isPercentagePoint: boolean } | null {
  if (row.current.value == null || row.previous.value == null || row.current.isPercent !== row.previous.isPercent) return null;
  const difference = row.current.value - row.previous.value;
  if (!Number.isFinite(difference)) return null;
  return { value: Number(difference.toFixed(8)), isPercentagePoint: row.current.isPercent };
}

export function filterEconomicIndicators(rows: EconomicIndicator[], query: string, frequency: EconomicFrequency | "all"): EconomicIndicator[] {
  const needle = normalizeEconomicText(query);
  return rows.filter((row) =>
    (frequency === "all" || row.frequency === frequency) &&
    (!needle || normalizeEconomicText(`${row.name} ${row.period}`).includes(needle)),
  );
}
