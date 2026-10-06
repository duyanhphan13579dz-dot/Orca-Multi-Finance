import type { AssetItem, DebtItem, AssetCategoryKey } from "../types";

export interface NetworthResult {
  totalAssets: number;
  liquidAssets: number;
  investedAssets: number;
  totalDebt: number;
  netWorth: number;
}

const LIQUID: AssetCategoryKey[] = ["cash", "savings"];
const INVESTED: AssetCategoryKey[] = ["stocks", "funds", "crypto", "gold"];

export function calculateNetworth(assets: AssetItem[], debts: DebtItem[]): NetworthResult {
  let totalAssets = 0;
  let liquidAssets = 0;
  let investedAssets = 0;
  for (const a of assets) {
    const bal = Math.max(0, a.balance);
    totalAssets += bal;
    if (LIQUID.includes(a.category)) liquidAssets += bal;
    if (INVESTED.includes(a.category)) investedAssets += bal;
  }
  const totalDebt = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
  return {
    totalAssets,
    liquidAssets,
    investedAssets,
    totalDebt,
    netWorth: totalAssets - totalDebt,
  };
}
