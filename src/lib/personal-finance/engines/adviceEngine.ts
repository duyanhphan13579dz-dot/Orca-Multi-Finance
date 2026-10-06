import type { Insight, MonthlySnapshot, SixPartAdvice } from "../types";

function tip(
  id: string,
  period: string,
  ruleCode: string,
  priority: number,
  severity: Insight["severity"],
  title: string,
  content: SixPartAdvice,
): Insight {
  return {
    id,
    period,
    ruleCode,
    priorityOrder: priority,
    severity,
    title,
    content,
    status: "new",
  };
}

export function generateQuantitativeAdvice(params: {
  snapshot: MonthlySnapshot;
}): Insight[] {
  const s = params.snapshot;
  const m = s.metrics;
  const period = s.period;
  const out: Insight[] = [];

  if (m.savingsRate < 10) {
    const gap = Math.round(m.totalNetIncome * 0.1 - m.monthlySavings);
    out.push(
      tip(`${period}-save-low`, period, "SAVINGS_RATE_LOW", 1, "warning", "Tỷ lệ tiết kiệm dưới 10%", {
        finding: `Tiết kiệm ${m.savingsRate.toFixed(1)}% thu net (${m.monthlySavings.toLocaleString("vi-VN")} ₫).`,
        impact: "Khó tích lũy quỹ KH cấp và mục tiêu trung hạn.",
        action: "Cắt chi biến đổi (ăn uống, giải trí) hoặc tăng thu phụ.",
        amount: Math.max(0, gap),
        deadline: "30 ngày",
        assumptionsAndConfidence: "Mục tiêu tối thiểu 10% net · độ tin cậy cao",
      }),
    );
  }

  if (m.emergencyFundMonths < 3) {
    const need = Math.round(
      Math.max(0, (3 - m.emergencyFundMonths) * (m.fixedExpenses || m.totalExpenses * 0.7)),
    );
    out.push(
      tip(
        `${period}-ef-thin`,
        period,
        "EMERGENCY_FUND_THIN",
        1,
        "critical",
        "Quỹ khẩn cấp dưới 3 tháng",
        {
          finding: `Liquid assets đủ ~${m.emergencyFundMonths.toFixed(1)} tháng chi thiết yếu.`,
          impact: "Rủi ro phải vay khi mất việc / sự cố.",
          action: "Ưu tiên gửi tiết kiệm thanh khoản đến đủ 3–6 tháng.",
          amount: need,
          deadline: "3–6 tháng",
          assumptionsAndConfidence: "Chi thiết yếu ≈ chi cố định · độ tin cậy cao",
        },
      ),
    );
  }

  if (m.debtToIncomeRatio > 30) {
    out.push(
      tip(`${period}-dti-high`, period, "DTI_HIGH", 2, "warning", "DTI vượt 30%", {
        finding: `Trả nợ tối thiểu ≈ ${m.debtToIncomeRatio.toFixed(1)}% thu net.`,
        impact: "Hạn chế khả năng tiết kiệm và chịu shock lãi suất.",
        action: "Avalanche: trả thêm vào khoản lãi cao nhất trước.",
        amount: 0,
        deadline: "Hàng tháng",
        assumptionsAndConfidence: "DTI trên min payment · độ tin cậy trung bình",
      }),
    );
  }

  if (m.fixedCostRatio > 65) {
    out.push(
      tip(`${period}-fixed-high`, period, "FIXED_COST_HIGH", 3, "info", "Chi cố định cao", {
        finding: `Fixed cost ${m.fixedCostRatio.toFixed(1)}% thu net.`,
        impact: "Ít dư địa cho biến đổi và tiết kiệm.",
        action: "Rà soát thuê nhà, trả góp, gói viễn thông.",
        amount: 0,
        deadline: "60 ngày",
        assumptionsAndConfidence: "Ngưỡng cảnh báo 65% · độ tin cậy trung bình",
      }),
    );
  }

  const highInterest = s.debts.filter((d) => d.interestRate >= 18);
  if (highInterest.length > 0) {
    const total = highInterest.reduce((a, d) => a + d.balance, 0);
    out.push(
      tip(
        `${period}-hi-debt`,
        period,
        "HIGH_INTEREST_DEBT",
        1,
        "critical",
        "Nợ lãi cao (≥18%/năm)",
        {
          finding: `${highInterest.length} khoản, tổng ~${total.toLocaleString("vi-VN")} ₫.`,
          impact: "Chi phí lãi ăn mòn thu nhập nhanh.",
          action: "Ưu tiên tất toán / đàm phán / balance transfer nếu có.",
          amount: total,
          deadline: "90 ngày",
          assumptionsAndConfidence: "Ngưỡng 18% · độ tin cậy cao",
        },
      ),
    );
  }

  if (m.healthScore.total >= 70 && out.filter((x) => x.severity === "critical").length === 0) {
    out.push(
      tip(`${period}-healthy`, period, "HEALTH_OK", 5, "positive", "Sức khỏe tài chính ổn định", {
        finding: `Health score ${m.healthScore.total} (${m.healthScore.ratingText}).`,
        impact: "Có thể phân bổ thêm cho mục tiêu dài hạn / đầu tư.",
        action: "Giữ nhịp check-in tháng và tăng đóng góp mục tiêu.",
        amount: Math.max(0, Math.round(m.monthlySavings * 0.2)),
        deadline: "Liên tục",
        assumptionsAndConfidence: "Dựa trên snapshot hiện tại · độ tin cậy trung bình",
      }),
    );
  }

  if (out.length === 0) {
    out.push(
      tip(`${period}-neutral`, period, "NEUTRAL", 5, "info", "Tiếp tục theo dõi", {
        finding: "Không có cảnh báo mạnh trên các ngưỡng chính.",
        impact: "—",
        action: "Duy trì check-in và cập nhật mục tiêu trong Planning.",
        amount: 0,
        deadline: "Tháng sau",
        assumptionsAndConfidence: "Rule-based · độ tin cậy trung bình",
      }),
    );
  }

  return out.sort((a, b) => a.priorityOrder - b.priorityOrder);
}
