import "server-only";
import { llmChat, llmConfigured } from "../ai/gateway";
import { retrieveRag, formatPassagesForPrompt, type RagBranch } from "../rag";
import type { AgentBuilt } from "./agent-context";
import type { HistoryTurn } from "./agent-memory";

export type AgentPrefs = {
  depth?: "concise" | "standard" | "deep";
  style?: "analyst" | "technical" | "brief";
  language?: "vi" | "en";
  riskDisclosure?: "standard" | "detailed" | "off";
};

export type AgentHistoryTurn = HistoryTurn;

export async function synthesizeWithLlm(
  question: string,
  built: AgentBuilt,
  prefs: AgentPrefs,
  history: AgentHistoryTurn[],
  opts?: { forceBriefingFormat?: boolean },
): Promise<{ text: string; model: string } | null> {
  if (!llmConfigured()) return null;
  try {
    const lang = prefs.language === "en" ? "Anh" : "Việt";
    const depth = prefs.depth ?? "standard";
    const isDeep = depth === "deep" || Boolean(opts?.forceBriefingFormat);
    const isConcise = depth === "concise";

    const briefingRule = opts?.forceBriefingFormat
      ? `
BẮT BUỘC giữ đúng 4 phần (tiêu đề ##):
1. Biến động chỉ số & cổ phiếu dẫn dắt
2. Động thái khối ngoại
3. Thanh khoản & độ rộng thị trường
4. Tổng quan ngành & nguyên nhân vĩ mô
Chỉ làm mượt câu chữ / bổ sung liên kết logic từ CONTEXT; KHÔNG đổi cấu trúc, KHÔNG bịa số liệu.`
      : "";

    const marketRule = /thị trường|vn-?index|vn30|hose|hnx|upcom|khối ngoại|ngành dẫn dắt/i.test(question)
      ? `
NHÁNH THỊ TRƯỜNG — ưu tiên: trạng thái VN-Index/VN30/HNX/UPCoM, % và thanh khoản, breadth, leadership/ngành mạnh-yếu, flow (khối ngoại/tự doanh nếu có), macro/cross-asset, rủi ro cần theo dõi, kết luận ngắn. Không tự tạo market score hay xác suất. Nhắc timestamp khi có.`
      : "";

    const industryRule = /ngành|sector|banking|dầu khí|thép|công nghệ|bất động sản|bán lẻ/i.test(question)
      ? `
NHÁNH NGÀNH — phân tích toàn ngành trước (xu hướng/RS, breadth, thanh khoản, leadership/laggards); chỉ liên hệ từng mã khi CONTEXT chứng minh. Earnings, valuation, NIM/NPL, hàng hóa, macro, news chỉ nêu khi có dữ liệu; thiếu thì nói rõ. Không tự ranking mới.`
      : "";

    const stockRule = /phân tích|cổ phiếu|mã cổ phiếu|định giá|p\/e|p\/b|eps|so sánh|\bFPT\b|\bCMG\b|\bGAS\b/i.test(question)
      ? `
NHÁNH CỔ PHIẾU — thứ tự: thị trường → ngành → doanh nghiệp → cổ phiếu. Financial statements giữ đúng kỳ và nguồn. Chỉ giải thích score kỹ thuật/cơ bản/định giá đã có, không tạo điểm tổng hợp mới. So sánh: từng chỉ tiêu cùng kỳ, đánh dấu thiếu/discrepancy; không kết luận rẻ/đắt từ một ratio.`
      : "";

    const commodityRule = /vàng|gold|bạc|silver|dầu|oil|wti|brent|hrc|đồng|cà phê|robusta|arabica|hàng hóa|commodity/i.test(question)
      ? `
NHÁNH HÀNG HÓA — luôn nêu giá, đơn vị, currency, timestamp, timeframe, nguồn nếu có. Phân tích tác động theo chuỗi: COMMODITY → cơ chế truyền dẫn → INDUSTRY → DOANH NGHIỆP → STOCK; nêu độ trễ và rủi ro, không suy diễn mọi mã đều hưởng lợi.`
      : "";

    const depthRule =
      isDeep
        ? `
ĐỘ SÂU = DEEP: viết như research note đầy đủ khoảng 900–1.400 từ (hoặc tương đương 14–22 đoạn/ý).
Bắt buộc có: (1) mở đầu tóm tắt 3–5 câu, (2) từng khối phân tích với số liệu + diễn giải ý nghĩa, (3) liên hệ ngành/vĩ mô/cross-asset nếu CONTEXT có, (4) rủi ro & giả định, (5) kịch bản cần theo dõi, (6) kết luận mở (không đóng cứng mua/bán).
Ưu tiên phủ rộng dữ liệu quant có trong CONTEXT — không bỏ sót chỉ số then chốt.`
        : isConcise
          ? `
ĐỘ SÂU = CONCISE: 6–9 đoạn hoặc bullet có diễn giải, mỗi điểm chính kèm ít nhất một số liệu then chốt. Vẫn đủ để đọc hiểu bối cảnh, không chỉ 2–3 câu.`
          : `
ĐỘ SÂU = STANDARD (mặc định — trả lời ĐẦY ĐỦ, không rút gọn quá mức):
Viết khoảng 550–900 từ hoặc 12–18 đoạn/ý có liên kết logic.
Cấu trúc gợi ý (linh hoạt theo câu hỏi, không bắt buộc đánh số cứng):
1) Mở đầu: bức tranh tổng quan + 2–3 số liệu then chốt.
2) Thân bài: triển khai từng khía cạnh (giá/chỉ số, thanh khoản/độ rộng, dòng tiền, ngành/leadership, so sánh, tin/vĩ mô) — mỗi mục có số liệu + ý nghĩa.
3) Rủi ro / điểm cần theo dõi.
4) Kết luận mở, phục vụ nghiên cứu (không khuyến nghị mua/bán).
Bắt buộc tận dụng tối đa số liệu quant trong CONTEXT/NARRATIVE; thiếu phần nào thì nói rõ, không bỏ trống im lặng.`;

    const styleRule = `
GIỌNG VĂN (quan trọng — để giống người hơn):
Bạn là senior equity research analyst Việt Nam đang nói chuyện với đồng nghiệp, không phải chatbot liệt kê.
- Viết câu văn trôi chảy, có chuyển tiếp tự nhiên: "Đáng chú ý là…", "Điều này cho thấy…", "Tuy nhiên cần lưu ý…", "Nhìn rộng hơn…".
- Mỗi số liệu phải kèm ý nghĩa (không chỉ nêu số rồi dừng).
- Tránh cụm máy móc: "Dựa trên dữ liệu được cung cấp", "Theo CONTEXT JSON", "Kết luận:", "Tóm lại như sau:".
- Có thể dùng ## tiêu đề và gạch đầu dòng; bên trong mỗi mục viết đoạn văn đủ ý (2–4 câu), không chỉ bullet khô một dòng.
- Không khuyến nghị mua/bán tuyệt đối; nhấn mạnh phục vụ nghiên cứu.
- Nếu thiếu dữ liệu: nói thẳng "chưa có trong hệ thống" hoặc "dữ liệu [X] chưa sẵn", không bịa.
- KHÔNG cắt ngắn câu trả lời khi CONTEXT còn số liệu hữu ích; độ dài ưu tiên đủ thông tin hơn là ngắn gọn.

VÍ DỤ GIỌNG (tham khảo phong cách, KHÔNG copy số liệu):
Thay vì: "VN-Index tăng 0.8%. Breadth 320 mã tăng / 180 mã giảm. Khối ngoại bán ròng 250 tỷ."
Hãy viết kiểu: "VN-Index khép phiên tăng gần 0,8% trong bối cảnh độ rộng tương đối tích cực (khoảng 320 mã tăng so với 180 mã giảm). Dù vậy, khối ngoại tiếp tục bán ròng khoảng 250 tỷ — đây vẫn là yếu tố cần theo dõi vì dòng tiền ngoại chưa xác nhận rõ xu hướng ngắn hạn."`;

    const system = `Bạn là ORCA Agent — trợ lý phân tích tài chính của nền tảng ORCA Multi-Finance.
Chỉ được dùng số liệu trong CONTEXT JSON và NARRATIVE đã tính sẵn từ hệ thống (chứng khoán VN, crypto, forex, hàng hóa, lãi suất, vĩ mô).
KHÔNG bịa số, KHÔNG bịa nguồn. Nếu thiếu dữ liệu, nói rõ.
Chỉ được dùng số liệu trong CONTEXT/NARRATIVE và các đoạn TÀI LIỆU TRUY XUẤT; khi dùng tài liệu hãy ghi chú [n].
Trả lời bằng tiếng ${lang}.
Mục tiêu: câu trả lời ĐẦY ĐỦ, giàu thông tin quant, dễ đọc — không lược bỏ các số liệu then chốt có trong CONTEXT.
${styleRule}
${depthRule}
${briefingRule}${marketRule}${industryRule}${stockRule}${commodityRule}`;

    // Phase A RAG: guides + news + rag_chunks (lexical)
    let ragBlock = "(Không có đoạn tài liệu bổ sung.)";
    try {
      let branch: RagBranch = "general";
      if (/thị trường|vn-?index|vn30|khối ngoại|hose|hnx/i.test(question)) branch = "market";
      else if (/ngành|sector|banking|dầu khí|thép|bất động sản/i.test(question)) branch = "industry";
      else if (/vàng|gold|dầu|oil|hàng hóa|commodity|cà phê/i.test(question)) branch = "commodity";
      else if (/cổ phiếu|mã |p\/e|p\/b|định giá|phân tích/i.test(question)) branch = "stock";
      const rag = await retrieveRag({
        question,
        symbols: built.symbols ?? [],
        branch,
        topK: isDeep ? 10 : isConcise ? 5 : 8,
      });
      ragBlock = formatPassagesForPrompt(rag.passages);
    } catch {
      /* RAG best-effort */
    }

    const user = `CÂU HỎI: ${question}

NARRATIVE HỆ THỐNG (ưu tiên bám sát — triển khai đầy đủ, không tóm tắt quá mức):
${built.narrative.slice(0, 16_000)}

CONTEXT JSON (rút gọn nhưng đủ rộng):
${JSON.stringify(built.contract).slice(0, 18_000)}

TÀI LIỆU TRUY XUẤT (guides/news/notes — chỉ dùng kèm CONTEXT; ghi [n] khi trích):
${ragBlock}

YÊU CẦU ĐẦU RA:
- Viết phân tích chuyên sâu, dài và đủ ý theo ĐỘ SÂU đã chỉ định.
- Tận dụng tối đa số liệu quant trong NARRATIVE/CONTEXT (giá, %, thanh khoản, breadth, flow, valuation, v.v. nếu có).
- Mỗi khối chính có diễn giải — không chỉ liệt kê.
- Giọng research analyst tự nhiên, tiếng ${lang}.`;

    const maxTokens = isDeep ? 3600 : isConcise ? 1400 : 2800;
    const temperature =
      opts?.forceBriefingFormat ? 0.18 :
      isConcise ? 0.22 :
      prefs.style === "analyst" || isDeep ? 0.45 :
      0.35;
    const timeoutMs = isDeep ? 32_000 : isConcise ? 22_000 : 28_000;

    const r = await llmChat("analysis", {
      system,
      user,
      temperature,
      maxTokens,
      topP: isDeep ? 0.9 : 0.92,
      timeoutMs,
      history: history.slice(-8).map((h) => ({
        role: h.role === "assistant" || h.role === "agent" ? ("assistant" as const) : ("user" as const),
        content: h.content,
      })),
    });
    if (!r?.text?.trim()) return null;
    return { text: r.text.trim(), model: r.model };
  } catch {
    return null;
  }
}
