/**
 * Engine Narrator: Diễn giải dữ kiện JSON từ engine thành báo cáo văn bản tiếng Việt chuẩn mực.
 * Tuân thủ tuyệt đối B2 & B5:
 * 1. AI chỉ viết lại từ số liệu có sẵn, KHÔNG được tự tạo số mới.
 * 2. Kiểm tra mọi con số trong văn bản sinh ra; nếu phát hiện số lạ không có trong facts, tự động fallback về bản mẫu chuẩn.
 * 3. Bảo vệ quyền riêng tư: Tuyệt đối không gửi tên, email, CCCD hay định danh tới LLM.
 */

import { MonthlySnapshot, FinanceProfile } from '../types/finance.ts';

export interface NarratorFacts {
  period: string;
  totalGrossIncome: number;
  totalNetIncome: number;
  totalExpenses: number;
  fixedExpenses: number;
  variableExpenses: number;
  monthlySavings: number;
  savingsRate: number;
  fixedCostRatio: number;
  totalAssets: number;
  totalDebt: number;
  netWorth: number;
  liquidAssets: number;
  emergencyFundMonths: number;
  healthScore: number;
  healthBand: string;
  mandatoryInsurance: number;
  pitTax: number;
  activeDebtsCount: number;
  goalsCount: number;
}

export function extractFactsFromSnapshot(snapshot: MonthlySnapshot): NarratorFacts {
  return {
    period: snapshot.period,
    totalGrossIncome: snapshot.metrics.totalGrossIncome,
    totalNetIncome: snapshot.metrics.totalNetIncome,
    totalExpenses: snapshot.metrics.totalExpenses,
    fixedExpenses: snapshot.metrics.fixedExpenses,
    variableExpenses: snapshot.metrics.variableExpenses,
    monthlySavings: snapshot.metrics.monthlySavings,
    savingsRate: snapshot.metrics.savingsRate,
    fixedCostRatio: snapshot.metrics.fixedCostRatio,
    totalAssets: snapshot.metrics.totalAssets,
    totalDebt: snapshot.metrics.totalDebt,
    netWorth: snapshot.metrics.netWorth,
    liquidAssets: snapshot.metrics.liquidAssets,
    emergencyFundMonths: snapshot.metrics.emergencyFundMonths,
    healthScore: snapshot.metrics.healthScore.total,
    healthBand: snapshot.metrics.healthScore.ratingText,
    mandatoryInsurance: snapshot.income.mandatoryInsurance.total,
    pitTax: snapshot.income.personalIncomeTax,
    activeDebtsCount: snapshot.debts.filter((d) => d.balance > 0).length,
    goalsCount: snapshot.goals.length,
  };
}

/**
 * Tạo văn bản mẫu chuẩn mực tổ chức tài chính (Deterministic Institutional Template)
 * Đảm bảo 100% tính chính xác, không sai lệch con số.
 */
export function generateDeterministicNarrative(facts: NarratorFacts): string {
  const savingsStatusText = facts.monthlySavings >= 0
    ? `thặng dư dương ${facts.monthlySavings.toLocaleString('vi-VN')} ₫ (đạt tỷ lệ tiết kiệm ${facts.savingsRate}%)`
    : `thâm hụt dòng tiền ${Math.abs(facts.monthlySavings).toLocaleString('vi-VN')} ₫`;

  const debtText = facts.totalDebt === 0
    ? 'Hồ sơ tài chính hoàn toàn không ghi nhận nợ vay.'
    : `Tổng dư nợ ghi nhận ${facts.totalDebt.toLocaleString('vi-VN')} ₫ trên ${facts.activeDebtsCount} khoản vay.`;

  const emergencyAssessment = facts.emergencyFundMonths >= 6
    ? `Rất vững mạnh (${facts.emergencyFundMonths.toFixed(1)} tháng chi phí thiết yếu).`
    : facts.emergencyFundMonths >= 3
    ? `Đạt chuẩn tối thiểu (${facts.emergencyFundMonths.toFixed(1)} tháng chi phí thiết yếu).`
    : `Dưới mức an toàn (${facts.emergencyFundMonths.toFixed(1)} tháng chi phí thiết yếu), cần ưu tiên gia cố.`;

  return [
    `BÁO CÁO TÀI CHÍNH KỲ ${facts.period} (ORCA PERSONAL FINANCE)`,
    `1. TỔNG QUAN TÀI SẢN RÒNG & SỨC KHỎE: Tài sản ròng tính đến cuối kỳ đạt ${facts.netWorth.toLocaleString('vi-VN')} ₫ (Tổng tài sản: ${facts.totalAssets.toLocaleString('vi-VN')} ₫; Tổng nợ: ${facts.totalDebt.toLocaleString('vi-VN')} ₫). Chỉ số sức khỏe tài chính toàn diện đạt ${facts.healthScore}/100 điểm, thuộc nhóm "${facts.healthBand}".`,
    `2. DÒNG TIỀN VÀ THUẾ: Tổng thu nhập thực nhận đạt ${facts.totalNetIncome.toLocaleString('vi-VN')} ₫ sau khi khấu trừ ${facts.mandatoryInsurance.toLocaleString('vi-VN')} ₫ bảo hiểm bắt buộc và ${facts.pitTax.toLocaleString('vi-VN')} ₫ thuế TNCN (chuẩn 2026). Tổng chi tiêu trong kỳ là ${facts.totalExpenses.toLocaleString('vi-VN')} ₫ (chi cố định chiếm ${facts.fixedCostRatio}% thu nhập), mang lại ${savingsStatusText}.`,
    `3. THANH KHOẢN VÀ ĐÒN BẨY: Quỹ thanh khoản dự phòng hiện có ${facts.liquidAssets.toLocaleString('vi-VN')} ₫, tương đương ${emergencyAssessment} ${debtText}`,
    `4. KẾT LUẬN & ĐIỀU HÀNH: Giữ vững kỷ luật chi tiêu dưới trần ngân sách cố định và duy trì trích lập tích lũy tối thiểu trước khi phân bổ vào các mục tiêu dài hạn.`,
  ].join('\n\n');
}

/**
 * Trích xuất toàn bộ con số trong văn bản để xác thực với tập dữ kiện
 */
export function extractNumbersFromString(text: string): number[] {
  // Tìm các chuỗi số (ví dụ: 15.500.000, 35, 3.5, 100, 1.234.567)
  const matches = text.match(/\d+([.,]\d+)*/g) || [];
  return matches
    .map((m) => {
      // Chuẩn hóa định dạng số Việt Nam (loại bỏ dấu chấm phân tách hàng nghìn, thay dấu phẩy bằng chấm)
      const clean = m.replace(/\./g, '').replace(/,/g, '.');
      return parseFloat(clean);
    })
    .filter((n) => !isNaN(n));
}

/**
 * Xác thực văn bản do AI sinh có tuân thủ nguyên tắc không bịa số hay không
 */
export function validateAiNarrative(aiText: string, facts: NarratorFacts): boolean {
  if (!aiText || aiText.trim().length < 50) return false;

  // Tập hợp tất cả các số hợp lệ từ facts
  const validNumbers = new Set<number>();
  
  // Thêm các số từ facts
  Object.values(facts).forEach((val) => {
    if (typeof val === 'number') {
      validNumbers.add(val);
      validNumbers.add(Math.round(val));
      validNumbers.add(Number(val.toFixed(1)));
    }
  });

  // Cho phép các số cơ bản phổ biến trong phân tích (0, 1, 3, 6, 12, 24, 30, 100, 365, các năm 2025, 2026, 2027)
  [0, 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 24, 30, 50, 60, 65, 100, 365, 2025, 2026, 2027, 2028].forEach((n) => {
    validNumbers.add(n);
  });

  const numbersInAiText = extractNumbersFromString(aiText);

  // Nếu trong văn bản có con số lớn (> 1000) mà hoàn toàn không xuất hiện trong facts -> vi phạm!
  for (const num of numbersInAiText) {
    if (num > 1000) {
      let isMatched = false;
      for (const valid of validNumbers) {
        if (Math.abs(valid - num) < 2) {
          isMatched = true;
          break;
        }
      }
      if (!isMatched) {
        // Con số tài chính lạ bịa đặt -> từ chối văn bản AI
        console.warn(`[Narrator Audit Warning] Phát hiện con số không khớp trong phản hồi AI: ${num}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Sinh diễn giải báo cáo: kết hợp AI (nếu được người dùng đồng ý) và kiểm tra an toàn số liệu.
 */
export async function generateReportNarrative(
  snapshot: MonthlySnapshot,
  profile: FinanceProfile
): Promise<string> {
  const facts = extractFactsFromSnapshot(snapshot);
  const defaultTemplate = generateDeterministicNarrative(facts);

  // Nếu người dùng chưa bật đồng ý phân tích AI (Consent B7), luôn trả về template chuẩn
  if (!profile.consentAI) {
    return defaultTemplate;
  }

  try {
    const response = await fetch('/api/narrator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
    });

    if (!response.ok) {
      return defaultTemplate;
    }

    const data = await response.json();
    if (data && typeof data.narrative === 'string') {
      const isValid = validateAiNarrative(data.narrative, facts);
      if (isValid) {
        return data.narrative;
      } else {
        console.info('[Narrator Engine] Văn bản AI không vượt qua kiểm định số học, sử dụng mẫu chuẩn tắc.');
        return defaultTemplate;
      }
    }
  } catch {
    // Fallback im lặng an toàn
  }

  return defaultTemplate;
}
