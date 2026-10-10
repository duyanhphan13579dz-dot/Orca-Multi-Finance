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

/** Trích xuất số tiền triệu từ câu hỏi nếu có (VD: "20 triệu", "50tr") */
function extractAmountFromText(text: string): number | null {
  const matchTrieu = text.match(/(\d+(?:[.,]\d+)?)\s*(?:triệu|trieu|tr\b)/i);
  if (matchTrieu) {
    const val = parseFloat(matchTrieu[1].replace(",", "."));
    if (!isNaN(val) && val > 0) return Math.round(val * 1_000_000);
  }
  const matchK = text.match(/(\d+(?:[.,]\d+)?)\s*(?:k\b|nghìn|nghin)/i);
  if (matchK) {
    const val = parseFloat(matchK[1].replace(",", "."));
    if (!isNaN(val) && val > 0) return Math.round(val * 1_000);
  }
  return null;
}

/** Bộ giải đáp tài chính quy chuẩn thông minh, bám sát bộ dataset 365 mẫu và số liệu người dùng */
function generateDeterministicAnswer(q: string, facts?: SnapshotFacts): string {
  const query = q.toLowerCase();
  const net = facts?.netIncome ?? 0;
  const exp = facts?.totalExpenses ?? 0;
  const fixed = facts?.fixedExpenses ?? 0;
  const variable = facts?.variableExpenses ?? (exp - fixed > 0 ? exp - fixed : 0);
  const savings = facts?.monthlySavings ?? 0;
  const emergencyMonths = facts?.emergencyFundMonths ?? 0;
  const debts = facts?.debtsList ?? [];
  const totalDebt = facts?.totalDebt ?? debts.reduce((s, d) => s + (d.balance ?? 0), 0);
  const goals = facts?.goalsList ?? [];

  // Case 1: Chia 50/30/20
  if (query.includes("50/30/20") || query.includes("50-30-20") || query.includes("chia lương") || (query.includes("lương") && query.includes("chia"))) {
    const need = Math.round(net * 0.5);
    const want = Math.round(net * 0.3);
    const sav = Math.round(net * 0.2);
    const fixedDiff = fixed - need;

    let warningText = "";
    if (fixedDiff > 0) {
      warningText = `\n⚠️ Lưu ý: Khoản chi cố định hiện tại của cậu (${formatVnd(fixed)}) đang vượt chuẩn thiết yếu 50% khoảng ${formatVnd(fixedDiff)}. Cậu nên rà soát lại tiền thuê nhà, gói cước dịch vụ hoặc tìm cách tăng thu nhập nha!`;
    } else {
      warningText = `\n✨ Điểm sáng: Chi cố định hiện tại của cậu (${formatVnd(fixed)}) đang kiểm soát rất tốt, nằm gọn dưới mức trần 50% (${formatVnd(need)})!`;
    }

    return `Bé Orca tính bảng phân bổ 50/30/20 chi tiết đến từng đồng theo lương thực nhận của cậu nè: 🐳💖

📊 BẢNG PHÂN BỔ 50/30/20 (Lương: ${formatVnd(net)}/tháng):
• 🏠 Thiết yếu (50%): ${formatVnd(need)}
  Dành cho tiền nhà, điện nước, ăn uống cơ bản, đi lại và hóa đơn bắt buộc.${warningText}

• ☕ Chi tiêu linh hoạt (30%): ${formatVnd(want)}
  Dành cho giao lưu bạn bè, cà phê, sở thích cá nhân, mua sắm giải trí và nâng cấp bản thân.

• 🐷 Tích lũy & Đầu tư (20%): ${formatVnd(sav)}
  Trích tự động ngay ngày nhận lương: ưu tiên rót vào Quỹ khẩn cấp (nếu chưa đủ 3-6 tháng) và sau đó phân bổ đầu tư sinh lời!

Kỷ luật duy trì theo tỷ lệ này sẽ giúp cậu sống thoải mái mà tài sản vẫn tăng đều nhen! ✨`;
  }

  // Case 2: Quy tắc 6 chiếc lọ JARS
  if (query.includes("6 chiếc lọ") || query.includes("jars") || query.includes("sáu chiếc lọ")) {
    const nec = Math.round(net * 0.55);
    const ltss = Math.round(net * 0.10);
    const edu = Math.round(net * 0.10);
    const play = Math.round(net * 0.10);
    const ffa = Math.round(net * 0.10);
    const give = Math.round(net * 0.05);

    return `Bé Orca chia thu nhập ${formatVnd(net)} thành 6 chiếc lọ JARS chi tiết cho cậu nè: 🐳✨

🏺 6 CHIẾC LỌ QUẢN LÝ TÀI CHÍNH:
1. NEC - Chi tiêu thiết yếu (55%): ${formatVnd(nec)}
   (Khoản chi cố định thực tế của cậu đang là ${formatVnd(fixed)}).
2. LTSS - Tiết kiệm dài hạn (10%): ${formatVnd(ltss)}
   Dành cho mục tiêu lớn như mua xe, cưới hỏi, mua nhà hoặc sửa chữa lớn.
3. EDU - Giáo dục & Phát triển bản thân (10%): ${formatVnd(edu)}
   Dành cho mua sách, khóa học, nâng cao kỹ năng nghề nghiệp.
4. PLAY - Hưởng thụ cuộc sống (10%): ${formatVnd(play)}
   Tiêu xài tự do, du lịch ngắn ngày, tự thưởng bản thân mà không hề có cảm giác tội lỗi!
5. FFA - Tự do tài chính & Đầu tư (10%): ${formatVnd(ffa)}
   Mua chứng chỉ quỹ, cổ phiếu, vàng tích sản sinh dòng tiền thụ động.
6. GIVE - Cho đi & Giúp đỡ (5%): ${formatVnd(give)}
   Quà biếu cha mẹ, từ thiện, quà sinh nhật người thân bạn bè.

Cậu có thể mở các tài khoản phụ hoặc ví con ngân hàng để chia tiền ngay khi ting ting nhen! 💖`;
  }

  // Case 3: Thưởng / Tiền nhàn rỗi bất ngờ (Windfall)
  if (query.includes("thưởng") || query.includes("tiền nhàn rỗi") || query.includes("trúng thưởng") || query.includes("tết")) {
    const parsedAmount = extractAmountFromText(q);
    const bonus = parsedAmount || 20_000_000;
    const emAlloc = Math.round(bonus * 0.5);
    const invAlloc = Math.round(bonus * 0.3);
    const joyAlloc = Math.round(bonus * 0.2);

    let priorityNote = "";
    if (emergencyMonths < 3.0) {
      priorityNote = `• Hiện tại quỹ khẩn cấp của cậu mới có ${emergencyMonths.toFixed(1)} tháng (dưới sàn an toàn 3.0 tháng), nên phần 50% (${formatVnd(emAlloc)}) hãy ưu tiên nạp thẳng vào sổ tiết kiệm dự phòng nhé! 🛡️`;
    } else if (totalDebt > 0) {
      priorityNote = `• Cậu đang có dư nợ ${formatVnd(totalDebt)}, nên dùng phần 50% (${formatVnd(emAlloc)}) để dập bớt gốc nợ lãi suất cao, giúp giảm áp lực tiền lãi hàng tháng! 💡`;
    } else {
      priorityNote = `• Quỹ khẩn cấp đã tốt (${emergencyMonths.toFixed(1)} tháng) và sạch nợ, cậu có thể gộp phần 50% này để tăng tốc đầu tư tích sản dài hạn! 🚀`;
    }

    return `Chúc mừng cậu nhận khoản thưởng ${formatVnd(bonus)} nhen! 🎁 Bé Orca gợi ý công thức phân bổ vàng 50/30/20 cho tiền thưởng nè: 🐳

🎯 CHIẾN LƯỢC PHÂN BỔ ${formatVnd(bonus)}:
1. 🛡️ 50% (${formatVnd(emAlloc)}) — Gia cố phòng tuyến:
${priorityNote}

2. 📈 30% (${formatVnd(invAlloc)}) — Tích lũy sinh lời:
Phân bổ vào các kênh tích sản dài hạn như chứng chỉ quỹ chỉ số, vàng nhẫn tích trữ hoặc gửi tiết kiệm sinh lãi.

3. 💖 20% (${formatVnd(joyAlloc)}) — Tự thưởng xứng đáng:
Dành trọn vẹn khoản này cho bản thân: mua món đồ cậu ao ước bấy lâu, đi ăn ngon hoặc du lịch xả stress mà không lo thâm hụt ngân sách!

Cách chia này giúp cậu vừa có thưởng để vui vẻ, vừa làm túi tiền dày dặn hơn đó! ✨`;
  }

  // Case 4: Mua xe trả góp / Trả góp
  if (query.includes("trả góp") || query.includes("mua xe") || query.includes("mua ô tô") || query.includes("mua iphone") || query.includes("vay mua")) {
    const safeDebtRatio = 0.20; // 20% lương net
    const maxSafeMonthlyPay = Math.round(net * safeDebtRatio);
    const currentDebtService = debts.reduce((sum, d) => sum + (d.minMonthlyPayment ?? 0), 0);
    const remainingSafeRoom = Math.max(0, maxSafeMonthlyPay - currentDebtService);

    return `Bé Orca đánh giá khả năng gánh trả góp dựa trên dòng tiền thật của cậu nè: 🐳

📊 BÀI TOÁN TÀI CHÍNH CỦA CẬU:
• Thu nhập thực nhận: ${formatVnd(net)}/tháng.
• Chi phí cố định hiện tại: ${formatVnd(fixed)} (${(facts?.fixedCostRatio ?? 0).toFixed(0)}% thu nhập).
• Nghĩa vụ trả nợ hiện tại: ${formatVnd(currentDebtService)}/tháng.

🛡️ HẠN MỨC TRẢ GÓP AN TOÀN:
Theo chuẩn quản trị rủi ro tài chính cá nhân, tổng nghĩa vụ nợ + trả góp hàng tháng không được vượt quá 20–30% thu nhập thực nhận.
• Mức trần an toàn tuyệt đối: ${formatVnd(maxSafeMonthlyPay)}/tháng.
• Dư địa an toàn còn lại cho khoản mua sắm mới: khoảng ${formatVnd(remainingSafeRoom)}/tháng.

💡 LỜI KHUYÊN CỦA BÉ ORCA:
1. Nếu khoản trả góp hàng tháng nhỏ hơn ${formatVnd(remainingSafeRoom)}/tháng: Cậu hoàn toàn đủ khả năng gánh vác mà không làm đảo lộn sinh hoạt.
2. Nếu khoản trả góp vượt quá ${formatVnd(maxSafeMonthlyPay)}/tháng: Rất rủi ro! Cậu nên hoãn mua 3–6 tháng để gom thêm tiền trả trước (Down payment) tối thiểu 40–50% giá trị tài sản nhé! 💪`;
  }

  // Case 5: Tiết kiệm vs Vàng vs Quỹ mở
  if (query.includes("vàng") || query.includes("tiết kiệm hay mua vàng") || query.includes("quỹ mở") || (query.includes("tiết kiệm") && query.includes("đầu tư"))) {
    const parsedAmount = extractAmountFromText(q);
    const idleCash = parsedAmount || 50_000_000;
    const bankPart = Math.round(idleCash * 0.50);
    const goldPart = Math.round(idleCash * 0.30);
    const fundPart = Math.round(idleCash * 0.20);

    return `Bé Orca tư vấn phân bổ ${formatVnd(idleCash)} tiền nhàn rỗi theo thế chân vạc an toàn nè: 🐳✨

🪙 CHIẾN LƯỢC KIỀNG 3 CHÂN (Tối ưu cho thị trường Việt Nam):
• 🏦 50% (${formatVnd(bankPart)}) — Tiết kiệm ngân hàng:
  Giữ thanh khoản cao và đệm an toàn linh hoạt. Chọn kỳ hạn 6–12 tháng hoặc gửi tích lũy linh hoạt để luôn có sẵn tiền mặt khi cần.

• 🪙 30% (${formatVnd(goldPart)}) — Vàng nhẫn tròn trơn 9999:
  Kênh phòng hộ lạm phát và biến động địa chính trị hiệu quả nhất lịch sử. Mua vàng nhẫn của các thương hiệu uy tín (SJC, PNJ, DOJI, Bảo Tín), giữ dài hạn tối thiểu 2–3 năm.

• 📊 20% (${formatVnd(fundPart)}) — Chứng chỉ quỹ mở (Cổ phiếu VN30 / Trái phiếu):
  Khai thác đà tăng trưởng của nền kinh tế Việt Nam với mức sinh lời kỳ vọng 10–12%/năm mà không cần ngồi canh bảng điện hàng ngày.

🎯 Tỷ lệ này giúp cậu vừa bảo toàn vốn gốc, vừa có đệm thanh khoản, vừa gia tăng tài sản bền vững nhen! 💖`;
  }

  // Case 6: Nợ & Xử lý nợ
  if (query.includes("nợ") || query.includes("trả nợ") || query.includes("vay") || query.includes("snowball") || query.includes("avalanche")) {
    if (debts.length === 0 || totalDebt <= 0) {
      return `Bé Orca thấy sổ tài chính của cậu hiện không có khoản nợ nào nè! 🐳 Thật tuyệt vời, cậu đang ở vị thế tài chính rất tự do và an toàn. Hãy tập trung xây dựng quỹ khẩn cấp 3–6 tháng (${formatVnd(exp * 3)} – ${formatVnd(exp * 6)}) và phân bổ tích lũy sinh lời nhé! ✨`;
    }

    const debtDetails = debts
      .map((d) => `• ${d.name || "Khoản nợ"}: Dư nợ ${formatVnd(d.balance)}, lãi suất ${(d.interestRate ?? 0)}%/năm (trả tối thiểu ${formatVnd(d.minMonthlyPayment)}/tháng)`)
      .join("\n");

    return `Bé Orca đã rà soát toàn bộ danh mục nợ ${formatVnd(totalDebt)} của cậu nè: 🐳

📋 DANH SÁCH CÁC KHOẢN NỢ:
${debtDetails}

🛡️ CHIẾN LƯỢC DẬP NỢ 3 BƯỚC:
1. Đệm phòng hộ tối thiểu: Giữ lại ít nhất 1 tháng chi tiêu thiết yếu (~${formatVnd(fixed)}) trong tài khoản để không phải vay mới khi có sự cố.
2. Phương pháp Lở tuyết (Debt Avalanche):
   Tập trung toàn bộ số tiền tiết kiệm hàng tháng (${formatVnd(savings)}) để trả thêm cho khoản nợ có lãi suất cao nhất. Duy trì trả tối thiểu cho các khoản còn lại. Đây là cách giúp cậu tiết kiệm nhiều tiền lãi nhất!
3. Phương pháp Tuyết lăn (Debt Snowball):
   Nếu cậu cảm thấy stress, hãy trả dứt điểm khoản có số dư nhỏ nhất trước. Cảm giác xóa sổ từng khoản nợ sẽ tạo động lực tâm lý cực lớn!

Kiên trì dập từng khoản, cậu sẽ sớm lấy lại hoàn toàn tự do tài chính nhen! 💪💖`;
  }

  // Case 7: Quỹ khẩn cấp / Dự phòng
  if (query.includes("tiết kiệm") || query.includes("quỹ khẩn cấp") || query.includes("dự phòng") || query.includes("an toàn")) {
    const target3m = Math.round(exp * 3);
    const target6m = Math.round(exp * 6);
    const currentEmergency = Math.round(emergencyMonths * exp);

    return `Bé Orca đánh giá quỹ dự phòng của cậu nè: 🐳

🛡️ HIỆN TRẠNG QUỸ DỰ PHÒNG:
• Quỹ khẩn cấp hiện tại: khoảng ${formatVnd(currentEmergency)} (Đủ trang trải ${emergencyMonths.toFixed(1)} tháng chi tiêu).
• Mức tích lũy mỗi tháng: ${formatVnd(savings)} (Tỷ lệ tiết kiệm ${(facts?.savingsRate ?? 0).toFixed(0)}% thu nhập).

🎯 CHUẨN AN TOÀN CHO NGƯỜI VIỆT NAM:
• Mức sàn tối thiểu (3 tháng): ${formatVnd(target3m)}
• Mức lý tưởng vững chắc (6 tháng): ${formatVnd(target6m)}

💡 HÀNH ĐỘNG CỦA CẬU:
${emergencyMonths < 3.0
  ? `Quỹ của cậu hiện tại (${emergencyMonths.toFixed(1)} tháng) chưa đạt mức an toàn 3 tháng. Hãy tạm hoãn các khoản đầu tư rủi ro, trích ngay ${formatVnd(Math.round(net * 0.2))} mỗi tháng vào tài khoản tiết kiệm trực tuyến cho tới khi chạm mốc ${formatVnd(target3m)} nhé!`
  : `Tuyệt vời! Đệm an toàn của cậu đã đạt ${emergencyMonths.toFixed(1)} tháng, vượt chuẩn an toàn. Bây giờ cậu có thể tự tin phân bổ dòng tiền tiết kiệm hàng tháng vào các kênh đầu tư sinh lời dài hạn! ✨`}💖`;
  }

  // Case 8: Thuế TNCN & Bảo hiểm
  if (query.includes("thuế") || query.includes("tncn") || query.includes("bảo hiểm") || query.includes("bhxh") || query.includes("gross")) {
    return `Bé Orca giải thích cách tính Thuế TNCN và Bảo hiểm tại Việt Nam cho cậu nè: 🐳✨

📑 CƠ CẤU KHẤU TRỪ TỪ LƯƠNG GROSS SANG NET:
1. Bảo hiểm bắt buộc người lao động đóng (tổng 10,5% lương đóng BH):
   • BHXH: 8%
   • BHYT: 1,5%
   • BHTN: 1%
2. Mức giảm trừ gia cảnh hiện hành theo luật Việt Nam:
   • Bản thân người nộp thuế: 11.000.000 ₫/tháng.
   • Mỗi người phụ thuộc đã đăng ký: 4.400.000 ₫/tháng/người.
3. Thu nhập tính thuế = Thu nhập Gross - Các khoản bảo hiểm - Giảm trừ gia cảnh.
4. Biểu thuế lũy tiến từng phần (7 bậc từ 5% đến 35%).

💡 Mẹo tối ưu dòng tiền: Tận dụng các khoản phụ cấp không chịu thuế (tiền ăn trưa, công tác phí, trang phục theo quy định) và đăng ký người phụ thuộc đầy đủ để tối ưu số thuế phải nộp nhé! 💖`;
  }

  // Case 9: Mục tiêu tài chính
  if (query.includes("mục tiêu") || query.includes("mua nhà") || query.includes("đám cưới") || query.includes("du lịch")) {
    if (goals.length === 0) {
      return `Hiện tại cậu chưa ghi mục tiêu nào trong sổ tài chính nè! 🐳 Hãy tạo một mục tiêu cụ thể (như Quỹ du lịch hè, Mua laptop, Cưới hỏi, Đặt cọc nhà...) để Bé Orca cùng cậu theo dõi tiến độ tích lũy nha! 🚀`;
    }
    const goalSummary = goals
      .map((g) => {
        const pct = g.targetAmount ? Math.min(100, Math.round(((g.accumulatedAmount ?? 0) / g.targetAmount) * 100)) : 0;
        return `• ${g.name}: Đã tích lũy ${formatVnd(g.accumulatedAmount)} / ${formatVnd(g.targetAmount)} (${pct}%) — Hạn: ${g.deadline || "Dài hạn"}`;
      })
      .join("\n");
    return `Bé Orca tổng hợp các mục tiêu cậu đang ấp ủ nè: 🐳✨\n${goalSummary}\n\nCậu đang đi đúng hướng đó! Cứ kiên trì trích quỹ đều đặn mỗi tháng là sẽ sớm về đích thôi nhen! 💖`;
  }

  // Fallback mặc định toàn diện
  return `Chào cậu nhen! Bé Orca đã phân tích trực tiếp theo sổ tài chính kỳ ${facts?.period || "hiện tại"} của cậu: 🐳✨

📊 1. NHẬN DIỆN BỐI CẢNH CỦA CẬU:
• Thu nhập thực nhận: ${formatVnd(net)}/tháng.
• Chi phí sinh hoạt: ${formatVnd(exp)} (Chi cố định đang chiếm ${(facts?.fixedCostRatio ?? 0).toFixed(0)}% lương).
• Đệm an toàn: ${emergencyMonths.toFixed(1)} tháng chi tiêu.
• Điểm sức khỏe tài chính: ${facts?.healthScore ?? 75}/100 (${facts?.healthRating || "Khá"}).
${totalDebt > 0 ? `• Dư nợ đang theo dõi: ${formatVnd(totalDebt)}.\n` : ""}
💡 2. PHÂN BỔ 50/30/20 THAM KHẢO CHO CẬU:
• 🏠 Thiết yếu (50%): ${formatVnd(Math.round(net * 0.5))} (Cậu đang chi ${formatVnd(fixed)}, ${fixed > net * 0.5 ? "hơi cao, nên rà soát lại" : "rất hợp lý"}).
• ☕ Chi tiêu linh hoạt (30%): ${formatVnd(Math.round(net * 0.3))} cho học tập, gặp gỡ bạn bè và tận hưởng cuộc sống.
• 🐷 Tích lũy & Đầu tư (20%): ${formatVnd(Math.round(net * 0.2))} gia cố quỹ khẩn cấp và sinh lời.

✨ 3. HÀNH ĐỘNG TUẦN NÀY:
Trích ngay ${formatVnd(Math.round(net * 0.2))} vào tài khoản tích lũy riêng ngay ngày nhận lương nhé! Cậu muốn Bé Orca tư vấn chi tiết phần nào cứ bấm gợi ý hoặc hỏi bé nha! 💖`;
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

    // Nếu có LLM cấu hình, gọi LLM gateway với System Prompt huấn luyện chuyên sâu
    if (llmConfigured()) {
      try {
        const net = facts.netIncome ?? 0;
        const fixed = facts.fixedExpenses ?? 0;
        const totalExp = facts.totalExpenses ?? 0;

        const systemPrompt = `Bạn là "Bé Orca 🐳" — Trợ lý AI tài chính cá nhân độc quyền của hệ thống ORCA Personal Finance, được huấn luyện theo bộ dataset chuẩn tài chính Việt Nam.

TÍNH CÁCH & GIỌNG ĐIỆU:
- Xưng hô thân thiện, ấm áp, đáng yêu: xưng là "Bé Orca" hoặc "Bé", gọi người dùng là "cậu" hoặc "bạn". Sử dụng icon 🐳, ✨, 💖, 💪, 🛡️ một cách tinh tế.
- Chuyên môn vững vàng, thực tế, hiểu sâu thị trường Việt Nam (chi phí sinh hoạt tại TP.HCM/Hà Nội, lãi suất gửi tiết kiệm, vàng nhẫn 9999, thuế TNCN, BHXH 10.5%).
- Lời khuyên định lượng rõ ràng: Chỉ ra con số VND cụ thể, không nói đạo lý chung chung.
- TRUNG THỰC TUYỆT ĐỐI VỚI DỮ LIỆU: Mọi phép tính phải bám sát số liệu từ BỐI CẢNH SỔ TÀI CHÍNH dưới đây, không tự bịa ra thu nhập hay khoản nợ khác.

QUY TẮC PHÂN TÍCH ĐÃ HUẤN LUYỆN (SFT GUIDELINES):
1. Phân bổ 50/30/20: Thiết yếu tối đa 50% lương net, Linh hoạt 30%, Tích lũy tối thiểu 20%. Nếu Chi cố định > 50%, cảnh báo nhẹ nhàng và hướng dẫn tối ưu.
2. 6 chiếc lọ JARS: Thiết yếu 55%, Tiết kiệm dài hạn 10%, Giáo dục 10%, Hưởng thụ 10%, Tự do tài chính 10%, Cho đi 5%.
3. Tiền thưởng windfall: 50% quỹ khẩn cấp/dập nợ, 30% đầu tư dài hạn, 20% tự thưởng bản thân.
4. Mua xe trả góp: Tổng nghĩa vụ nợ/trả góp an toàn tối đa 20–30% lương net. Vượt quá mức này là nguy hiểm.
5. Tiền nhàn rỗi: Kiềng 3 chân: 50% tiết kiệm ngân hàng (thanh khoản), 30% vàng nhẫn 9999 (chống lạm phát), 20% chứng chỉ quỹ mở/cổ phiếu.
6. Xử lý nợ: Debt Avalanche (ưu tiên nợ lãi cao nhất) để tiết kiệm tiền lãi; Debt Snowball (khoản nhỏ nhất trước) để giải tỏa tâm lý.

BỐI CẢNH SỔ TÀI CHÍNH THỰC TẾ CỦA NGƯỜI DÙNG:
- Kỳ ghi chép: ${facts.period || "Hiện tại"}
- Thu nhập thực nhận (Net): ${formatVnd(net)}/tháng (Gross: ${formatVnd(facts.grossIncome)})
- Tổng chi tiêu: ${formatVnd(totalExp)}/tháng (Chi cố định: ${formatVnd(fixed)}, Chi linh hoạt: ${formatVnd(facts.variableExpenses)})
- Tỷ lệ chi cố định: ${(facts.fixedCostRatio ?? 0).toFixed(1)}% thu nhập
- Tiết kiệm hàng tháng: ${formatVnd(facts.monthlySavings)} (Tỷ lệ tiết kiệm: ${(facts.savingsRate ?? 0).toFixed(1)}%)
- Quỹ khẩn cấp: Đủ trang trải ${(facts.emergencyFundMonths ?? 0).toFixed(1)} tháng chi tiêu thiết yếu
- Tổng nợ: ${formatVnd(facts.totalDebt)}
- Tài sản ròng (Net Worth): ${formatVnd(facts.netWorth)}
- Điểm sức khỏe tài chính: ${facts.healthScore ?? 75}/100 (${facts.healthRating || "Khá"})
${facts.debtsList && facts.debtsList.length > 0 ? `- Danh sách nợ: ${JSON.stringify(facts.debtsList)}` : "- Không có khoản nợ nào"}
${facts.goalsList && facts.goalsList.length > 0 ? `- Mục tiêu: ${JSON.stringify(facts.goalsList)}` : "- Chưa tạo mục tiêu cụ thể"}
`;

        const chatHistory = history.map((h: { sender: string; text: string }) => ({
          role: (h.sender === "user" ? "user" : "assistant") as "user" | "assistant",
          content: h.text,
        }));

        const llmResult = await llmChat("reasoning", {
          system: systemPrompt,
          user: question,
          history: chatHistory,
          temperature: 0.6,
          maxTokens: 1200,
          timeoutMs: 15_000,
        });

        if (llmResult?.text && llmResult.text.trim().length > 20) {
          return ok({ answer: llmResult.text.trim() });
        }
      } catch (llmErr) {
        console.warn("[Ask Orca API] LLM thất bại, chuyển sang fallback phân tích cục bộ:", llmErr);
      }
    }

    // Fallback thông minh cục bộ bám sát tri thức dataset
    const fallbackAnswer = generateDeterministicAnswer(question, facts);
    return ok({ answer: fallbackAnswer });
  } catch (err) {
    console.error("[Ask Orca API Error]:", err);
    return ok({
      answer: "Chào cậu nhen! Bé Orca đang bơi một vòng để tổng hợp dữ liệu, cậu kiểm tra lại kết nối và hỏi lại bé nha! 🐳✨",
    });
  }
}
