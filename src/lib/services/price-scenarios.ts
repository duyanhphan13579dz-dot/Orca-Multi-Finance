import type { OhlcvBar } from "../types";

export type PriceScenario = {
  label: "Bull" | "Base" | "Bear";
  title: string;
  horizon: string;
  probabilityRange: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  priceRegime: string;
  technicalCauses: string[];
  fundamentalCauses: string[];
  triggers: string[];
  invalidationSignals: string[];
  priceZones: string[];
  actionPlan: string[];
  tasks: string[];
  evidence: string[];
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
};

type ScenarioInput = {
  price: number | null;
  bars: OhlcvBar[];
  technical: any;
  health: any;
  revYoy: number | null;
  niYoy: number | null;
  pe: number | null;
  risks: string[];
  catalysts: string[];
};

const f = (v: number | null | undefined, d = 0) => v != null && Number.isFinite(v) ? v.toLocaleString("vi-VN", { maximumFractionDigits: d }) : "UNAVAILABLE";
const pct = (v: number | null | undefined) => v != null && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "UNAVAILABLE";

export function buildPriceScenarios(input: ScenarioInput): PriceScenario[] {
  const { price, technical: t, health, revYoy, niYoy, pe, risks, catalysts } = input;
  const sma20 = t?.sma?.sma20 ?? null;
  const sma50 = t?.sma?.sma50 ?? null;
  const support = t?.support?.slice?.(0, 2) ?? [];
  const resistance = t?.resistance?.slice?.(0, 2) ?? [];
  const trend = t?.trend?.label ?? "UNAVAILABLE";
  const techAvailable = Boolean(t && (sma20 != null || t.rsi14 != null || t.macd));
  const fundamentalAvailable = Boolean(health || revYoy != null || niYoy != null || pe != null);
  const above50 = price != null && sma50 != null && price >= sma50;
  const growth = (revYoy ?? 0) > 0 || (niYoy ?? 0) > 0;
  const deterioration = (revYoy ?? 0) < -0.05 || (niYoy ?? 0) < -0.08;
  const quality = techAvailable && fundamentalAvailable ? "MEDIUM" : "LOW";
  const commonEvidence = [
    `Giá hiện tại: ${f(price)}; xu hướng: ${trend}.`,
    `Tăng trưởng DT: ${pct(revYoy)}; LNST: ${pct(niYoy)}; P/E: ${pe != null ? `${pe.toFixed(1)}x` : "UNAVAILABLE"}.`,
  ];
  return [
    {
      label: "Bull", title: "Tăng giá có xác nhận", horizon: "1–3 tháng", probabilityRange: above50 && growth ? "35–50%" : "20–35%", confidence: quality,
      priceRegime: "Breakout / tăng theo xu hướng",
      technicalCauses: [above50 ? `Giá đang trên SMA50${sma20 != null ? ` (${f(sma50)})` : ""}, cấu trúc tăng được giữ.` : "Cần vượt SMA20/SMA50 để xác nhận đảo chiều.", `Xác nhận ưu tiên: vượt ${resistance[0] != null ? f(resistance[0]) : "kháng cự gần"} kèm thanh khoản tăng.`],
      fundamentalCauses: [growth ? `DT/LNST đang cải thiện (DT ${pct(revYoy)}, LNST ${pct(niYoy)}), hỗ trợ kỳ vọng lợi nhuận.` : "Chưa có tăng trưởng đồng thuận; động lực cơ bản cần được xác minh bằng BCTC/guidance.", catalysts[0] ? `Catalyst cần kiểm chứng: ${catalysts[0].replace(/^•\s*/, "")}` : "Catalyst cụ thể: UNAVAILABLE."],
      triggers: [`Đóng cửa vượt ${resistance[0] != null ? f(resistance[0]) : "kháng cự gần"} với volume cao hơn trung bình.`, "BCTC/guidance không xấu hơn kỳ vọng."],
      invalidationSignals: [`False-breakout hoặc đóng cửa dưới ${support[0] != null ? f(support[0]) : "hỗ trợ gần"}.`, "LNST/OCF suy giảm mạnh hoặc catalyst bị hủy."],
      priceZones: [`Kháng cự xác nhận: ${resistance[0] != null ? f(resistance[0]) : "UNAVAILABLE"}.`, `Hỗ trợ bảo vệ: ${support[0] != null ? f(support[0]) : "UNAVAILABLE"}.`],
      actionPlan: ["Chỉ nâng tỷ trọng từng phần sau khi trigger được xác nhận; không mua đuổi trong phiên tăng nóng.", "Đặt điểm dừng theo hỗ trợ/invalidation, không dùng giá mục tiêu minh họa làm cam kết."],
      tasks: ["Theo dõi breakout và volume cuối phiên.", "Đối chiếu BCTC/guidance với tăng trưởng doanh thu, biên lợi nhuận và OCF.", "Cập nhật lại kịch bản nếu mất hỗ trợ hoặc catalyst thay đổi."], evidence: commonEvidence, dataQuality: quality,
    },
    {
      label: "Base", title: "Đi ngang / tích lũy", horizon: "2–8 tuần", probabilityRange: above50 === growth ? "30–45%" : "35–55%", confidence: quality,
      priceRegime: "Sideway trong vùng hỗ trợ–kháng cự",
      technicalCauses: [sma20 != null && sma50 != null ? `Giá cần dao động quanh SMA20 ${f(sma20)} và SMA50 ${f(sma50)} để tích lũy.` : "Chuỗi chỉ báo kỹ thuật chưa đủ để xác định biên tích lũy.", "Thanh khoản/độ rộng chưa xác nhận xu hướng mới."],
      fundamentalCauses: [fundamentalAvailable ? `Nền tảng hiện tại chưa đủ tạo re-rating nhanh; DT ${pct(revYoy)}, LNST ${pct(niYoy)}.` : "Thiếu BCTC/định giá để đánh giá nền tảng.", "Chờ catalyst mới hoặc kết quả kinh doanh xác nhận."],
      triggers: [`Breakout khỏi ${resistance[0] != null ? f(resistance[0]) : "kháng cự"} hoặc breakdown dưới ${support[0] != null ? f(support[0]) : "hỗ trợ"}.`, "Thanh khoản tăng đồng thuận với hướng phá vỡ."],
      invalidationSignals: ["Biên dao động bị phá vỡ kèm đóng cửa xác nhận.", "Dữ liệu cơ bản mới làm thay đổi đáng kể luận điểm."],
      priceZones: [`Hỗ trợ: ${support.length ? support.map((x: number) => f(x)).join("–") : "UNAVAILABLE"}.`, `Kháng cự: ${resistance.length ? resistance.map((x: number) => f(x)).join("–") : "UNAVAILABLE"}.`],
      actionPlan: ["Ưu tiên quan sát hoặc giải ngân nhỏ trong vùng hỗ trợ khi rủi ro đã được xác định.", "Không tăng vị thế chỉ vì giá đi ngang; chờ tín hiệu xác nhận."],
      tasks: ["Ghi nhận biên giá và volume theo ngày/tuần.", "Theo dõi kỳ BCTC tiếp theo, biên gộp, LNST và OCF.", "Đặt cảnh báo breakout/breakdown."], evidence: commonEvidence, dataQuality: quality,
    },
    {
      label: "Bear", title: "Giảm giá / bảo toàn vốn", horizon: "1–8 tuần", probabilityRange: deterioration || !above50 ? "35–55%" : "20–35%", confidence: quality,
      priceRegime: "Breakdown / xu hướng giảm",
      technicalCauses: [!above50 ? "Giá dưới SMA50 hoặc xu hướng chưa hồi phục, lực cung chiếm ưu thế." : "Rủi ro giảm tăng nếu mất SMA50 và hỗ trợ chính.", `Tín hiệu cảnh báo: đóng cửa dưới ${support[0] != null ? f(support[0]) : "hỗ trợ gần"} kèm volume tăng.`],
      fundamentalCauses: [deterioration ? `DT/LNST suy giảm (DT ${pct(revYoy)}, LNST ${pct(niYoy)}), có thể kéo giảm kỳ vọng định giá.` : "Chưa ghi nhận đủ suy giảm cơ bản; vẫn cần xác minh rủi ro từ BCTC/guidance.", risks[0] ? `Rủi ro cần kiểm chứng: ${risks[0].replace(/^•\s*/, "")}` : "Rủi ro doanh nghiệp/ngành: UNAVAILABLE."],
      triggers: [`Đóng cửa dưới ${support[0] != null ? f(support[0]) : "hỗ trợ chính"} và không hồi phục trong 1–2 phiên.`, "BCTC/OCF xấu đi hoặc catalyst tích cực không thành hiện thực."],
      invalidationSignals: [`Giành lại ${sma50 != null ? f(sma50) : "SMA50"} với volume cải thiện.`, "BCTC xác nhận tăng trưởng và biên lợi nhuận phục hồi."],
      priceZones: [`Mốc rủi ro: ${support[0] != null ? f(support[0]) : "UNAVAILABLE"}.`, `Mốc hồi phục: ${sma50 != null ? f(sma50) : "UNAVAILABLE"}.`],
      actionPlan: ["Ưu tiên bảo toàn vốn, không bắt đáy khi chưa có xác nhận đảo chiều.", "Rà soát tỷ trọng và điểm dừng theo kế hoạch rủi ro cá nhân; không coi đây là lệnh bán tự động."],
      tasks: ["Kiểm tra đóng cửa dưới hỗ trợ và volume.", "Rà soát nợ, chi phí lãi vay, biên lợi nhuận và OCF.", "Cập nhật tin doanh nghiệp/ngành; chỉ nâng hạng khi invalidation xuất hiện."], evidence: commonEvidence, dataQuality: quality,
    },
  ];
}

export function buildScenarioSummary(scenarios: PriceScenario[]) {
  return { currentRegime: scenarios[1]?.priceRegime ?? "UNAVAILABLE", primaryScenario: scenarios[1]?.label ?? "Base", watchItems: scenarios.flatMap((s) => s.triggers).slice(0, 4) };
}

export type { ScenarioInput };
