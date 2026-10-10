import { ok, badRequest } from "@/lib/envelope";
import { llmChat, llmConfigured } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return badRequest("Body JSON không hợp lệ");
    }

    const facts = body.facts;
    if (!facts || typeof facts !== "object") {
      return badRequest("Thiếu thông tin facts");
    }

    if (llmConfigured()) {
      try {
        const prompt = `Bạn là Chuyên gia Cố vấn Tài chính Cá nhân cao cấp của ORCA Financial.
Dưới đây là bảng số liệu tài chính thực tế của khách hàng trong kỳ ${facts.period || "gần nhất"}:
${JSON.stringify(facts, null, 2)}

Yêu cầu:
1. Viết một bản báo cáo diễn giải tài chính cá nhân súc tích, chuyên nghiệp bằng tiếng Việt.
2. TUYỆT ĐỐI KHÔNG TỰ BỊA RA CON SỐ MỚI. Mọi số liệu trong bài viết phải lấy chính xác từ bảng số liệu trên.
3. Bố cục gồm 3 phần:
   - Tổng quan thu chi & tỷ lệ tiết kiệm
   - Đánh giá đệm thanh khoản & an toàn nợ
   - Đề xuất hành động trọng tâm cho kỳ tiếp theo
`;

        const result = await llmChat("report", {
          system: "Bạn là Chuyên gia Cố vấn Tài chính Cá nhân cao cấp của ORCA Financial.",
          user: prompt,
          temperature: 0.3,
          maxTokens: 1200,
        });

        if (result?.text && result.text.length > 50) {
          return ok({ narrative: result.text.trim() });
        }
      } catch (err) {
        console.warn("[Narrator API] LLM call failed:", err);
      }
    }

    return ok({ narrative: "" });
  } catch (err) {
    return ok({ narrative: "" });
  }
}
