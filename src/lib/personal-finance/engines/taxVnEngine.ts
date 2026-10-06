/** Vietnam PIT skeleton — full brackets restored in W2 from Wallet. */
export interface TaxVnResult {
  personalIncomeTax: number;
  netTakeHome: number;
  mandatoryInsuranceTotal: number;
}

export function calculateTaxVn(params: {
  grossSalary: number;
  bonus?: number;
  otherIncome?: number;
  insuranceSalaryBase?: number;
  dependentsCount?: number;
}): TaxVnResult {
  const gross = Math.max(0, params.grossSalary) + Math.max(0, params.bonus ?? 0);
  const other = Math.max(0, params.otherIncome ?? 0);
  const base = params.insuranceSalaryBase ?? params.grossSalary;
  const ins = Math.min(Math.max(0, base), 46_800_000) * 0.105;
  const dependents = Math.max(0, params.dependentsCount ?? 0);
  const deduction = 11_000_000 + dependents * 4_400_000 + ins;
  const taxable = Math.max(0, gross + other - deduction);
  // Simplified progressive approx
  let tax = 0;
  let remain = taxable;
  const brackets: [number, number][] = [
    [5_000_000, 0.05],
    [5_000_000, 0.1],
    [8_000_000, 0.15],
    [14_000_000, 0.2],
    [20_000_000, 0.25],
    [32_000_000, 0.3],
    [Number.POSITIVE_INFINITY, 0.35],
  ];
  for (const [width, rate] of brackets) {
    const slice = Math.min(remain, width);
    tax += slice * rate;
    remain -= slice;
    if (remain <= 0) break;
  }
  return {
    personalIncomeTax: Math.round(tax),
    mandatoryInsuranceTotal: Math.round(ins),
    netTakeHome: Math.round(gross + other - ins - tax),
  };
}
