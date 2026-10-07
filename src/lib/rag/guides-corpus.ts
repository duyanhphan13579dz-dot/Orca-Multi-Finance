import "server-only";

import { chunkText } from "./chunk";
import type { RagBranch, RagPassage } from "./types";

/**
 * Phase A: built-in corpus from ORCA AI_* guides (no DB required).
 */
const GUIDE_DOCS: { id: string; branch: RagBranch; title: string; body: string }[] = [
  {
    id: "guide-market-structure",
    branch: "market",
    title: "Khung phân tích thị trường VN",
    body: `Nhánh THỊ TRƯỜNG: phân tích toàn cảnh CK Việt Nam và liên thị trường, không tập trung một mã trừ khi câu hỏi yêu cầu.
Khung trả lời: (1) trạng thái VN-Index/HNX/UPCoM/VN30 — điểm, % , thanh khoản; (2) độ rộng advancers/decliners, nhóm dẫn dắt; (3) dòng tiền khối ngoại/tự doanh nếu có; (4) ngành mạnh/yếu; (5) vĩ mô/cross-asset; (6) rủi ro cần theo dõi; (7) kết luận ngắn.
Quy tắc: không bịa số; không gọi dữ liệu cũ là realtime; không tự tạo market score; không biến phân tích thành khuyến nghị mua/bán cá nhân hóa. Luôn nêu thời điểm dữ liệu khi có; phân biệt dữ liệu và diễn giải.`,
  },
  {
    id: "guide-market-questions",
    branch: "market",
    title: "Câu hỏi mẫu nhánh thị trường",
    body: `Câu hỏi điển hình: "Thị trường hôm nay thế nào?", "VN-Index đang ở trạng thái nào?", "Khối ngoại hôm nay mua bán thế nào?", "Nhóm ngành nào đang dẫn dắt?", "Thị trường đang tích cực hay tiêu cực?".
Khi index tăng nhưng một ngành giảm: phân tích market → industry → contribution/leadership nếu có dữ liệu → breadth/thanh khoản; chỉ liên hệ cổ phiếu khi user hỏi.
Nguồn ưu tiên: market/price engine, breadth, flow, macro/cross-asset, news — chỉ dùng dữ liệu có timestamp.`,
  },
  {
    id: "guide-stock-structure",
    branch: "stock",
    title: "Khung phân tích cổ phiếu",
    body: `Nhánh CỔ PHIẾU: thứ tự Thị trường → Ngành → Doanh nghiệp → Cổ phiếu.
Cấu trúc Stock Intelligence: market context, industry, price/volume, technical, financial statements, financial health, cash flow, valuation, earnings, relative strength, news, catalysts, risks.
Financial statements là vùng bắt buộc chính xác: không điền số thiếu bằng suy đoán; không trộn kỳ; ghi rõ quý/năm và nguồn; discrepancy giữa nguồn phải đánh dấu.
Kết luận là tổng hợp bằng chứng (điểm hỗ trợ, điểm theo dõi, rủi ro, điều kiện xác nhận/đảo chiều) — không phải một câu mua/bán máy móc.`,
  },
  {
    id: "guide-stock-valuation",
    branch: "stock",
    title: "Định giá và so sánh cổ phiếu",
    body: `Câu "có đắt không?": nêu giá hiện tại, P/E P/B P/S nếu có, EPS, tăng trưởng lợi nhuận, so lịch sử chính mã đó, so ngành nếu dữ liệu đồng nhất, giả định ảnh hưởng định giá. Không kết luận rẻ/đắt chỉ từ một chỉ số.
So sánh hai mã: cùng kỳ báo cáo; đối chiếu từng chỉ tiêu (doanh thu, LN, ROE/ROA, nợ, FCF, biên, định giá); nêu thiếu/discrepancy; không tạo điểm tổng hợp bằng LLM.
Technical: chỉ giải thích score/indicator đã có từ quant engine, không invent RSI/MACD.`,
  },
  {
    id: "guide-industry",
    branch: "industry",
    title: "Khung phân tích ngành",
    body: `Nhánh NGÀNH: phân tích toàn ngành trước — xu hướng/relative strength, breadth, thanh khoản, leadership/laggards. Chỉ liên hệ doanh nghiệp khi context chứng minh. Không lấy vài mã đại diện gọi là toàn ngành.
Earnings, valuation, NIM/NPL/CASA, hàng hóa, macro, news chỉ nêu khi có dữ liệu; thiếu phải nói rõ. Không tự tạo ranking mới.`,
  },
  {
    id: "guide-commodity",
    branch: "commodity",
    title: "Khung phân tích hàng hóa",
    body: `Nhánh HÀNG HÓA: luôn nêu giá, đơn vị, currency, timestamp, timeframe và nguồn nếu có. Chỉ dùng timeframe engine cung cấp.
Chuỗi phân tích tác động: COMMODITY → cơ chế truyền dẫn → INDUSTRY → DOANH NGHIỆP → STOCK. Không suy diễn mọi mã đều hưởng lợi; phải nêu độ trễ và rủi ro.
Vàng/dầu/cà phê: tách kỳ vọng lạm phát, tỷ giá, tồn kho, biên lợi nhuận doanh nghiệp liên quan.`,
  },
  {
    id: "guide-voice-rules",
    branch: "general",
    title: "Giọng văn và chống ảo giác",
    body: `Giọng senior equity research analyst Việt Nam: câu văn trôi chảy, chuyển tiếp ("Đáng chú ý là", "Điều này cho thấy", "Tuy nhiên cần lưu ý"). Mỗi số liệu kèm ý nghĩa.
Cấm: "Dựa trên dữ liệu được cung cấp", "Theo CONTEXT JSON", khuyến nghị mua/bán tuyệt đối, bịa nguồn.
Thiếu dữ liệu: nói "chưa có trong hệ thống". Phân tích phục vụ nghiên cứu, không phải lời khuyên đầu tư.`,
  },
];

let cachedPassages: RagPassage[] | null = null;

export function getGuidePassages(): RagPassage[] {
  if (cachedPassages) return cachedPassages;
  const out: RagPassage[] = [];
  for (const doc of GUIDE_DOCS) {
    const chunks = chunkText(doc.body, { maxChars: 700, overlap: 80 });
    chunks.forEach((content, i) => {
      out.push({
        id: `${doc.id}#${i}`,
        source: "guide",
        title: doc.title,
        content,
        symbol: null,
        sector: null,
        score: 0,
        sourceTs: null,
        url: null,
      });
    });
  }
  cachedPassages = out;
  return out;
}

export function filterGuidesByBranch(branch: RagBranch | undefined): RagPassage[] {
  const all = getGuidePassages();
  if (!branch || branch === "general") return all;
  return all.filter((p) => {
    const id = p.id;
    if (branch === "market") return id.includes("market") || id.includes("voice") || id.includes("general");
    if (branch === "stock") return id.includes("stock") || id.includes("voice") || id.includes("general");
    if (branch === "industry") return id.includes("industry") || id.includes("stock") || id.includes("voice");
    if (branch === "commodity") return id.includes("commodity") || id.includes("voice");
    return true;
  });
}
