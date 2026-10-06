import type { AssumptionSet } from "../types";

export const DEFAULT_ASSUMPTIONS: AssumptionSet = {
  inflationRate: 3.5,
  salaryGrowthRate: 6.0,
  returnsConservative: 5.5,
  returnsBase: 9.0,
  returnsAggressive: 13.0,
  retirementAge: 62,
  lifeExpectancy: 82,
  sourceNotes: "Lãi suất huy động Big4 & mục tiêu lạm phát CPI",
  updatedAt: "01/10/2026",
};

/** Full Monte-Carlo projection will be restored in W3 from Orca-Wallet. */
export function runFinancialProjection(..._args: unknown[]): null {
  return null;
}
