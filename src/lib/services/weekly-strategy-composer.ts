/**
 * Weekly Strategy — 12-block framework (ORCA).
 * Aggregates weekly view from available market snapshot + prior strategy report.
 * No mock data; UNAVAILABLE when weekly series / prior score cannot be computed.
 */
import type { MarketSnapshot } from "./market";
import type { DailyReport } from "./report-engine";
import type { MorningIntelSlice } from "./morning-brief-composer";
import type { VnSessionState } from "../vn/sessions";

export interface WeeklyStrategyCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  intel: MorningIntelSlice;
  /** Latest prior strategy report (same type) for Block 10 self-score */
  priorStrategy: DailyReport | null;
  /** Same-week market_summary titles if available */
  weekSummaries: { title: string; generatedAt: string }[];
}

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "UNAVAILABLE";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "UNAVAILABLE";
  return n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

function weekRangeLabel(now = new Date()): { weekNo: number; range: string } {
  const vn = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const day = vn.getDay(); // 0 Sun
  const toMonOffset = day === 0 ? -6 : 1 - day;
  const mon = new Date(vn);
  mon.setDate(vn.getDate() + toMonOffset);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const start = new Date(vn.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((vn.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  const dd = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { weekNo, range: `${dd(mon)}–${dd(fri)}` };
}

function extractPriorScore(prior: DailyReport | null): number | null {
  if (!prior) return null;
  const blob = [
    ...prior.sections.flatMap((s) => s.paragraphs),
    ...(prior.assumptions ?? []),
  ].join(" ");
  const m = blob.match(/(\d)\s*\/\s*3/);
  if (m) return Number(m[1]);
  return null;
}

export function composeWeeklyStrategyFramework(
  ctx: WeeklyStrategyCtx,
  baseAssumptions: string[],
): { sections: Section[]; assumptions: string[] } {
  const sections: Section[] = [];
  const { snap, intel } = ctx;
  const idx = snap.indices?.[0];
  const pulse = snap.pulse;
  const tone: Section["tone"] =
    pulse.score > 0.15 ? "up" : pulse.score < -0.15 ? "down" : "neutral";
  const { weekNo, range } = weekRangeLabel();
  const priorScore = extractPriorScore(ctx.priorStrategy);

  // ——— Block 0 — Header ———
  const weekStatus =
    idx && idx.changePercent != null
      ? idx.changePercent > 0.3
        ? "Tăng"
        : idx.changePercent < -0.3
          ? "Giảm"
          : "Đi ngang"
      : "UNAVAILABLE";
  sections.push({
    heading: `Tuần #${weekNo} (${range})`,
    tone,
    paragraphs: [
      idx
        ? `VN-Index đóng gần nhất: ${fmtNum(idx.value)} (${fmtPct(idx.changePercent)} so phiên trước — số liệu phiên, chưa phải OHLC tuần đầy đủ).`
        : "VN-Index: UNAVAILABLE — không suy diễn đóng tuần khi thiếu dữ liệu chỉ số.",
      `Trạng thái tham chiếu: ${weekStatus} | Độ tin cậy tự đánh giá tuần trước: ${priorScore != null ? `${priorScore}/3 kịch bản` : "chưa có Weekly Strategy trước để chấm (0/3 mặc định khi phát hành lần đầu)"}.`,
    ],
  });

  // ——— Block 1 — 60s strategic points ———
  const foreignNet =
    intel.flow?.foreignNet != null
      ? `${fmtNum(intel.flow.foreignNet / 1e9, 1)} tỷ VND (ròng phiên gần nhất)`
      : "UNAVAILABLE";
  sections.push({
    heading: "1. Điểm chiến lược 60 giây",
    tone,
    paragraphs: [
      idx
        ? `• VN-Index: ${fmtNum(idx.value)} (${fmtPct(idx.changePercent)}) — cần chuỗi 5 phiên để khóa %tuần.`
        : "• VN-Index tuần: UNAVAILABLE.",
      `• Dòng vốn ngoại (phiên gần): ${foreignNet}.`,
      `• Sự kiện chi phối gần nhất: ${pulse.headline || "chưa gắn tin Tier-1 có impact_score — xem recap Market Summary trong tuần"}.`,
      priorScore != null
        ? `• Đánh giá kịch bản tuần trước: ${priorScore}/3 — xem Block 10.`
        : "• Đánh giá kịch bản tuần trước: chưa có bản trước (phát hành đầu).",
      `• Quan điểm tuần tới (sơ bộ): ${pulse.score > 0.2 ? "thiên về nắm giữ / chọn lọc" : pulse.score < -0.2 ? "thiên về phòng thủ / giảm tỷ trọng" : "tích lũy chọn lọc — chờ xác nhận độ rộng"}.`,
      "• Hành động ưu tiên: khóa vùng S/R khung tuần; không đuổi khi breadth thu hẹp; cập nhật lại sau phiên thứ Hai.",
    ],
  });

  // ——— Block 2 — Week overview ———
  const recapLines =
    ctx.weekSummaries.length > 0
      ? ctx.weekSummaries
          .slice(0, 5)
          .map(
            (s, i) =>
              `  ${i + 1}. ${new Date(s.generatedAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} — ${s.title}`,
          )
      : ["  (Chưa có đủ Market Summary trong tuần trên kho — recap 5 phiên: UNAVAILABLE)"];
  sections.push({
    heading: "2. Tổng quan diễn biến tuần",
    tone: "neutral",
    paragraphs: [
      "2.1 Hiệu suất tuần (khung tuần — một phần số liệu vẫn ở mức phiên nếu chưa có OHLC tuần):",
      idx
        ? `• Đóng gần nhất: ${fmtNum(idx.value)} | %phiên: ${fmtPct(idx.changePercent)} | %YTD: UNAVAILABLE (cần series tuần).`
        : "• OHLC tuần: UNAVAILABLE.",
      "• GTGD TB/phiên tuần vs tuần trước / TB 4 tuần: UNAVAILABLE khi thiếu chuỗi volume tuần.",
      "• Số phiên tăng/giảm trong tuần: tổng hợp khi đủ 5 Market Summary.",
      "• Mẫu hình nến tuần: UNAVAILABLE — cần nến tuần đóng cửa thứ Sáu.",
      "2.2 Recap tham chiếu (kéo từ Market Summary đã lưu):",
      ...recapLines,
    ],
  });

  // ——— Block 3 — News & events ———
  sections.push({
    heading: "3. Tin tức & sự kiện chi phối tuần",
    tone: "neutral",
    paragraphs: [
      "• Chính sách tiền tệ: Fed/SBV — tổng hợp từ các Morning Brief trong tuần; chi tiết từng tin không lặp lại. Điều này có ý nghĩa gì cho tuần tới: theo dõi lịch FOMC/CPI và tín hiệu OMO/lãi suất điều hành.",
      "• Vĩ mô: dữ liệu công bố trong tuần (VN + toàn cầu) vs dự báo — UNAVAILABLE nếu calendar connector chưa gắn. Ý nghĩa tuần tới: ưu tiên sự kiện có impact_score cao.",
      "• Doanh nghiệp/ngành: BCTC, M&A, chính sách ngành — xem khối tiêu điểm (Block 11).",
      "• Địa chính trị/thương mại: chỉ nêu khi có tin Tier-1; nếu không có → không suy diễn.",
    ],
  });

  // ——— Block 4 — Weekly flow ———
  const breadthLine =
    intel.breadth != null && intel.breadth.available
      ? `Độ rộng phiên gần: tăng ${intel.breadth.advancers} / giảm ${intel.breadth.decliners} (tham chiếu, không thay cho rotation tuần).`
      : "Độ rộng: UNAVAILABLE.";
  sections.push({
    heading: "4. Dòng vốn tuần",
    tone: "neutral",
    paragraphs: [
      `• Khối ngoại ròng (phiên gần): ${foreignNet}. So 4 tuần gần nhất / chuỗi tuần liên tiếp: UNAVAILABLE khi thiếu chuỗi flow tuần.`,
      "• Top 5 mua/bán ròng tuần: UNAVAILABLE — cần tổng hợp tape theo tuần.",
      intel.flow?.propNet != null
        ? `• Tự doanh CTCK (phiên gần): ${fmtNum(intel.flow.propNet / 1e9, 1)} tỷ VND.`
        : "• Tự doanh CTCK tuần: UNAVAILABLE.",
      "• Sector rotation (RRG Leading/Weakening/Lagging/Improving): UNAVAILABLE — module RRG chưa kết nối; không giả lập góc phần tư.",
      breadthLine,
      "• Margin: thay đổi ước tính — UNAVAILABLE nếu không có nguồn chính thức.",
    ],
  });

  // ——— Block 5 — Global & commodities week ———
  const globalLines: string[] = [];
  if (snap.crypto) {
    globalLines.push(
      `• Crypto composite: ${fmtPct(snap.crypto.summary.avgChangePercent)} (phiên/24h — chưa phải %tuần). Xu hướng: ${snap.crypto.summary.avgChangePercent >= 0 ? "tiếp diễn risk-on ngắn hạn" : "áp lực / đảo chiều ngắn hạn"}.`,
    );
  }
  for (const c of (snap.commodities ?? []).slice(0, 6)) {
    globalLines.push(
      `• ${c.name ?? c.symbol}: ${fmtNum(c.price)} (${fmtPct(c.changePercent)}) — xu hướng tuần: cần series tuần để khẳng định tiếp diễn/đảo chiều.`,
    );
  }
  if (!globalLines.length) globalLines.push("• Global/commodities tuần: UNAVAILABLE.");
  sections.push({
    heading: "5. Thị trường quốc tế & hàng hóa tuần",
    tone: "neutral",
    paragraphs: [
      "Bảng hiệu suất khung tuần (S&P/Nasdaq/Dow, DXY, UST10Y, VIX, Brent/WTI, vàng…): ưu tiên %tuần; dưới đây là snapshot gần nhất khi thiếu OHLC tuần.",
      ...globalLines,
    ],
  });

  // ——— Block 6 — Weekly technical ———
  const level =
    idx != null
      ? `S1 ≈ ${fmtNum(idx.value * 0.985, 0)} · S2 ≈ ${fmtNum(idx.value * 0.97, 0)} · R1 ≈ ${fmtNum(idx.value * 1.015, 0)} · R2 ≈ ${fmtNum(idx.value * 1.03, 0)} (ước lượng từ giá gần nhất — thay bằng đỉnh/đáy tuần + Fib tuần khi có nến tuần).`
      : "Vùng giá trị tuần: UNAVAILABLE.";
  sections.push({
    heading: "6. Phân tích kỹ thuật khung tuần",
    tone,
    paragraphs: [
      `XU HƯỚNG TUẦN: ${pulse.score > 0.25 ? "thiên uptrend ngắn hạn" : pulse.score < -0.25 ? "thiên downtrend ngắn hạn" : "sideway / chưa xác nhận"} — MA10/20/50 tuần: UNAVAILABLE (cần chuỗi tuần).`,
      `VÙNG GIÁ TRỊ: ${level}`,
      "ĐỘNG LƯỢNG TUẦN: RSI tuần / MACD tuần / phân kỳ — UNAVAILABLE khi thiếu series tuần; không copy nguyên kết luận daily từ Market Summary.",
      "CẤU TRÚC SÓNG: chỉ nêu khi có khung lớn hơn đã xác nhận; hiện tại: không ép sóng khi dữ liệu tuần mỏng.",
    ],
  });

  // ——— Block 7 — Macro cycle ———
  sections.push({
    heading: "7. Định vị chu kỳ vĩ mô",
    tone: "neutral",
    paragraphs: [
      "CHU KỲ THANH KHOẢN: Trung tính (mặc định khi thiếu tín hiệu OMO/lãi suất điều hành mới) — cập nhật khi có dữ liệu SBV.",
      "CHU KỲ KINH TẾ: tham chiếu PMI/xuất khẩu/FDI khi connector vĩ mô LIVE; hiện tại: không gán nhãn Phục hồi/Suy thoái nếu thiếu số.",
      "CHU KỲ ĐỊNH GIÁ: P/E VN-Index vs TB 5 năm — UNAVAILABLE (cần series định giá).",
      "=> HÀM Ý: ưu tiên khung sideway chọn lọc cho đến khi thanh khoản tuần và định giá được xác nhận bằng số liệu tuần.",
    ],
  });

  // ——— Block 8 — Next week calendar & risks ———
  sections.push({
    heading: "8. Lịch sự kiện & rủi ro tuần tới",
    tone: "neutral",
    paragraphs: [
      "• Kinh tế quốc tế: theo dõi FOMC / CPI / PMI / NFP nếu rơi vào tuần — giờ cụ thể cập nhật từ calendar khi LIVE.",
      "• Trong nước: mùa BCTC / ĐHCĐ / họp SBV — liệt kê mã có ngày công bố khi có nguồn.",
      "• Phái sinh/quỹ: đáo hạn VN30F / kỳ cơ cấu ETF nếu trùng tuần — kiểm tra lịch HOSE/HNX.",
      "• Rủi ro cần theo dõi:",
      "  1) Thanh khoản tuần suy yếu dưới TB 4 tuần → hạ tỷ trọng beta cao.",
      "  2) USD/VIX bật mạnh + ngoại bán ròng kéo dài → kiểm tra lại kịch bản Base.",
      "  3) Tin doanh nghiệp lớn lệch kỳ vọng BCTC → điều chỉnh phân bổ ngành (Block 9).",
    ],
  });

  // ——— Block 9 — Strategy next week ———
  const marketView =
    pulse.score > 0.25
      ? "Nắm giữ / chọn lọc tăng tỷ trọng nhóm có dòng tiền"
      : pulse.score < -0.25
        ? "Giảm tỷ trọng / Phòng thủ"
        : "Tích lũy thêm chọn lọc";
  const baseP = Math.round(Math.max(30, Math.min(60, 55 - Math.abs(pulse.score) * 20)));
  const bullP = Math.round(Math.max(10, Math.min(40, 22 + (pulse.score > 0 ? pulse.score * 18 : 0))));
  const bearP = Math.max(5, 100 - baseP - bullP);
  const zone =
    idx != null
      ? `${fmtNum(idx.value * 0.99, 0)}–${fmtNum(idx.value * 1.01, 0)}`
      : "[vùng UNAVAILABLE]";
  sections.push({
    heading: "9. Chiến lược tuần tới",
    tone,
    paragraphs: [
      `QUAN ĐIỂM THỊ TRƯỜNG: ${marketView}`,
      "KỊCH BẢN TUẦN TỚI:",
      `  • Cơ sở (${baseP}%): duy trì biên ${zone} nếu không có sốc vĩ mô và ngoại không bán mạnh liên tiếp.`,
      `  • Tích cực (${bullP}%): kích hoạt khi vượt R1 kèm độ rộng mở + thanh khoản trên TB → target hướng R2.`,
      `  • Tiêu cực (${bearP}%): kích hoạt khi mất S1 kèm bán lan rộng → target hướng S2.`,
      "PHÂN BỔ NGÀNH:",
      "  Overweight: nhóm có thanh khoản thực và câu chuyện riêng trong tuần (cập nhật khi có RRG/flow ngành tuần).",
      "  Neutral: ngân hàng lớn / blue-chip nền — giữ tỷ trọng tham chiếu.",
      "  Underweight: nhóm beta cao thanh khoản mỏng nếu Block 4 cho thấy rotation yếu.",
      `QUẢN TRỊ RỦI RO TUẦN: tỷ trọng cổ phiếu đề xuất ${pulse.score > 0.2 ? "55–70%" : pulse.score < -0.2 ? "30–45%" : "45–60%"}; ngưỡng cắt lỗ hệ thống theo tuần: ${idx ? fmtNum(idx.value * 0.97, 0) : "UNAVAILABLE"}.`,
      "Nhất quán Block 6–7–9: nếu kỹ thuật tuần mâu thuẫn chu kỳ vĩ mô → hạ conviction, không chọn một khối để bỏ qua hai khối còn lại.",
    ],
  });

  // ——— Block 10 — Prior week review (mandatory) ———
  const priorScenarios =
    ctx.priorStrategy?.scenarios?.length
      ? ctx.priorStrategy.scenarios.map(
          (sc) =>
            `  • ${sc.label} (${sc.probabilityRange}): ${sc.drivers} → ${sc.indexZones}`,
        )
      : ["  (Không có 3 kịch bản tuần trước trong kho — score mặc định 0/3 khi không đối chiếu được)"];
  sections.push({
    heading: "10. Đánh giá lại tuần trước (bắt buộc)",
    tone: "neutral",
    paragraphs: [
      "KỊCH BẢN TUẦN TRƯỚC:",
      ...priorScenarios,
      `KẾT QUẢ THỰC TẾ: ${idx ? `tham chiếu đóng gần nhất ${fmtNum(idx.value)} (${fmtPct(idx.changePercent)}) — đối chiếu đầy đủ khi có OHLC tuần.` : "UNAVAILABLE."}`,
      `ĐIỂM SỐ: ${priorScore != null ? `${priorScore}/3` : "0/3 (chưa có bản trước hoặc chưa gắn kết quả)"}.`,
      "DANH MỤC ĐỀ XUẤT TUẦN TRƯỚC: hiệu suất vs VN-Index — UNAVAILABLE nếu chưa lưu weekly picks có giá.",
      priorScore === 0
        ? "BÀI HỌC: tuần trước 0/3 — thừa nhận sai trước khi đưa quan điểm mới; kiểm tra lại biến số bị miss (dòng vốn / sự kiện / vùng giá)."
        : "BÀI HỌC: ghi nhận biến số đúng/sai; không đổ lỗi ‘thị trường khó lường’ — chỉ ra đúng biến số.",
    ],
  });

  // ——— Block 11 — Weekly picks ———
  const pickSyms =
    intel.contributors?.positive?.length
      ? intel.contributors.positive
          .slice(0, 5)
          .map((c) => c.symbol)
          .filter(Boolean)
          .join(", ")
      : "";
  sections.push({
    heading: "11. Cổ phiếu tiêu điểm tuần",
    tone: "neutral",
    paragraphs: [
      "Định dạng: Mã | Vùng mua | Cắt lỗ | Mục tiêu tuần | Catalyst (có ngày) | Luận điểm.",
      "Yêu cầu framework: mỗi mã phải gắn catalyst cụ thể rơi vào tuần (BCTC/ĐHCĐ/tin ngành) — không nhận định kỹ thuật thuần.",
      pickSyms
        ? `Tham chiếu thanh khoản/biến động gần (không phải khuyến nghị): ${pickSyms}.`
        : "Danh sách tiêu điểm có catalyst ngày cụ thể: UNAVAILABLE cho đến khi gắn calendar doanh nghiệp.",
    ],
  });

  // ——— Block 12 — Disclaimer ———
  sections.push({
    heading: "12. Disclaimer",
    tone: "neutral",
    paragraphs: ["Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư."],
  });

  const assumptions = [
    ...baseAssumptions,
    "Weekly Strategy tổng hợp khung tuần; số liệu chỉ có nghĩa theo ngày được đánh dấu và không thay thế OHLC/volume tuần.",
    "Block 10 (tự chấm điểm) là bắt buộc — phát hành lần đầu ghi 0/3 nếu không có bản trước.",
    `Cadence khuyến nghị: cut-off sau ATC thứ Sáu · phát hành Chủ Nhật 18:00–20:00 VN (hiện tại session: ${ctx.sessionState}).`,
  ];

  return { sections, assumptions };
}
