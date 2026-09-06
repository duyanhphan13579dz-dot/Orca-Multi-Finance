/**
 * VN RATIO ENGINE (Phase 5) — deterministic financial ratios từ báo cáo tài
 * chính VNDirect (pivot rows). Không bao giờ sinh số nếu thiếu đầu vào:
 * mọi tỷ số thiếu dữ liệu → null (UI/contract hiển thị "—").
 *
 * Nguồn ưu tiên: VNDirect `/v4/ratios` (raw, itemName) nếu service nhận diện
 * được; engine này là deterministic fallback + chuẩn hoá chỉ số chuẩn.
 */

import type { Meta } from "../types";

type Row = Record<string, unknown>;

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");

function numOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, (m) => (m === "," ? "" : m)));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Lấy giá trị từ raw period row: canonical key trước, strip-alias sau. */
function val(row: Row, aliases: string[]): number | null {
  for (const alias of aliases) {
    const direct = row[alias];
    const d = numOf(direct);
    if (d != null) return d;
  }
  const keys = Object.keys(row);
  for (const alias of aliases) {
    for (const k of keys) {
      if (!strip(k).includes(strip(alias))) continue;
      const n = numOf(row[k]);
      if (n != null) return n;
    }
  }
  return null;
}

const div = (a: number | null, b: number | null): number | null => (a != null && b != null && b !== 0 ? a / b : null);
const pct = (a: number | null, b: number | null): number | null => {
  const r = div(a, b);
  return r != null ? r * 100 : null;
};

export interface VnRatioRow {
  period: string | null;
  year: number | null;
  quarter: number | null;
  /** raw VNDirect ratios nếu trùng kỳ (không bịa) */
  sourceHint: "VNDIRECT_RATIOS" | "CALCULATED";
  [key: string]: unknown;
}

/** hợp nhất số liệu hai kỳ: period match theo reportDate/fiscalDate; gộp key, không ghi đè row. */
function mergeByPeriod(a: Row[], b: Row[]): Map<string, { row: Row; raw: Row | null }> {
  const map = new Map<string, { row: Row; raw: Row | null }>();
  const add = (r: Row, raw: boolean) => {
    const key = String(r.period ?? r.fiscalDate ?? r.reportDate ?? "?");
    let hit = map.get(key);
    if (!hit) {
      hit = { row: {}, raw: null };
      map.set(key, hit);
    }
    for (const [k, v] of Object.entries(r)) {
      if (k === "period" || k === "fiscalDate" || k === "reportDate") {
        if (hit.row[k] == null) hit.row[k] = v;
      } else hit.row[k] = v;
    }
    if (raw) hit.raw = r;
  };
  for (const r of a) add(r, false);
  for (const r of b) add(r, true);
  return map;
}

export function computeRatioRows(
  income: Row[],
  balance: Row[],
  cashflow: Row[],
  opts: { price: number | null; providerRatioRows?: Row[] },
): VnRatioRow[] {
  const merged = mergeByPeriod([...income, ...balance, ...cashflow], opts.providerRatioRows ?? []);
  const out: VnRatioRow[] = [];
  const sorted = [...merged.entries()].sort(([ka], [kb]) => kb.localeCompare(ka));
  for (const [, { row, raw }] of sorted) {
    const revenue = val(row, ["revenue", "doanh thu thuan"]);
    const grossProfit = val(row, ["grossProfit", "loi nhuan gop"]);
    const ebit = val(row, ["ebit", "loi nhuan thu tu hoat dong"]);
    const ebitda = val(row, ["ebitda"]);
    const interest = val(row, ["interestExpense", "chi phi lai vay"]);
    const netProfit = val(row, ["netProfit", "loi nhuan sau thue", "loi nhuan rong"]);
    const assets = val(row, ["totalAssets", "tong cong tai san"]);
    const currentAssets = val(row, ["currentAssets", "tai san ngan han"]);
    const liabilities = val(row, ["totalLiabilities", "no phai tra"]);
    const currentLiab = val(row, ["currentLiabilities", "no ngan han"]);
    const equity = val(row, ["equity", "von chu so huu"]);
    const shortDebt = val(row, ["shortDebt", "vay ngan han"]);
    const longDebt = val(row, ["longDebt", "vay dai han"]);
    const inventory = val(row, ["inventory", "hang ton kho"]);
    const ocf = val(row, ["ocf", "luu chuyen tien tu hoat dong kinh doanh"]);
    const capex = val(row, ["capex", "mua sam tai san co dinh"]);
    const shares = val(row, ["shares", "co phieu dang luu hanh", "co phieu luu hanh"]);
    const epsRaw = val(row, ["eps"]);
    const bvpsRaw = val(row, ["bvps"]);

    const eps = epsRaw ?? div(netProfit, shares);
    const bvps = bvpsRaw ?? div(equity, shares);
    const price = opts.price;
    const debtFinal = shortDebt != null || longDebt != null ? (shortDebt ?? 0) + (longDebt ?? 0) : liabilities;
    const fcf = ocf != null && capex != null ? ocf - capex : null;

    const r: VnRatioRow = {
      period: String(row.period ?? row.fiscalDate ?? ""),
      year: val(row, ["year"]) ?? (row.period ? Number(String(row.period).slice(0, 4)) || null : null),
      quarter: val(row, ["quarter"]),
      sourceHint: raw ? "VNDIRECT_RATIOS" : "CALCULATED",
      "P/E": price != null && eps != null && eps > 0 ? Number((price / eps).toFixed(2)) : null,
      "P/B": price != null && bvps != null && bvps > 0 ? Number((price / bvps).toFixed(2)) : null,
      "ROE (%)": pct(netProfit, equity),
      "ROA (%)": pct(netProfit, assets),
      "Gross Margin (%)": pct(grossProfit, revenue),
      "Operating Margin (%)": pct(ebit, revenue),
      "Net Margin (%)": pct(netProfit, revenue),
      "Debt/Equity (x)": div(debtFinal, equity),
      "Current Ratio (x)": div(currentAssets, currentLiab),
      "Quick Ratio (x)": div(currentAssets != null && inventory != null ? currentAssets - inventory : null, currentLiab),
      "EPS": eps,
      "BVPS": bvps,
      "EBITDA/Assets (x)": div(ebitda, assets),
      "EBITDA/Interest (x)": div(ebitda, interest),
      "FCF/EBIT (x)": div(fcf, ebit),
    };

    // pass-through số lượng provider ratio (chỉ khi cùng kỳ, không thay thế)
    if (raw) {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "number" && !(k in r)) r[k] = v;
      }
    }
    // bỏ kỳ không có period
    if (r.period) out.push(r);
  }
  return out;
}

/** helper trạng thái dữ liệu cho response ratios. */
export function ratioMeta(rows: VnRatioRow[], source: string): Meta {
  return {
    source,
    sourceTimestamp: null,
    ingestedAt: new Date().toISOString(),
    freshness: rows.length ? "FRESH" : "UNAVAILABLE",
    ageMs: null,
    cached: false,
    stale: false,
    partial: rows.length === 0,
  };
}
