import type { AssumptionSet, RiskTolerance } from "../types";

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

export interface YearProjectionPoint {
  age: number;
  year: number;
  portfolio: number;
  contributions: number;
  realPortfolio: number;
}

export interface RetirementAnalysis {
  retirementAge: number;
  portfolioAtRetirement: number;
  realPortfolioAtRetirement: number;
  yearsOfCoverage: number;
  sustainableMonthlySpend: number;
  shortfall: boolean;
}

export interface ProjectionResult {
  series: YearProjectionPoint[];
  retirement: RetirementAnalysis;
  annualReturnUsed: number;
}

function returnForRisk(risk: RiskTolerance | string, a: AssumptionSet): number {
  if (risk === "conservative") return a.returnsConservative;
  if (risk === "aggressive" || risk === "growth") return a.returnsAggressive;
  return a.returnsBase;
}

export function runFinancialProjection(params: {
  currentAge: number;
  currentNetWorth: number;
  annualSavings: number;
  assumptions?: AssumptionSet;
  riskTolerance?: RiskTolerance | string;
  targetMonthlySpendAtRetirement?: number;
}): ProjectionResult {
  const a = params.assumptions ?? DEFAULT_ASSUMPTIONS;
  const annualReturn = returnForRisk(params.riskTolerance ?? "moderate", a) / 100;
  const inflation = a.inflationRate / 100;
  const salaryGrowth = a.salaryGrowthRate / 100;

  const series: YearProjectionPoint[] = [];
  let portfolio = Math.max(0, params.currentNetWorth);
  let annualSave = Math.max(0, params.annualSavings);
  const startYear = new Date().getFullYear();
  const years = Math.max(1, a.retirementAge - params.currentAge);

  for (let i = 0; i <= years; i++) {
    const age = params.currentAge + i;
    const real = portfolio / Math.pow(1 + inflation, i);
    series.push({
      age,
      year: startYear + i,
      portfolio: Math.round(portfolio),
      contributions: Math.round(annualSave),
      realPortfolio: Math.round(real),
    });
    if (i < years) {
      portfolio = portfolio * (1 + annualReturn) + annualSave;
      annualSave *= 1 + salaryGrowth;
    }
  }

  const atRet = series[series.length - 1];
  const realAtRet = atRet?.realPortfolio ?? 0;
  const sustainableMonthlySpend = Math.round((realAtRet * 0.04) / 12);
  const target = params.targetMonthlySpendAtRetirement ?? sustainableMonthlySpend;
  const yearsOfCoverage =
    target > 0 ? realAtRet / (target * 12) : a.lifeExpectancy - a.retirementAge;

  return {
    series,
    retirement: {
      retirementAge: a.retirementAge,
      portfolioAtRetirement: atRet?.portfolio ?? 0,
      realPortfolioAtRetirement: realAtRet,
      yearsOfCoverage: Math.round(yearsOfCoverage * 10) / 10,
      sustainableMonthlySpend,
      shortfall: sustainableMonthlySpend < target * 0.9,
    },
    annualReturnUsed: annualReturn * 100,
  };
}
