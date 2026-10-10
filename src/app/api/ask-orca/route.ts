import { ok, badRequest } from "@/lib/envelope";
import { llmChat, llmConfigured } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

interface SnapshotFacts {
  period?: string;
  netIncome?: number;
  grossIncome?: number;
  totalExpenses?: number;
  fixedExpenses?: number;
  variableExpenses?: number;
  monthlySavings?: number;
  savingsRate?: number;
  fixedCostRatio?: number;
  emergencyFundMonths?: number;
  totalDebt?: number;
  netWorth?: number;
  healthScore?: number;
  healthRating?: string;
  debtsList?: Array<{ name?: string; category?: string; balance?: number; interestRate?: number; minMonthlyPayment?: number }>;
  expensesList?: Array<{ name?: string; category?: string; amount?: number; isFixed?: boolean }>;
  goalsList?: Array<{ name?: string; targetAmount?: number; accumulatedAmount?: number; deadline?: string; status?: string }>;
}

function formatVnd(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "0 ₫";
  return `${Math.round(n).toLocaleString("vi-VN")} ₫`;
}

/** Fallback sinh câu trả lời cục bộ thông minh theo dữ liệu thật khi LLM chưa sẵn sàng */
function generateDeterministicAnswer(q: string, facts?: SnapshotFacts): string {
  const query = q.toLowerCase();
  const net = facts?.netIncome ?? 0;
  const exp = facts?.totalExpenses ?? 0;
  const fixed = facts?.fixedExpenses ?? 0;
  const savings = facts?.monthlySavings ?? 0;
  const emergencyMonths = facts?.emergencyFundMonths ?? 0;
  const debts = facts?.debtsList ?? [];
  const goals = facts?.goalsList ?? [];

  if (query.includes("nợ") || query.includes("trả nợ") || query.includes("vay")) {
    if (debts.length === 0 || (facts?.totalDebt ?? 0) <= 0) {
      return `Bé Orca thấy cậu hiện không có khoản nợ nào nè! 🐳 Thật tuyệt vời, cậu đang ở vị thế tài chính rất tự do. Hãy tập trung xây dựng quỹ khẩn cấp 3–6 tháng và tích lũy đầu tư nhé! ✨`;
    }
    const debtDetails = debts
      .map((d) => `• ${d.name || "Khoản nợ"}: Dư nợ ${formatVnd(d.balance)}, lãi suất ${(d.interestRate ?? 0)}%/năm`)
      .join("\n");
    return `Bé Orca đã kiểm tra danh sách nợ của cậu nè: 🐳\n${debtDetails}\n\n💡 Lời khuyên của Bé Orca:\n1. Phương pháp Tuyết lăn (Snowball): Trả dứt điểm khoản nợ nhỏ nhất trước để giải tỏa tâm lý.\n2. Phương pháp Lở tuyết (Avalanche): Tập trung trả thêm cho khoản có lãi suất cao nhất để tiết kiệm tiền lãi nhiều nhất.\nCậu hãy duy trì trả tối thiểu cho các khoản còn lại để không bị phạt nhé! 💪`;
  }

  if (query.includes("tiết kiệm") || query.includes("quỹ khẩn cấp") || query.includes("dự phòng")) {
    return `Bé Orca xem sổ tài chính của cậu thấy: 🐳\n• Quỹ dự phòng hiện tại: Đủ trang trải khoảng ${emergencyMonths.toFixed(1)} tháng chi tiêu thiết yếu.\n• Mức tích lũy mỗi tháng: ${formatVnd(savings)} (Tỷ lệ tiết kiệm ${(facts?.savingsRate ?? 0).toFixed(0)}% thu nhập).\n\n🎯 Khuyến nghị của Bé Orca: Chuẩn an toàn cho người trẻ Việt Nam là 3 đến 6 tháng chi tiêu (khoảng ${formatVnd(exp * 3)} – ${formatVnd(exp * 6)}). Cậu hãy trích ngay 20% lương vào tài khoản riêng ngày nhận lương nhé! 🐷💖`;
  }

  if (query.includes("mục tiêu") || query.includes("mua nhà") || query.includes("mua xe") || query.includes("cưới")) {
    if (goals.length === 0) {
      return `Hiện tại cậu chưa ghi mục tiêu nào trong sổ tài chính nè! 🐳 Hãy tạo một mục tiêu cụ thể (như Mua laptop, Quỹ du lịch, Đám cưới...) để Bé Orca cùng cậu theo dõi tiến độ tích lũy nha! 🚀`;
    }
    const goalSummary = goals
      .map((g) => {
        const pct = g.targetAmount ? Math.min(100, Math.round(((g.accumulatedAmount ?? 0) / g.targetAmount) * 100)) : 0;
        return `• ${g.name}: Đã tích lũy ${formatVnd(g.accumulatedAmount)} / ${formatVnd(g.targetAmount)} (${pct}%)`;
      })
      .join("\n");
    return `Bé Orca tổng hợp các mục tiêu cậu đang ấp ủ nè: 🐳✨\n${goalSummary}\n\nCậu đang đi đúng hướng đó! Cứ kiên trì trích quỹ đều đặn mỗi tháng là sẽ sớm về đích thôi nhen! 💖`;
  }

  // Câu trả lời tổng quan mặc định
  return `Chào cậu nhen! Bé Orca đã xem qua sổ tài chính kỳ ${facts?.period || "hiện tại"} của cậu: 🐳✨

📊 1. HIỆN TRẠNG TÀI CHÍNH:
• Thu nhập thực nhận: ${formatVnd(net)}/tháng.
• Tổng chi tiêu: ${formatVnd(exp)} (Chi cố định đang chiếm ${(facts?.fixedCostRatio ?? 0).toFixed(0)}% lương).
• Đệm an toàn: ${emergencyMonths.toFixed(1)} tháng chi tiêu.
• Điểm sức khỏe tài chính: ${facts?.healthScore ?? 75}/100 (${facts?.healthRating || "Khá"}).

💡 2. PHÂN BỔ 50/30/20 THAM KHẢO:
• 🏠 Thiết yếu (50%): ${formatVnd(Math.round(net * 0.5))} (Cậu đang chi ${formatVnd(fixed)}, ${fixed > net * 0.5 ? "hơi cao, nên rà soát lại" : "rất hợp lý"}).
• ☕ Chi tiêu linh hoạt (30%): ${formatVnd(Math.round(net * 0.3))} cho học tập, gặp gỡ bạn bè và tận hưởng cuộc sống.
• 🐷 Tích lũy & Đầu tư (20%): ${formatVnd(Math.round(net * 0.2))} gia cố quỹ khẩn cấp và sinh lời.

Cậu muốn Bé Orca tư vấn chi tiết hơn về phần nào nè? Cứ hỏi bé nha! 🐳💖`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return badRequest("Body JSON không hợp lệ");
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return badRequest("Thiếu câu hỏi");
    }

    const facts = (body.snapshotFacts as SnapshotFacts) || {};
    const history = Array.isArray(body.conversationHistory)
      ? body.conversationHistory.filter(
          (m: unknown) =>
            m &&
            typeof m === "object" &&
            typeof (m as { text?: unknown }).text === "string" &&
            ((m as { sender?: unknown }).sender === "user" || (m as { sender?: unknown }).sender === "orca"),
        )
      : [];

    // Nếu có LLM cấu hình, gọi LLM gateway
    if (llmConfigured()) {
      try {
        const factsPrompt = `
BỐI CẢNH SỔ TÀI CHÍNH CÁ NHÂN CỦA NGƯỜI DÙNG:
- Kỳ ghi chép: ${facts.period || "Hiện tại"}
- Thu nhập thực nhận (Net): ${formatVnd(facts.netIncome)}/tháng (Tổng Gross: ${formatVnd(facts.grossIncome)})
- Tổng chi tiêu: ${formatVnd(facts.totalExpenses)}/tháng (Chi cố định: ${formatVnd(facts.fixedExpenses)}, Chi linh hoạt: ${formatVnd(facts.variableExpenses)})
- Tỷ lệ chi cố định: ${(facts.fixedCostRatio ?? 0).toFixed(1)}% thu nhập
- Tiết kiệm hàng tháng: ${formatVnd(facts.monthlySavings)} (Tỷ lệ tiết kiệm: ${(facts.savingsRate ?? 0).toFixed(1)}%)
- Quỹ khẩn cấp: Đủ trang trải ${(facts.emergencyFundMonths ?? 0).toFixed(1)} tháng chi tiêu
- Tổng nợ: ${formatVnd(facts.totalDebt)}
- Tài sản ròng (Net Worth): ${formatVnd(facts.netWorth)}
- Điểm sức khỏe tài chính: ${facts.healthScore ?? 75}/100 (${facts.healthRating || "Khá"})
${facts.debtsList && facts.debtsList.length > 0 ? `- Các khoản nợ: ${JSON.stringify(facts.debtsList)}` : "- Không có khoản nợ nào"}
${facts.goalsList && facts.goalsList.length > 0 ? `- Các mục tiêu: ${JSON.stringify(facts.goalsList)}` : "- Chưa tạo mục tiêu cụ thể"}
`;

        const systemPrompt = `Bạn là "Bé Orca 🐳" — Trợ lý AI tài chính cá nhân thông minh, tâm lý và đáng yêu của ứng dụng ORCA Personal Finance.
Tính cách của bạn:
- Xưng hô thân thiện, dễ thương: xưng là "Bé Orca" hoặc "Bé", gọi người dùng là "cậu" hoặc "bạn". Thường dùng icon 🐳, ✨, 💖, 💪.
- Chuyên môn tài chính vững vàng, thực tế cho người trẻ và gia đình Việt Nam (quy tắc 50/30/20, quỹ khẩn cấp 3-6 tháng, phương pháp trả nợ Snowball/Avalanche, bảo hiểm xã hội, thuế TNCN).
- Tuyệt đối TRUNG THỰC VỚI SỐ LIỆU: Chỉ sử dụng các con số từ BỐI CẢNH SỔ TÀI CHÍNH được cung cấp dưới đây, không bịa ra con số thu nhập hay số nợ lạ.
- Đưa ra lời khuyên hành động cụ thể, dễ làm, không nói đạo lý suông.
- Trả lời bằng tiếng Việt chuẩn mực, mạch lạc, có bullet points rõ ràng.

${factsPrompt}`;

        const chatHistory = history.map((h: { sender: string; text: string }) => ({
          role: (h.sender === "user" ? "user" : "assistant") as "user" | "assistant",
          content: h.text,
        }));

        const llmResult = await llmChat("reasoning", {
          system: systemPrompt,
          user: question,
          history: chatHistory,
          temperature: 0.6,
          maxTokens: 1000,
          timeoutMs: 12_000,
        });

        if (llmResult?.text && llmResult.text.trim().length > 10) {
          return ok({ answer: llmResult.text.trim() });
        }
      } catch (llmErr) {
        console.warn("[Ask Orca API] LLM thất bại, chuyển sang fallback phân tích cục bộ:", llmErr);
      }
    }

    // Fallback thông minh cục bộ
    const fallbackAnswer = generateDeterministicAnswer(question, facts);
    return ok({ answer: fallbackAnswer });
  } catch (err) {
    console.error("[Ask Orca API Error]:", err);
    return ok({
      answer: "Chào cậu nhen! Bé Orca đang bơi một vòng để tổng hợp dữ liệu, cậu kiểm tra lại kết nối và hỏi lại bé nha! 🐳✨",
    });
  }
}
