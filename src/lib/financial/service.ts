import "server-only";
import type { FinancialHealthResult } from "../engines/fundamental";
import type { FinancialPackage, FinancialPackageMeta, GrowthSnapshot, NormalizedPeriod } from "./types";
import type { FinancialQualityResult } from "./validation";
import type { Meta } from "../types";
import { getFinancialPackageCore } from "./service-body";

/** Request-scoped singleflight + TTL cache inside core */
export async function getFinancialPackage(symbol: string): Promise<{
  pkg: FinancialPackage;
  health: FinancialHealthResult;
  quality: FinancialQualityResult | null;
  meta: Meta;
} | null> {
  const { coalesce } = await import("../data-engine/coalesce");
  const sym = symbol.toUpperCase();
  return coalesce(
    `financial:package:${sym}`,
    () => getFinancialPackageCore(sym),
    { sourceIds: ["vndirect-fs"] },
  );
}

export async function getFinancialsForSymbol(symbol: string): Promise<{
  financials: {
    income: Record<string, unknown>[] | null;
    balance: Record<string, unknown>[] | null;
    cashflow: Record<string, unknown>[] | null;
    ratios: Record<string, unknown>[] | null;
  };
  health: FinancialHealthResult;
  packageMeta: FinancialPackageMeta;
  growth: GrowthSnapshot | null;
  ttm: NormalizedPeriod | null;
  quality: FinancialQualityResult | null;
  meta: Meta;
  notes: string[];
} | null> {
  const r = await getFinancialPackage(symbol);
  if (!r) return null;
  const has = r.pkg.income.length + r.pkg.balance.length + r.pkg.cashflow.length > 0;
  const notes: string[] = [];
  if (r.pkg.meta.note) notes.push(r.pkg.meta.note);
  if (r.pkg.meta.freshnessStatus === "STALE") notes.push("Dữ liệu đang dùng bản lưu gần nhất (stale cache).");
  if (r.pkg.meta.freshnessStatus === "DISCREPANCY_DETECTED")
    notes.push("Phát hiện lệch số liệu giữa các nguồn — ưu tiên nguồn chính.");
  if (r.pkg.meta.qualityScore != null)
    notes.push(`Data quality score: ${r.pkg.meta.qualityScore}/100 (${r.pkg.meta.qualityStatus ?? "—"})`);
  if (r.pkg.ttm) notes.push(`TTM sẵn sàng: ${r.pkg.ttm.period}`);
  else notes.push("TTM chưa tính được (cần ≥4 quý).");
  if (r.health.industry) notes.push(`Profile ngành: ${r.health.industry.labelVi} (${r.health.industry.id})`);
  if (r.health.riskFlags?.length) notes.push(...r.health.riskFlags.slice(0, 3));
  if (!has) notes.push("Chưa có báo cáo tài chính khả dụng.");

  return {
    financials: {
      income: r.pkg.income.length ? r.pkg.income : null,
      balance: r.pkg.balance.length ? r.pkg.balance : null,
      cashflow: r.pkg.cashflow.length ? r.pkg.cashflow : null,
      ratios: r.pkg.ratios.length ? r.pkg.ratios : null,
    },
    health: r.health,
    packageMeta: r.pkg.meta,
    growth: r.pkg.growth,
    ttm: r.pkg.ttm,
    quality: r.quality,
    meta: r.meta,
    notes,
  };
}

export { getFinancialPackageCore } from "./service-body";
