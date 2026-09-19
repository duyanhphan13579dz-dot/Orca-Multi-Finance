import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";
import type { MorningIntelSlice } from "./morning-brief-composer";
import type { DailyReport } from "./report-engine";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

export type ScenarioOutcome = "BASE_HIT" | "BULL_HIT" | "BEAR_HIT" | "UNCLEAR";

export interface MarketSummaryCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  intel: MorningIntelSlice;
  morningReport: DailyReport | null;
}

const pct = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: digits });
const bigVnd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} nghìn tỷ`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} tỷ`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)} triệu`;
  return num(v);
};

const BANNED = [
  /có thể tăng hoặc giảm/i,
  /nên thận trọng(?!.*(khi|nếu|ngưỡng))/i,
  /cần quan sát thêm(?!.*(chỉ số|ngưỡng|vùng|độ rộng|thanh khoản))/i,
  /khá (tích cực|tiêu cực|mạnh|yếu)/i,
  /tương đối (mạnh|yếu|ổn định)/i,
];

function sanitize(paras: string[]): string[] {
  return paras
    .map((p) => {
      let out = p;
      for (const re of BANNED) out = out.replace(re, "[đã lọc cụm mơ hồ]");
      return out;
    })
    .filter((p) => p.trim().length > 0);
}

function outcomeLabel(o: ScenarioOutcome): string {
  switch (o) {
    case "BASE_HIT":
      return "ĐÚNG kịch bản Cơ sở sáng";
    case "BULL_HIT":
      return "Kịch bản Tích cực đã kích hoạt";
    case "BEAR_HIT":
      return "Kịch bản Tiêu cực đã kích hoạt";
    default:
      return "CHƯA RÕ so với kịch bản sáng";
  }
}

/** Score which morning scenario best matches the closed session */
function scoreScenarioOutcome(ctx: MarketSummaryCtx): {
  outcome: ScenarioOutcome;
  note: string;
} {
  const idx = ctx.snap.indices?.find((i) => i.code === "VNINDEX") ?? ctx.snap.indices?.[0] ?? null;
  const change = idx?.changePercent ?? null;
  const br = ctx.intel.breadth;
  const morning = ctx.morningReport;

  if (!idx || change == null) {
    return { outcome: "UNCLEAR", note: "Thiếu VN-Index đóng cửa — không chấm được scorecard sáng." };
  }

  const scenarios = morning?.scenarios ?? [];
  const baseSc = scenarios.find((s) => s.label === "Base");
  const bullSc = scenarios.find((s) => s.label === "Bull");
  const bearSc = scenarios.find((s) => s.label === "Bear");

  let s1 = idx.value * 0.99;
  let r1 = idx.value * 1.01;
  if (morning?.sections) {
    const blob = morning.sections
      .filter((s) => /Nhận định nhanh|Header/i.test(s.heading))
      .flatMap((s) => s.paragraphs)
      .join(" ");
    const s1m = blob.match(/S1\s*≈?\s*([\d.]+)/i);
    const r1m = blob.match(/R1\s*≈?\s*([\d.]+)/i);
    if (s1m) s1 = Number(s1m[1]);
    if (r1m) r1 = Number(r1m[1]);
  }

  const breadthNarrow =
    br?.available && br.advancers + br.decliners > 0
      ? br.advancers / (br.advancers + br.decliners) < 0.4
      : false;
  const breadthWide =
    br?.available && br.advancers + br.decliners > 0
      ? br.advancers / (br.advancers + br.decliners) > 0.6
      : false;

  if (change <= -1 || (idx.value < s1 && breadthNarrow)) {
    return {
      outcome: "BEAR_HIT",
      note: bearSc
        ? `Kịch bản Tiêu cực sáng (${bearSc.probabilityRange}) khớp: đóng ${pct(change)}, dưới/gần S1 ≈ ${num(s1)}.`
        : `Đóng ${pct(change)} + độ rộng hẹp — nghiêng kịch bản tiêu cực.`,
    };
  }
  if (change >= 1 || (idx.value > r1 && breadthWide)) {
    return {
      outcome: "BULL_HIT",
      note: bullSc
        ? `Kịch bản Tích cực sáng (${bullSc.probabilityRange}) khớp: đóng ${pct(change)}, trên/gần R1 ≈ ${num(r1)}.`
        : `Đóng ${pct(change)} + độ rộng mở — nghiêng kịch bản tích cực.`,
    };
  }

  return {
    outcome: "BASE_HIT",
    note: baseSc
      ? `Đúng như kịch bản Cơ sở nêu buổi sáng (${baseSc.probabilityRange}): biên ${pct(change)}, chưa phá S1/R1 rõ.`
      : `Biên ${pct(change)} trong ±1% — khớp nhịp Cơ sở / chưa kích hoạt Bull hay Bear.`,
  };
}

/**
 * Market Summary — 11 blocks, end-of-day scorecard vs Morning Brief,
 * intraday timeline, final flow, draft tomorrow scenarios, handoff list.
 */
export function composeMarketSummaryFramework(
  ctx: MarketSummaryCtx,
  baseAssumptions: string[],
): { sections: Section[]; assumptions: string[] } {
  const assumptions = [...baseAssumptions];
  const { snap, intel } = ctx;
  const p = snap.pulse;
  const idx = snap.indices?.find((i) => i.code === "VNINDEX") ?? snap.indices?.[0] ?? null;
  const vn30 = snap.indices?.find((i) => i.code === "VN30") ?? null;
  const hnx = snap.indices?.find((i) => /HNX/.test(i.code)) ?? null;
  const tone: "up" | "down" | "neutral" =
    p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral";

  const { outcome, note: outcomeNote } = scoreScenarioOutcome(ctx);
  const outcomeVi = outcomeLabel(outcome);

  const sections: Section[] = [];

  // ——— Block 0: Header ———
  sections.push({
    heading: "0. Header",
    tone,
    paragraphs: sanitize([
      `Ngày: ${ctx.dateVi} · Phiên đóng cửa · Trạng thái phiên: ${snap.vnSession?.labelVi ?? ctx.sessionState}`,
      `VN-Index: ${idx ? `${num(idx.value)} (${pct(idx.changePercent)})` : "UNAVAILABLE"}${vn30 ? ` · VN30 ${num(vn30.value)} (${pct(vn30.changePercent)})` : ""}`,
      `Trạng thái so với kịch bản sáng: ${outcomeVi}`,
      outcomeNote,
      ctx.morningReport
        ? `Đối chiếu Morning Brief: «${ctx.morningReport.title}»`
        : "Chưa có Morning Brief cùng ngày trong kho — scorecard suy từ biên đóng cửa & độ rộng.",
    ]),
  });

  // ——— Block 1: Điểm tin đóng cửa 60s ———
  const bullets: string[] = [];
  if (idx) {
    bullets.push(
      `Chỉ số: VN-Index đóng ${num(idx.value)} điểm (${pct(idx.changePercent)}, Δ ${idx.change >= 0 ? "+" : ""}${num(idx.change)}).`,
    );
  } else {
    bullets.push("Chỉ số: VN-Index UNAVAILABLE — không suy diễn điểm đóng cửa.");
  }
  if (intel.flow?.available && intel.flow.foreignNet != null) {
    bullets.push(
      `Dòng tiền: khối ngoại ròng ${bigVnd(intel.flow.foreignNet)} · tự doanh ${intel.flow.propNet != null ? bigVnd(intel.flow.propNet) : "—"}.`,
    );
  } else if (intel.liquidity?.valueTraded != null) {
    bullets.push(`Thanh khoản: GTGD ${bigVnd(intel.liquidity.valueTraded)} VND (ước lượng phiên).`);
  } else {
    bullets.push("Dòng tiền/GTGD: chưa có số final — block chi tiết bên dưới đánh dấu rõ.");
  }
  const pos = intel.contributors?.positive?.slice(0, 3) ?? [];
  const neg = intel.contributors?.negative?.slice(0, 3) ?? [];
  if (pos.length) {
    bullets.push(`Nhóm dẫn: ${pos.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`);
  } else if (intel.breadth?.available) {
    bullets.push(
      `Độ rộng: ${intel.breadth.advancers}↑ / ${intel.breadth.decliners}↓${intel.breadth.regimeVi ? ` · ${intel.breadth.regimeVi}` : ""}.`,
    );
  } else {
    bullets.push("Ngành/độ rộng: chưa đủ board để nêu nhóm dẫn.");
  }
  if (neg.length) {
    bullets.push(`Mã đáng chú ý (kéo lùi): ${neg.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`);
  } else if ((snap.news ?? []).length) {
    bullets.push(`Tin cuối phiên: ${(snap.news![0].title ?? "").slice(0, 90)}.`);
  } else {
    bullets.push("Cổ phiếu đáng chú ý: chưa gắn được mã từ tin/board cuối phiên.");
  }
  bullets.push(
    "Việc cần chuẩn bị phiên mai: xem Block 10 (bàn giao lịch/sự kiện) + cập nhật quốc tế qua đêm trong Morning Brief mai.",
  );
  sections.push({
    heading: "1. Điểm tin đóng cửa (60 giây)",
    tone,
    paragraphs: sanitize(bullets.slice(0, 5).map((b) => `• ${b}`)),
  });

  // ——— Block 2: Timeline theo khung giờ (unique to Market Summary) ———
  // We don't have true bar-by-bar session tape; reconstruct honestly from close + breadth + pulse
  const chg = idx?.changePercent ?? null;
  const timeline: string[] = [];
  timeline.push(
    `ATO (09:00–09:15): ${idx ? `Chỉ số tham chiếu quanh ${num(idx.value)} — mở cửa thường phản ánh gap quốc tế/overnight; chi tiết nến ATO chưa có tape LIVE.` : "UNAVAILABLE — thiếu chỉ số."}`,
  );
  if (chg != null && chg > 0.3) {
    timeline.push(
      `Phiên sáng (09:15–11:30): Đà tăng được duy trì đến nghỉ trưa (đóng cửa ${pct(chg)}) — cần đối chiếu độ rộng: ${intel.breadth?.available ? `${intel.breadth.advancers}↑/${intel.breadth.decliners}↓` : "chưa có"}.`,
    );
  } else if (chg != null && chg < -0.3) {
    timeline.push(
      `Phiên sáng (09:15–11:30): Áp lực bán chiếm ưu thế trước nghỉ trưa (đóng ${pct(chg)}) — độ rộng ${intel.breadth?.available ? `${intel.breadth.advancers}↑/${intel.breadth.decliners}↓` : "chưa có"}.`,
    );
  } else {
    timeline.push(
      `Phiên sáng (09:15–11:30): Biên hẹp / phân hóa (${chg != null ? pct(chg) : "—"}) — chưa xác nhận xu hướng một phía trước nghỉ trưa.`,
    );
  }
  timeline.push(
    "Nghỉ trưa → mở cửa chiều: Tâm lý chuyển giao thường phụ thuộc tin giữa phiên và trạng thái khối ngoại; không có tape phút → không suy diễn đảo chiều nếu thiếu bằng chứng.",
  );
  if (chg != null && Math.abs(chg) >= 0.5) {
    timeline.push(
      `Phiên chiều (13:00–14:30): Đóng cửa ${pct(chg)} cho thấy xu hướng ${chg > 0 ? "tăng" : "giảm"} được ${chg > 0 ? "giữ" : "duy trì"}/mở rộng so với tham chiếu — xác nhận thêm qua thanh khoản & ATC.`,
    );
  } else {
    timeline.push(
      `Phiên chiều (13:00–14:30): Không có đảo chiều mạnh so với nhịp sáng trên dữ liệu đóng cửa hiện có (${chg != null ? pct(chg) : "—"}).`,
    );
  }
  timeline.push(
    "ATC (14:30–14:45): Lực mua/bán ATC và biến động phút cuối chưa tách được từ snapshot đóng cửa — khi có ATC tape sẽ bổ sung.",
  );
  sections.push({
    heading: "2. Diễn biến trong phiên theo khung giờ",
    tone: "neutral",
    paragraphs: sanitize(timeline),
  });

  // ——— Block 3: Độ rộng & vốn hóa ———
  const breadthParas: string[] = [];
  if (intel.breadth?.available) {
    const b = intel.breadth;
    const ratio = b.adRatio == null ? "—" : b.adRatio >= 10 ? ">10" : b.adRatio.toFixed(2);
    breadthParas.push(
      `Độ rộng cả phiên: ${b.advancers}↑ / ${b.decliners}↓ / ${b.unchanged ?? 0}— · A/D ${ratio}${b.regimeVi ? ` · ${b.regimeVi}` : ""}.`,
    );
  } else {
    breadthParas.push("Độ rộng: UNAVAILABLE — không ước lượng trần/sàn khi thiếu session-stats.");
  }
  if (vn30) breadthParas.push(`VN30: ${num(vn30.value)} (${pct(vn30.changePercent)}).`);
  if (hnx) breadthParas.push(`${hnx.code}: ${num(hnx.value)} (${pct(hnx.changePercent)}).`);
  breadthParas.push(
    "VN30 vs VNMID vs VNSML cả phiên: chưa có bộ chỉ số mid/small LIVE đầy đủ — không suy diễn rotation vốn hóa.",
  );
  sections.push({
    heading: "3. Độ rộng & nhóm vốn hóa",
    tone: "neutral",
    paragraphs: sanitize(breadthParas),
  });

  // ——— Block 4: Dòng tiền cả phiên (final) ———
  const flowParas: string[] = [];
  if (intel.flow?.available) {
    const f = intel.flow;
    flowParas.push(
      `Khối ngoại ròng (số liệu gần final): ${f.foreignNet != null ? bigVnd(f.foreignNet) : "—"} · tự doanh ${f.propNet != null ? bigVnd(f.propNet) : "—"} · ETF ${f.etfNet != null ? bigVnd(f.etfNet) : "—"}.`,
    );
    if (f.note) flowParas.push(f.note.slice(0, 240));
    flowParas.push(
      "Top 5 mua/bán chi tiết & chuỗi phiên liên tiếp: bổ sung khi foreign-flow connector trả đủ bảng mã.",
    );
  } else {
    flowParas.push("Dòng tiền final: UNAVAILABLE — không dùng ước tính intraday thay số chốt.");
  }
  if (intel.liquidity?.available && intel.liquidity.valueTraded != null) {
    flowParas.push(`GTGD phiên: ${bigVnd(intel.liquidity.valueTraded)} · ${intel.liquidity.note}`);
  }
  flowParas.push("Dòng tiền 17 ngành ICB: chờ sector-flow engine — không bịa % ngành.");
  sections.push({
    heading: "4. Dòng tiền cả phiên",
    tone: "neutral",
    paragraphs: sanitize(flowParas),
  });

  // ——— Block 5: Ngành nổi bật (proxy via contributors) ———
  const sectorParas: string[] = [];
  if (pos.length || neg.length) {
    if (pos.length) {
      sectorParas.push(
        `Nhóm dẫn dắt (proxy mã mạnh): ${pos.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`,
      );
    }
    if (neg.length) {
      sectorParas.push(
        `Nhóm kéo lùi (proxy): ${neg.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`,
      );
    }
    sectorParas.push(
      "Phân ngành ICB chính thức + % ngành: khi sector taxonomy LIVE sẽ thay proxy mã bằng ngành dẫn/lag.",
    );
  } else {
    sectorParas.push("Chưa đủ contributors/board để xếp top ngành — không liệt kê ngành giả.");
  }
  sections.push({
    heading: "5. Ngành nổi bật",
    tone: "neutral",
    paragraphs: sanitize(sectorParas),
  });

  // ——— Block 6: Cổ phiếu đáng chú ý ———
  const stockParas: string[] = [];
  const tagged = [
    ...new Set(
      (snap.news ?? [])
        .flatMap((n) => n.relatedSymbols ?? [])
        .filter((s) => s.length >= 3 && s.length <= 4),
    ),
  ].slice(0, 6);
  if (pos.length) {
    stockParas.push(
      ...pos.slice(0, 3).map((c) => `• ${c.symbol}: ${pct(c.changePercent)} — biến động mạnh (proxy đóng góp); lý do tin/dòng tiền cần đối chiếu riêng.`),
    );
  }
  if (neg.length) {
    stockParas.push(
      ...neg.slice(0, 2).map((c) => `• ${c.symbol}: ${pct(c.changePercent)} — áp lực giảm; chưa gán nguyên nhân nếu thiếu tin.`),
    );
  }
  if (tagged.length) {
    stockParas.push(`Mã gắn tin trong ngày: ${tagged.join(", ")}.`);
  }
  if (!stockParas.length) {
    stockParas.push("Không có mã đạt ngưỡng chú ý từ board/tin — không suy đoán biến động bất thường.");
  }
  sections.push({
    heading: "6. Cổ phiếu đáng chú ý",
    tone: "neutral",
    paragraphs: sanitize(stockParas),
  });

  // ——— Block 7: Phái sinh cuối phiên ———
  sections.push({
    heading: "7. Phái sinh cuối phiên",
    tone: "neutral",
    paragraphs: sanitize([
      "VN30F1M đóng cửa / basis / OI: connector phái sinh chưa gắn — block UNAVAILABLE.",
      "Khi LIVE: basis cuối phiên (so đầu phiên), Δ OI, tín hiệu thận trọng nếu basis âm sâu → nêu rõ ở Block 9.",
    ]),
  });

  // ——— Block 8: Hàng hóa & tỷ giá — chỉ delta đáng kể ———
  const deltaParas: string[] = [];
  const comms = snap.commodities ?? [];
  const movers = comms
    .filter((c) => c.changePercent != null && Math.abs(c.changePercent) >= 0.5)
    .sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!))
    .slice(0, 5);
  for (const c of movers) {
    deltaParas.push(
      `• ${c.name ?? c.symbol}: ${pct(c.changePercent)} (giá ${c.price != null ? num(c.price, 2) : "—"}).`,
    );
  }
  if (snap.forex?.usdStrengthNote) {
    // Only include if it looks like a concrete change note
    const note = snap.forex.usdStrengthNote;
    if (/\d/.test(note)) deltaParas.push(`• FX: ${note.slice(0, 140)}`);
  }
  if (!deltaParas.length) {
    // Framework: if no material change → skip block content (don't write "không đổi" filler)
    deltaParas.push(
      "Không có biến động hàng hóa/tỷ giá ≥0.5% đáng kể so với cửa sổ theo dõi — bỏ qua bảng lặp Morning Brief.",
    );
  }
  sections.push({
    heading: "8. Hàng hóa & tỷ giá cuối ngày (delta)",
    tone: "neutral",
    paragraphs: sanitize(deltaParas),
  });

  // ——— Block 9: Nhận định kỹ thuật cuối ngày & kịch bản phiên mai (sơ bộ) ———
  const s1 = idx ? Math.round(idx.value * 0.99) : null;
  const s2 = idx ? Math.round(idx.value * 0.98) : null;
  const r1 = idx ? Math.round(idx.value * 1.01) : null;
  const r2 = idx ? Math.round(idx.value * 1.02) : null;
  const pip = Math.max(-1, Math.min(1, p.score));
  const baseP = Math.round(Math.max(30, Math.min(60, 58 - Math.abs(pip) * 22)));
  const bullP = Math.round(Math.max(10, Math.min(45, 21 + (pip > 0 ? pip * 20 : 0))));
  const bearP = Math.max(1, 100 - baseP - bullP);

  const techParas = [
    `TRẠNG THÁI CUỐI PHIÊN: ${outcomeVi} — ${outcomeNote}`,
    s1 != null
      ? `VÙNG KỸ THUẬT CẬP NHẬT: Hỗ trợ S1 ≈ ${s1} · S2 ≈ ${s2} · Kháng cự R1 ≈ ${r1} · R2 ≈ ${r2} (cơ sở % quanh đóng cửa; thay bằng MA/POC khi đủ chuỗi).`
      : "VÙNG KỸ THUẬT: Chưa cập nhật — thiếu VN-Index đóng cửa.",
    `KỊCH BẢN PHIÊN MAI (sơ bộ — Morning Brief mai sẽ cập nhật sau dữ liệu quốc tế qua đêm):`,
    `• Cơ sở (${baseP - 5}–${baseP + 5}%): duy trì biên quanh đóng cửa; chờ xác nhận độ rộng + KL đầu phiên.`,
    `• Tích cực (${bullP - 4}–${bullP + 4}%): kích hoạt nếu vượt R1 kèm độ rộng mở.`,
    `• Tiêu cực (${bearP - 3}–${bearP + 3}%): kích hoạt nếu mất S1 kèm bán lan tỏa.`,
    "Đây là bản nháp — không thay thế Morning Brief mai (cần thêm US/Asia overnight).",
  ];
  sections.push({
    heading: "9. Nhận định kỹ thuật cuối ngày & kịch bản phiên mai",
    tone,
    paragraphs: sanitize(techParas),
  });

  // ——— Block 10: Việc cần chú ý đêm nay / mai (handoff) ———
  const handoff: string[] = [
    "Sự kiện kinh tế quốc tế đêm nay (Fed/data US-Asia): kiểm tra lịch thủ công — connector calendar chưa đủ.",
    "BCTC / ĐHCĐ / GDKHQ ngày mai: theo dõi danh sách công bố trên HOSE/HNX.",
    "Đáo hạn phái sinh / cơ cấu ETF sắp tới: ghi nhớ nếu trong tuần đáo hạn VN30F.",
  ];
  const news = (snap.news ?? []).slice(0, 3);
  for (const n of news) {
    handoff.push(`Tin bàn giao: ${(n.title ?? "").slice(0, 100)} (${n.source}).`);
  }
  handoff.push(
    "Morning Brief mai sẽ mở rộng Block Lịch sự kiện từ danh sách này — Market Summary chỉ nêu tên, không phân tích sâu.",
  );
  sections.push({
    heading: "10. Việc cần chú ý đêm nay / mai",
    tone: "neutral",
    paragraphs: sanitize(handoff),
  });

  // ——— Block 11: Disclaimer ———
  sections.push({
    heading: "11. Disclaimer",
    tone: "neutral",
    paragraphs: [
      "Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư. Mọi quyết định mua/bán thuộc về nhà đầu tư và khẩu vị rủi ro cá nhân.",
    ],
  });

  if (!ctx.morningReport) {
    assumptions.push(
      "Chưa neo được Morning Brief cùng ngày — scorecard kịch bản suy từ biên đóng cửa và độ rộng.",
    );
  }
  if (outcome === "BEAR_HIT" || outcome === "BULL_HIT") {
    assumptions.push(`Scorecard công khai: ${outcomeVi}.`);
  }

  return { sections, assumptions };
}
