/**
 * Engine Networth: Tổng tài sản, tổng nợ, tài sản ròng và cơ cấu.
 * Bất biến: Tài sản ròng luôn bằng Tổng tài sản trừ Tổng nợ.
 */

import { AssetItem, DebtItem, AssetCategoryKey } from '../types/finance.ts';

export interface AssetCategorySummary {
  category: AssetCategoryKey;
  label: string;
  total: number;
  percentage: number; // % của tổng tài sản
}

export interface NetworthResult {
  totalAssets: number;
  totalDebt: number;
  netWorth: number; // Invariant: totalAssets - totalDebt
  liquidAssets: number; // Tiền mặt + tiền gửi thanh khoản
  investedAssets: number; // Chứng khoán + quỹ + vàng + crypto
  illiquidAssets: number; // Bất động sản + khác
  assetBreakdown: AssetCategorySummary[];
  debtToAssetRatio: number; // % nợ trên tài sản
  // So sánh với tháng trước và năm trước nếu có
  momChange?: {
    amount: number;
    percent: number;
  };
  yoyChange?: {
    amount: number;
    percent: number;
  };
}

const ASSET_CATEGORY_LABELS: Record<AssetCategoryKey, string> = {
  cash: 'Tiền mặt & Ví điện tử',
  savings: 'Tiền gửi tiết kiệm',
  gold: 'Vàng & Kim loại quý',
  stocks: 'Cổ phiếu & Trái phiếu',
  funds: 'Chứng chỉ quỹ (ETF, Mutual Fund)',
  real_estate: 'Bất động sản',
  crypto: 'Tài sản số (Crypto)',
  other: 'Tài sản khác',
};

export function calculateNetworth(
  assets: AssetItem[],
  debts: DebtItem[],
  previousMonthNetworth?: number,
  previousYearNetworth?: number
): NetworthResult {
  let totalAssets = 0;
  let liquidAssets = 0;
  let investedAssets = 0;
  let illiquidAssets = 0;

  const categoryTotals: Record<AssetCategoryKey, number> = {
    cash: 0,
    savings: 0,
    gold: 0,
    stocks: 0,
    funds: 0,
    real_estate: 0,
    crypto: 0,
    other: 0,
  };

  for (const asset of assets) {
    const bal = Math.max(0, asset.balance);
    totalAssets += bal;
    categoryTotals[asset.category] = (categoryTotals[asset.category] || 0) + bal;

    if (asset.category === 'cash' || asset.category === 'savings') {
      liquidAssets += bal;
    } else if (
      asset.category === 'gold' ||
      asset.category === 'stocks' ||
      asset.category === 'funds' ||
      asset.category === 'crypto'
    ) {
      investedAssets += bal;
    } else {
      illiquidAssets += bal;
    }
  }

  let totalDebt = 0;
  for (const debt of debts) {
    totalDebt += Math.max(0, debt.balance);
  }

  // Bất biến cốt lõi: Tài sản ròng = Tổng tài sản - Tổng nợ
  const netWorth = totalAssets - totalDebt;

  const assetBreakdown: AssetCategorySummary[] = (
    Object.keys(categoryTotals) as AssetCategoryKey[]
  ).map((cat) => {
    const total = categoryTotals[cat];
    const percentage = totalAssets > 0
      ? Number(((total / totalAssets) * 100).toFixed(2))
      : 0;
    return {
      category: cat,
      label: ASSET_CATEGORY_LABELS[cat],
      total,
      percentage,
    };
  });

  const debtToAssetRatio = totalAssets > 0
    ? Number(((totalDebt / totalAssets) * 100).toFixed(2))
    : 0;

  // Tính MoM
  let momChange: NetworthResult['momChange'];
  if (typeof previousMonthNetworth === 'number') {
    const diff = netWorth - previousMonthNetworth;
    const pct = previousMonthNetworth !== 0
      ? Number(((diff / Math.abs(previousMonthNetworth)) * 100).toFixed(2))
      : 0;
    momChange = { amount: diff, percent: pct };
  }

  // Tính YoY
  let yoyChange: NetworthResult['yoyChange'];
  if (typeof previousYearNetworth === 'number') {
    const diff = netWorth - previousYearNetworth;
    const pct = previousYearNetworth !== 0
      ? Number(((diff / Math.abs(previousYearNetworth)) * 100).toFixed(2))
      : 0;
    yoyChange = { amount: diff, percent: pct };
  }

  return {
    totalAssets,
    totalDebt,
    netWorth,
    liquidAssets,
    investedAssets,
    illiquidAssets,
    assetBreakdown,
    debtToAssetRatio,
    momChange,
    yoyChange,
  };
}
