import "server-only";

/**
 * FINANCIAL KNOWLEDGE BASE — kiến thức TĨNH (methodology, định nghĩa, ngưỡng).
 * KHÔNG chứa dữ liệu realtime (giá, tỷ lệ, tin tức) — realtime chỉ đến từ
 * Data Engine → Tool Layer (không bao giờ đưa vào KB tĩnh).
 */

export interface KnowledgeEntry {
  id: string;
  category: "stock-analysis" | "personal-finance" | "wealth-management" | "data-quality";
  title: string;
  body: string;
  sources: string[]; // sách/chuẩn công bố (tham chiếu tĩnh)
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    id: "kb-ratio-definitions",
    category: "personal-finance",
    title: "Định nghĩa các chỉ số tài chính cá nhân",
    body: "Tỷ lệ tiết kiệm = dòng tiền tự do / thu nhập gộp. DTI = tổng trả nợ hàng tháng / thu nhập gộp. Quỹ khẩn cấp = tài sản thanh khoản / chi tiêu hàng tháng (tháng). Thanh khoản = tài sản thanh khoản / tổng tài sản. Đòn bẩy = tổng nợ / tổng tài sản. Ngưỡng tham chiếu: DTI ≤ 20% tốt, 36% là giới hạn vay thông thường; quỹ khẩn cấp 3–6 tháng; tiết kiệm ≥ 30% thu nhập.",
    sources: ["Consumer Financial Protection Bureau", "Financial Planning Standards Board"],
  },
  {
    id: "kb-valuation-warning",
    category: "stock-analysis",
    title: "Định giá — chỉ số đơn lẻ không kết luận",
    body: "P/E thấp có thể phản ánh rủi ro, không phải rẻ; P/B nhạy với điều chỉnh của vốn chủ; DCF nhạy với giả định tăng trưởng. Quy tắc: không kết luận 'mua/bán' từ một chỉ số; đối chiếu P/E với tăng trưởng (PEG), ROE, dòng tiền và vòng đời ngành. DCF theo kỳ vọng là MODEL-INFERENCE, luôn kèm kịch bản base/bear/bull.",
    sources: ["Damodaran — Equity Valuation", "Aswath Damodaran methodology notes"],
  },
  {
    id: "kb-diversification",
    category: "wealth-management",
    title: "Đa dạng hóa & tập trung",
    body: "Chỉ số Herfindahl-Hirschman (HHI) = tổng bình phương tỷ trọng (0–10000). HHI ≥ 1500 hoặc vị thế lớn nhất ≥ 25% → cần theo dõi; ≥ 50% một tài sản → tập trung cao. Kỳ vọng đa dạng hóa giảm rủi ro không hệ thống; rủi ro hệ thống không loại bỏ bằng đa dạng hóa. Target allocation theo tuổi/khẩu vị là model inference, không phải khuyến nghị.",
    sources: ["Markowitz — Modern Portfolio Theory", "U.S. DOJ HHI guidelines"],
  },
  {
    id: "kb-rebalancing",
    category: "wealth-management",
    title: "Tái cân bằng danh mục",
    body: "Tái cân bằng định kỳ (6–12 tháng) hoặc threshold (±5pp) nhằm giữ tỷ trọng mục tiêu, kiểm soát rủi ro khi một lớp tài sản tăng vọt. Tần suất quá cao tăng chi phí giao dịch/thuế. Khi tái cân bằng, ưu tiên giảm lớp quá lớn (cắt lãi có kỷ luật) và bổ sung lớp thiếu — không 'chốt lời' toàn bộ vì biến động ngắn hạn.",
    sources: ["Vanguard — Portfolio rebalancing research", "CFA Institute"],
  },
  {
    id: "kb-scenario-disclosure",
    category: "data-quality",
    title: "Phân loại bằng chứng trong phân tích",
    body: "FACT = dữ liệu quan sát được (giá, chỉ số tài chính, dữ liệu giao dịch). DATA-DRIVEN = suy luận trực tiếp từ phần cứng FACT (điểm sức khỏe, trọng số danh mục). MODEL-INFERENCE = mô hình/giả định (DCF, target allocation, quy tắc 100-trừ-tuổi). SCENARIO = kịch bản có điều kiện (shock %). OPINION = nhận định chủ quan. Cấm trộn nhãn; dữ liệu thiếu → DATA_UNAVAILABLE, không bù bằng suy đoán.",
    sources: ["ORCA data quality spec (internal)"],
  },
  {
    id: "kb-anti-hallucination",
    category: "data-quality",
    title: "Quy tắc chống ảo giác",
    body: "Mọi con số trong câu trả lời phải trace được về tool contract. LLM chỉ viết văn bản từ structured data; số lạ trong output → regenerate một lần, vẫn sai → fallback deterministic. Không có giá/khuyến nghị → trả DATA_UNAVAILABLE kèm lý do. Không quy đổi tiền thiếu tỷ giá hiện tại (dùng tỷ giá trong tool base nếu được cung cấp, ghi rõ).",
    sources: ["ORCA anti-hallucination spec (internal)"],
  },
];

export function searchKnowledge(category: string | null, query?: string): KnowledgeEntry[] {
  let rows = category ? KNOWLEDGE_BASE.filter((k) => k.category === category) : KNOWLEDGE_BASE;
  if (query) {
    const q = query.toLowerCase();
    rows = rows.filter(
      (k) =>
        k.title.toLowerCase().includes(q) ||
        k.body.toLowerCase().includes(q) ||
        k.sources.some((s) => s.toLowerCase().includes(q)),
    );
  }
  return rows;
}
