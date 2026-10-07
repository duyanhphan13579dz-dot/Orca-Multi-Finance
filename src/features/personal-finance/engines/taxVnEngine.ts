/**
 * Engine Tax-VN: Tính bảo hiểm bắt buộc, giảm trừ gia cảnh và thuế TNCN lũy tiến.
 * Cấu hình phiên bản: tax_params/2026
 *
 * Căn cứ pháp lý chính thức:
 * 1. Bảo hiểm bắt buộc: Luật BHXH, Luật BHYT, Luật Việc làm.
 *    - Tỷ lệ người lao động: BHXH 8%, BHYT 1.5%, BHTN 1% = Tổng 10.5%.
 *    - Mức trần đóng BHXH & BHYT: 20 lần mức lương cơ sở (2.340.000 ₫/tháng theo NĐ 73/2024/NĐ-CP) = 46.800.000 ₫/tháng.
 *    - Mức trần đóng BHTN: 20 lần mức lương tối thiểu vùng I (4.960.000 ₫/tháng theo NĐ 74/2024/NĐ-CP) = 99.200.000 ₫/tháng.
 * 2. Thuế Thu nhập Cá nhân (Dự thảo Luật Thuế TNCN sửa đổi áp dụng 2026):
 *    - Mức giảm trừ gia cảnh bản thân: 15.500.000 ₫/tháng (186 triệu ₫/năm).
 *    - Mức giảm trừ người phụ thuộc: 6.200.000 ₫/người/tháng (74,4 triệu ₫/năm).
 *    - Biểu thuế lũy tiến từng phần 5 bậc:
 *      + Bậc 1: Đến 10 triệu ₫: 5%
 *      + Bậc 2: Trên 10 triệu đến 30 triệu ₫: 10%
 *      + Bậc 3: Trên 30 triệu đến 60 triệu ₫: 20%
 *      + Bậc 4: Trên 60 triệu đến 100 triệu ₫: 30%
 *      + Bậc 5: Trên 100 triệu ₫: 35%
 */

export interface TaxVnConfig {
  version: string;
  effectiveDate: string;
  legalSources: {
    insurance: string;
    taxAllowances: string;
    taxBrackets: string;
  };
  insuranceRates: {
    bhxh: number; // 0.08
    bhyt: number; // 0.015
    bhtn: number; // 0.01
    total: number; // 0.105
  };
  caps: {
    baseSalary: number; // 2,340,000
    bhxhBhytCap: number; // 46,800,000
    bhtnCap: number; // 99,200,000
  };
  allowances: {
    personal: number; // 15,500,000
    dependent: number; // 6,200,000
  };
  brackets: Array<{
    bracket: number;
    min: number;
    max: number | null;
    rate: number;
  }>;
}

export const TAX_PARAMS_2026: TaxVnConfig = {
  version: 'tax_params/2026',
  effectiveDate: '01/01/2026',
  legalSources: {
    insurance: 'Nghị định 73/2024/NĐ-CP (Lương cơ sở 2,34 tr) & Nghị định 74/2024/NĐ-CP (Lương tối thiểu vùng I 4,96 tr)',
    taxAllowances: 'Dự thảo Luật Thuế TNCN (sửa đổi) trình Quốc hội: Giảm trừ bản thân 15,5 tr; Người phụ thuộc 6,2 tr/tháng',
    taxBrackets: 'Dự thảo Biểu thuế 5 bậc (Rút gọn từ 7 bậc cũ nhằm đơn giản hóa bậc thuế)',
  },
  insuranceRates: {
    bhxh: 0.08,
    bhyt: 0.015,
    bhtn: 0.01,
    total: 0.105,
  },
  caps: {
    baseSalary: 2340000,
    bhxhBhytCap: 46800000, // 20 * 2,340,000
    bhtnCap: 99200000, // 20 * 4,960,000
  },
  allowances: {
    personal: 15500000,
    dependent: 6200000,
  },
  brackets: [
    { bracket: 1, min: 0, max: 10000000, rate: 0.05 },
    { bracket: 2, min: 10000000, max: 30000000, rate: 0.10 },
    { bracket: 3, min: 30000000, max: 60000000, rate: 0.20 },
    { bracket: 4, min: 60000000, max: 10000000, rate: 0.30 },
    { bracket: 5, min: 10000000, max: null, rate: 0.35 },
  ],
};

export interface TaxVnResult {
  grossSalary: number;
  bonus: number;
  otherIncome: number;
  totalGrossIncome: number;
  insuranceSalaryBase: number;
  mandatoryInsurance: {
    bhxh: number;
    bhyt: number;
    bhtn: number;
    total: number;
    isCapped: boolean;
  };
  personalAllowance: number;
  dependentAllowance: number;
  totalAllowances: number;
  assessableIncome: number; // Thu nhập trước giảm trừ gia cảnh (Gross - Insurance)
  taxableIncome: number; // Thu nhập tính thuế = max(0, assessableIncome - allowances)
  bracketBreakdown: Array<{
    bracket: number;
    taxableInBracket: number;
    rate: number;
    taxAmount: number;
  }>;
  personalIncomeTax: number;
  netTakeHome: number; // Thu nhập thực nhận
  effectiveTaxRate: number; // % thuế trên tổng thu nhập
  effectiveDeductionsRate: number; // % (thuế + bảo hiểm) / tổng thu nhập
}

/**
 * Tính toán nghĩa vụ thuế và bảo hiểm bắt buộc theo chuẩn quy chuẩn Việt Nam
 */
export function calculateTaxVn(
  grossSalary: number,
  bonus: number = 0,
  otherIncome: number = 0,
  insuranceSalaryBase?: number,
  dependentsCount: number = 0,
  config: TaxVnConfig = TAX_PARAMS_2026
): TaxVnResult {
  const safeGross = Math.max(0, grossSalary);
  const safeBonus = Math.max(0, bonus);
  const safeOther = Math.max(0, otherIncome);
  const safeDependents = Math.max(0, Math.floor(dependentsCount));

  // Tiền lương đóng BHXH: nếu không nhập hoặc nhập 0, mặc định lấy lương gộp cơ bản (không tính thưởng, phụ cấp không tính BH)
  const insBase = insuranceSalaryBase && insuranceSalaryBase > 0
    ? insuranceSalaryBase
    : safeGross;

  // Áp dụng trần đóng bảo hiểm
  const cappedBhxhBhytBase = Math.min(insBase, config.caps.bhxhBhytCap);
  const cappedBhtnBase = Math.min(insBase, config.caps.bhtnCap);
  const isCapped = insBase > config.caps.bhxhBhytCap;

  const bhxh = Math.round(cappedBhxhBhytBase * config.insuranceRates.bhxh);
  const bhyt = Math.round(cappedBhxhBhytBase * config.insuranceRates.bhyt);
  const bhtn = Math.round(cappedBhtnBase * config.insuranceRates.bhtn);
  const totalInsurance = bhxh + bhyt + bhtn;

  const totalGrossIncome = safeGross + safeBonus + safeOther;

  // Thu nhập chịu thuế = Tổng thu nhập - Các khoản đóng bảo hiểm bắt buộc
  // (Lưu ý: Thưởng và thu nhập khác chịu thuế TNCN nhưng thường không đóng BHXH)
  const assessableIncome = Math.max(0, totalGrossIncome - totalInsurance);

  // Giảm trừ gia cảnh
  const personalAllowance = config.allowances.personal;
  const dependentAllowance = safeDependents * config.allowances.dependent;
  const totalAllowances = personalAllowance + dependentAllowance;

  // Thu nhập tính thuế = Thu nhập chịu thuế - Các khoản giảm trừ
  const taxableIncome = Math.max(0, assessableIncome - totalAllowances);

  // Tính thuế TNCN theo từng bậc lũy tiến 5 bậc
  let remainingTaxable = taxableIncome;
  let totalPit = 0;
  const bracketBreakdown: TaxVnResult['bracketBreakdown'] = [];

  for (const b of config.brackets) {
    if (remainingTaxable <= 0) {
      bracketBreakdown.push({
        bracket: b.bracket,
        taxableInBracket: 0,
        rate: b.rate,
        taxAmount: 0,
      });
      continue;
    }

    const bracketWidth = b.max !== null ? (b.max - b.min) : Infinity;
    const amountInBracket = Math.min(remainingTaxable, bracketWidth);
    const taxInBracket = Math.round(amountInBracket * b.rate);

    totalPit += taxInBracket;
    remainingTaxable -= amountInBracket;

    bracketBreakdown.push({
      bracket: b.bracket,
      taxableInBracket: amountInBracket,
      rate: b.rate,
      taxAmount: taxInBracket,
    });
  }

  // Thu nhập thực nhận = Tổng Gross - Bảo hiểm - Thuế TNCN
  const netTakeHome = Math.max(0, totalGrossIncome - totalInsurance - totalPit);

  const effectiveTaxRate = totalGrossIncome > 0
    ? Number(((totalPit / totalGrossIncome) * 100).toFixed(2))
    : 0;
  const effectiveDeductionsRate = totalGrossIncome > 0
    ? Number((((totalInsurance + totalPit) / totalGrossIncome) * 100).toFixed(2))
    : 0;

  return {
    grossSalary: safeGross,
    bonus: safeBonus,
    otherIncome: safeOther,
    totalGrossIncome,
    insuranceSalaryBase: insBase,
    mandatoryInsurance: {
      bhxh,
      bhyt,
      bhtn,
      total: totalInsurance,
      isCapped,
    },
    personalAllowance,
    dependentAllowance,
    totalAllowances,
    assessableIncome,
    taxableIncome,
    bracketBreakdown,
    personalIncomeTax: totalPit,
    netTakeHome,
    effectiveTaxRate,
    effectiveDeductionsRate,
  };
}
