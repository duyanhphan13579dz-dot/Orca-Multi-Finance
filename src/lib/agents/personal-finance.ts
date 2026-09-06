import "server-only";
import { executeTool } from "./tools";
import { numVn, type AgentContext, type AgentRun, type AgentSection } from "./agent-types";
import type { FinancialProfile } from "../finance/financial-profile";
import { parseBudgetQuestion } from "../finance/budget-parser";

/**
 * BUDGET PLANNER — trả lời câu hỏi ngân sách ad-hoc ("500k tiêu 2 tuần"),
 * không cần profile, KHÔNG lưu gì vào memory (không consent trong luồng này).
 * Số từ câu hỏi = FACT; phép chia = DATA-DRIVEN; gợi ý 50/20/30 =
 * MODEL-INFERENCE kèm disclaimer.
 */
export function looksLikeBudgetQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const hasMoney = /(\d[\d.,]*\s*(k|nghìn|ngàn|tr|triệu|tỷ|tỉ|vnd|đ))/i.test(q);
  const spending = /(ngân sách|budget|tiêu trong|phân chia|chia như|phân bổ chi phí|chi phí (sinh hoạt|ăn|sống|hàng)|sinh hoạt|tiền ăn|xăng|ăn quán|ăn tiêu|đổ xăng|đủ tiêu|đủ tiền|đủ sống|sống đến|sống\b|chi tiêu|tiêu\b)/i.test(q);
  const period = /(cuối|hết|cả|này|nay)\s*(tuần|tháng)|(trong|mỗi)\s*\d*\s*(tuần|tháng|ngày)|tuần (này|tới|sau)|tháng (này|tới|sau)/i.test(q);
  return hasMoney && (spending || period);
}

export async function runBudgetPlanner(question: string): Promise<AgentRun> {
  const parsed = parseBudgetQuestion(question);
  const sections: AgentSection[] = [];
  const unavailable: string[] = [];
  const trace = ["personal-finance", "budget-parser"];

  if (parsed.totalAmount == null) {
    return {
      agent: "personal-finance",
      sections: [{
        id: "budget-unavailable",
        title: "Chưa đọc được ngân sách",
        label: "FACT",
        body: "Hệ thống chưa trích được tổng ngân sách từ câu hỏi (cần dạng như “500k”, “1,5 triệu”). Vui lòng nêu rõ số tiền và thời gian (VD: 500k trong 2 tuần, mỗi tuần xăng 50k).",
        data: null,
        sources: [],
        unavailable: true,
      }],
      narrative: "Chưa trích được ngân sách từ câu hỏi — cần số tiền và thời gian rõ ràng.",
      symbols: [],
      sources: [],
      freshness: "UNAVAILABLE",
      confidence: null,
      unavailable: ["budget-parse"],
      trace,
    };
  }

  const weeks = parsed.weeks ?? 1;
  const tool = await executeTool("budget_plan", {
    totalAmount: parsed.totalAmount,
    weeks,
    fixedExpenses: parsed.fixedExpenses,
  });
  if (!tool.ok) {
    return {
      agent: "personal-finance",
      sections: [{
        id: "budget-unavailable",
        title: "Không lập được kế hoạch",
        label: "FACT",
        body: `Chưa tính được kế hoạch: ${tool.message ?? "dữ liệu không đủ"}.`,
        data: null,
        sources: [],
        unavailable: true,
      }],
      narrative: "Không lập được kế hoạch ngân sách.",
      symbols: [],
      sources: [],
      freshness: "UNAVAILABLE",
      confidence: null,
      unavailable: ["budget-tool"],
      trace,
    };
  }

  const plan = tool.data as {
    totalAmount: number;
    weeks: number;
    weeklyBudget: number;
    fixedWeekly: number;
    fixedBreakdown: { label: string; weekly: number }[];
    discretionaryWeekly: number;
    deficit: number | null;
    suggestedSplit: { bucket: string; pct: number; weekly: number }[];
    note: string;
  };

  // FACT — ngân sách user nhập (kỳ "cuối tháng" hiển thị ≈ 1 tháng)
  const weeksLabel = plan.weeks >= 4 && plan.weeks <= 4.6 ? "≈ 1 tháng (4,3 tuần)" : `${plan.weeks} tuần`;
  sections.push({
    id: "budget-input",
    title: "Ngân sách bạn đưa ra",
    label: "FACT",
    body: `Tổng ${numVn(plan.totalAmount)} cho ${weeksLabel} → ngân sách trung bình ${numVn(plan.weeklyBudget)}/tuần.`,
    data: { totalAmount: plan.totalAmount, weeks: plan.weeks, weeklyBudget: plan.weeklyBudget },
    sources: ["user-question"],
  });

  // DATA-DRIVEN — chi phí cố định + phần còn lại
  const fixedLines = plan.fixedBreakdown.length
    ? plan.fixedBreakdown.map((f) => `${f.label} ${numVn(f.weekly)}/tuần`).join(" · ")
    : "không có khoản cố định được trích";
  sections.push({
    id: "budget-fixed",
    title: "Chi phí cố định mỗi tuần",
    label: "DATA-DRIVEN",
    body: `${fixedLines}. Tổng cố định ${numVn(plan.fixedWeekly)}/tuần → còn lại ${numVn(plan.discretionaryWeekly)}/tuần cho chi tiêu linh hoạt.`,
    data: { fixedWeekly: plan.fixedWeekly, discretionaryWeekly: plan.discretionaryWeekly },
    sources: ["budget-engine"],
  });

  // DATA-DRIVEN — cảnh báo thiếu hụt (nếu có)
  if (plan.deficit != null) {
    sections.push({
      id: "budget-deficit",
      title: "Cảnh báo thiếu hụt",
      label: "DATA-DRIVEN",
      body: `Chi phí cố định ${numVn(plan.fixedWeekly)}/tuần vượt ngân sách ${numVn(plan.weeklyBudget)}/tuần — thiếu ${numVn(plan.deficit)}/tuần. Cần giảm khoản cố định hoặc tăng ngân sách; hệ thống không tự ý “bù” bằng cách giảm ăn uống/xăng vì đó là quyết định của bạn.`,
      data: { deficit: plan.deficit },
      sources: ["budget-engine"],
    });
  } else {
    sections.push({
      id: "budget-split",
      title: "Gợi ý phân bổ phần còn lại",
      label: "MODEL-INFERENCE",
      body: plan.suggestedSplit.map((b) => `${b.bucket}: ${b.pct}% (${numVn(b.weekly)}/tuần)`).join(" · ") + `.\n${plan.note}`,
      data: plan.suggestedSplit,
      sources: ["budget-rule-50-20-30"],
    });
  }

  // OPINION — lời khuyên thực tế có điều kiện (không số liệu mới)
  sections.push({
    id: "budget-tips",
    title: `Cách theo dõi trong ${plan.weeks >= 4 && plan.weeks <= 4.6 ? "kỳ này" : plan.weeks + " tuần"}`,
    label: "OPINION",
    body: "Chia tiền mặt theo từng tuần ngay đầu tuần (một phong bì/túi riêng cho linh hoạt) để không lố; ghi lại mỗi khoản chi cuối ngày; nếu tuần đầu hụt, ưu tiên cắt phần tự do 30% trước, sau đó mới điều chỉnh ăn uống — đừng cắt xăng vì đó là chi phí đi lại cố định. Nếu tuần đầu còn dư, chuyển phần dư sang tuần sau thay vì tiêu hết.",
    data: null,
    sources: ["personal-finance-rules"],
  });

  return {
    agent: "personal-finance",
    sections,
    narrative: sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n"),
    symbols: [],
    sources: ["budget-engine", "personal-finance-rules"],
    freshness: "FRESH",
    confidence: null,
    unavailable,
    trace,
  };
}

/**
 * PERSONAL FINANCE AGENT — từ FinancialProfile + Health Engine:
 * hồ sơ → sức khỏe tài chính (5 metric) → điểm yếu → action plan ưu tiên →
 * cảnh báo. Không có profile → DATA_UNAVAILABLE (cần consent trước).
 */

export function healthPlan(profile: FinancialProfile): { action: string; reason: string; priority: "HIGH" | "MEDIUM" | "LOW" }[] {
  const m = profile.derive.health.metrics;
  const plans: { action: string; reason: string; priority: "HIGH" | "MEDIUM" | "LOW" }[] = [];

  if (m.emergencyFund.status === "POOR") {
    plans.push({
      action: `Ưu tiên xây quỹ khẩn cấp lên ≥ ${profile.inputs.emergencyTargetMonths ?? 6} tháng chi tiêu (hiện ${m.emergencyFund.value?.toFixed(1) ?? "—"} tháng).`,
      reason: "Quỹ khẩn cấp là tấm đệm đầu tiên; thiếu sẽ buộc bán tài sản đầu tư khi có biến cố.",
      priority: "HIGH",
    });
  } else if (m.emergencyFund.status === "WATCH") {
    plans.push({
      action: `Tăng quỹ khẩn cấp từ ${m.emergencyFund.value?.toFixed(1) ?? "—"} lên ${profile.inputs.emergencyTargetMonths ?? 6} tháng.`,
      reason: "Độ phủ hiện tại dưới ngưỡng an toàn — ưu tiên sau các việc cấp thiết.",
      priority: "MEDIUM",
    });
  }

  if (m.debtToIncome.status === "POOR" || m.debtToIncome.status === "WATCH") {
    const dti = m.debtToIncome.value;
    plans.push({
      action: `Giảm tỷ lệ trả nợ/thu nhập (hiện ${dti != null ? (dti * 100).toFixed(0) : "—"}%) về ≤ 20% bằng cách tất toán nợ lãi cao trước.`,
      reason: m.debtToIncome.status === "POOR" ? "DTI > 36% làm giảm đáng kể khả năng xử lý biến cố và khó vay khi cần." : "DTI trong vùng theo dõi — không để tăng thêm nợ mới.",
      priority: m.debtToIncome.status === "POOR" ? "HIGH" : "MEDIUM",
    });
  }

  if (m.savingsRate.status === "POOR" || m.savingsRate.status === "WATCH") {
    const sr = m.savingsRate.value;
    plans.push({
      action: `Đặt mục tiêu tiết kiệm ≥ 30% thu nhập (hiện ${sr != null ? (sr * 100).toFixed(0) : "—"}%) bằng cách chốt budget chi tiêu cố định.`,
      reason: m.savingsRate.status === "POOR" ? "Dòng tiền tự do quá mỏng — mọi kế hoạch dài hạn sẽ khó thực thi." : "Tỷ lệ tiết kiệm dưới ngưỡng khuyến nghị.",
      priority: m.savingsRate.status === "POOR" ? "HIGH" : "MEDIUM",
    });
  }

  if (m.leverage.status === "WATCH" || m.leverage.status === "POOR") {
    const lev = m.leverage.value;
    plans.push({
      action: `Giảm đòn bẩy (nợ/tài sản hiện ${lev != null ? (lev * 100).toFixed(0) : "—"}%) — tất toán nợ trước khi tăng thêm tài sản rủi ro.`,
      reason: "Đòn bẩy cao khiến giá trị ròng nhạy cảm với biến động tài sản.",
      priority: m.leverage.status === "POOR" ? "HIGH" : "MEDIUM",
    });
  }

  if (m.liquidity.status === "WATCH" || m.liquidity.status === "POOR") {
    const liq = m.liquidity.value;
    plans.push({
      action: `Cân nhắc giữ tài sản thanh khoản ≥ 30% tổng tài sản (hiện ${liq != null ? (liq * 100).toFixed(0) : "—"}%).`,
      reason: "Thanh khoản thấp làm tăng rủi ro phải bán tài sản ở giá xấu.",
      priority: "MEDIUM",
    });
  }

  if (!plans.length) {
    plans.push({
      action: "Duy trì các chỉ số hiện tại (savings rate, DTI, quỹ khẩn cấp đều đạt ngưỡng).",
      reason: "Không phát hiện điểm yếu cấp thiết — chuyển trọng tâm sang tối ưu danh mục và mục tiêu dài hạn.",
      priority: "LOW",
    });
  }
  return plans.sort((a, b) => (a.priority === "HIGH" ? -1 : b.priority === "HIGH" ? 1 : 0));
}

export async function runPersonalFinance(ctx: AgentContext): Promise<AgentRun> {
  const trace = ["personal-finance"];
  const profile = ctx.profile ?? null;
  if (!profile) {
    return {
      agent: "personal-finance",
      sections: [{
        id: "unavailable",
        title: "Chưa có hồ sơ tài chính",
        label: "FACT",
        body: "Để phân tích tài chính cá nhân, cần lập Financial Profile (thu nhập, chi tiêu, nợ, tài sản, mục tiêu). Hệ thống chỉ lưu khi bạn đồng ý — KHÔNG tự đoán từ câu hỏi.",
        data: null,
        sources: [],
        unavailable: true,
      }],
      narrative: "Chưa có hồ sơ tài chính — cần bạn tạo profile (có xác nhận lưu trí nhớ).",
      symbols: [],
      sources: [],
      freshness: "UNAVAILABLE",
      confidence: null,
      unavailable: ["profile"],
      trace,
    };
  }

  const [health, cashflow, networth, savings, dti, efund, goals] = await Promise.all([
    executeTool("financial_health", {}, { profile }),
    executeTool("cash_flow", {}, { profile }),
    executeTool("net_worth", {}, { profile }),
    executeTool("savings_rate", {}, { profile }),
    executeTool("debt_to_income", {}, { profile }),
    executeTool("emergency_fund", {}, { profile }),
    executeTool("goal_progress", {}, { profile }),
  ]);

  const unavailable: string[] = [];
  const sections: AgentSection[] = [];

  const healthData = health.ok ? (health.data as { overall: number | null; level: string; metrics: Record<string, { value: number | null; score: number | null; status: string; note: string }> }) : null;
  if (!healthData) unavailable.push("financial_health");

  if (healthData) {
    const m = healthData.metrics;
    const lines = [
      `Điểm tổng ${healthData.overall ?? "—"}/100 (${healthData.level === "UNAVAILABLE" ? "chưa đủ dữ liệu" : healthData.level})`,
      m.savingsRate?.status === "UNAVAILABLE" ? "Tỷ lệ tiết kiệm: chưa đủ dữ liệu" : `Tỷ lệ tiết kiệm: ${m.savingsRate?.value != null ? m.savingsRate.value.toFixed(0) + "%" : "—"} (${m.savingsRate?.status ?? "—"})`,
      m.debtToIncome?.status === "UNAVAILABLE" ? "DTI: chưa đủ dữ liệu" : `DTI: ${m.debtToIncome?.value != null ? m.debtToIncome.value.toFixed(0) + "%" : "—"} (${m.debtToIncome?.status ?? "—"})`,
      `Quỹ khẩn cấp: ${m.emergencyFund?.value != null ? m.emergencyFund.value.toFixed(1) + " tháng" : "—"} (${m.emergencyFund?.status ?? "—"})`,
      m.liquidity?.status === "UNAVAILABLE" ? "Thanh khoản: chưa đủ dữ liệu" : `Thanh khoản: ${m.liquidity?.value != null ? m.liquidity.value.toFixed(0) + "%" : "—"} (${m.liquidity?.status ?? "—"})`,
      m.leverage?.status === "UNAVAILABLE" ? "Đòn bẩy: chưa đủ dữ liệu" : `Đòn bẩy: ${m.leverage?.value != null ? m.leverage.value.toFixed(0) + "%" : "—"} (${m.leverage?.status ?? "—"})`,
    ];
    sections.push({
      id: "health",
      title: "Sức khỏe tài chính",
      label: "DATA-DRIVEN",
      body: lines.join(" · ") + ".",
      data: healthData,
      sources: ["finance-math-engine", "financial-health-engine"],
    });
  }

  if (cashflow.ok) {
    const c = cashflow.data as { income: number | null; expenses: number | null; freeCashFlow: number | null };
    sections.push({
      id: "cashflow",
      title: "Dòng tiền",
      label: "DATA-DRIVEN",
      body: `Thu nhập ${numVn(c.income)} — chi tiêu ${numVn(c.expenses)} → dòng tiền tự do ${numVn(c.freeCashFlow)}/tháng.${c.freeCashFlow != null && c.freeCashFlow < 0 ? " CẢNH BÁO: chi tiêu vượt thu nhập." : ""}`,
      data: c,
      sources: ["finance-math-engine"],
    });
  }

  if (networth.ok) {
    const n = networth.data as { totalAssets: number | null; totalLiabilities: number | null; netWorth: number | null };
    sections.push({
      id: "networth",
      title: "Giá trị ròng",
      label: "DATA-DRIVEN",
      body: `Tài sản ${numVn(n.totalAssets)} — nợ ${numVn(n.totalLiabilities)} → giá trị ròng ${numVn(n.netWorth)}.`,
      data: n,
      sources: ["finance-math-engine"],
    });
  }

  if (goals.ok) {
    const g = goals.data as { goals: { id: string; name: string; targetAmount: number; currentAmount: number | null; progressPct: number | null; onTrack: boolean | null }[] };
    const lines = g.goals.map((x) => `"${x.name}": ${x.progressPct != null ? x.progressPct.toFixed(0) + "%" : "—"} đạt mục tiêu ${numVn(x.targetAmount)}${x.onTrack != null ? (x.onTrack ? " (on track)" : " (cần điều chỉnh)") : ""}`).join("; ");
    sections.push({
      id: "goals",
      title: "Mục tiêu tài chính",
      label: "DATA-DRIVEN",
      body: lines || "Chưa có mục tiêu nào trong profile.",
      data: g,
      sources: ["finance-math-engine"],
      unavailable: !lines,
    });
  }

  const plans = healthPlan(profile);
  sections.push({
    id: "action-plan",
    title: "Kế hoạch hành động (ưu tiên)",
    label: "MODEL-INFERENCE",
    body: plans.map((p, i) => `${i + 1}. [${p.priority}] ${p.action} — ${p.reason}`).join("\n"),
    data: plans,
    sources: ["personal-finance-rules"],
  });

  const narrative = sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
  return {
    agent: "personal-finance",
    sections,
    narrative,
    symbols: [],
    sources: ["finance-math-engine", "personal-finance-rules"],
    freshness: health.ok ? (health.meta?.freshness ?? "DELAYED") : "UNAVAILABLE",
    confidence: null,
    unavailable,
    trace,
    profileUsed: true,
  };
}
