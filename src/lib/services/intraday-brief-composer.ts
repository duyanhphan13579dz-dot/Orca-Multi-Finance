import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";
import type { MorningIntelSlice } from "./morning-brief-composer";
import type { DailyReport, ReportScenario } from "./report-engine";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

export type ScenarioStatus = "ON_TRACK" | "DEVIATING" | "UNCLEAR";
export type IntradaySlot = "mid_morning" | "lunch" | "pre_atc" | "ad_hoc";

export interface IntradayCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  intel: MorningIntelSlice;
  /** Latest morning_brief body from DB (same day), if any */
  morningReport: DailyReport | null;
  slot: IntradaySlot;
  timeLabel: string; // HH:MM VN
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

/** Detect scheduled slot from VN hour */
export function detectIntradaySlot(vnHour: number, vnMinute: number): IntradaySlot {
  const t = vnHour * 60 + vnMinute;
  if (t >= 10 * 60 && t < 11 * 60) return "mid_morning";
  if (t >= 11 * 60 + 10 && t < 13 * 60) return "lunch";
  if (t >= 13 * 60 + 40 && t < 15 * 60) return "pre_atc";
  return "ad_hoc";
}

const SLOT_LABEL: Record<IntradaySlot, string> = {
  mid_morning: "Mid-morning (phản ứng đầu phiên)",
  lunch: "Trưa (tổng kết phiên sáng)",
  pre_atc: "Trước ATC",
  ad_hoc: "Ad-hoc / ngoài slot",
};

function statusLabel(s: ScenarioStatus): string {
  if (s === "ON_TRACK") return "ĐÚNG KỊCH BẢN";
  if (s === "DEVIATING") return "LỆCH KỊCH BẢN";
  return "CHƯA RÕ";
}

/** Infer scenario status vs morning brief pulse/scenarios + current index move */
function inferScenarioStatus(
  ctx: IntradayCtx,
): { status: ScenarioStatus; note: string; heldBase: boolean } {
  const idx = ctx.snap.indices?.find((i) => i.code === "VNINDEX") ?? ctx.snap.indices?.[0] ?? null;
  const change = idx?.changePercent ?? null;
  const br = ctx.intel.breadth;
  const morning = ctx.morningReport;

  if (!idx || change == null) {
    return {
      status: "UNCLEAR",
      note: "Thiếu VN-Index LIVE — không neo được kịch bản sáng.",
      heldBase: true,
    };
  }

  // Prefer morning scenarios if present
  const scenarios = morning?.scenarios ?? [];
  const baseSc = scenarios.find((s) => s.label === "Base");
  const bullSc = scenarios.find((s) => s.label === "Bull");
  const bearSc = scenarios.find((s) => s.label === "Bear");

  // Heuristic levels from morning indexZones text or ±1%
  let s1: number | null = idx.value * 0.99;
  let r1: number | null = idx.value * 1.01;
  if (morning?.sections) {
    const quick = morning.sections.find((s) => /Nhận định nhanh|Header/i.test(s.heading));
    const blob = (quick?.paragraphs ?? []).join(" ");
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

  // Strong deviation
  if (change <= -1 || (s1 != null && idx.value < s1 && breadthNarrow)) {
    return {
      status: "DEVIATING",
      note: bearSc
        ? `Đang nghiêng kịch bản Tiêu cực sáng (${bearSc.probabilityRange}): ${pct(change)}, gần/dưới S1.`
        : `Biến động ${pct(change)} + độ rộng hẹp — lệch kịch bản Cơ sở.`,
      heldBase: false,
    };
  }
  if (change >= 1 || (r1 != null && idx.value > r1 && breadthWide)) {
    return {
      status: "DEVIATING",
      note: bullSc
        ? `Đang nghiêng kịch bản Tích cực sáng (${bullSc.probabilityRange}): ${pct(change)}, gần/trên R1.`
        : `Biến động ${pct(change)} + độ rộng mở — lệch lên so với Cơ sở.`,
      heldBase: false,
    };
  }

  // Quiet / on track
  if (Math.abs(change) < 0.5) {
    return {
      status: "ON_TRACK",
      note: baseSc
        ? `Đi ngang trong biên kịch bản Cơ sở sáng (${baseSc.probabilityRange}).`
        : `Biên hẹp ${pct(change)} — đúng nhịp Cơ sở / chưa phá ngưỡng.`,
      heldBase: true,
    };
  }

  return {
    status: "ON_TRACK",
    note: `Biến động ${pct(change)} vẫn trong biên tham chiếu sáng — chưa đủ để vô hiệu kịch bản Cơ sở.`,
    heldBase: true,
  };
}

function newsAfterMorning(ctx: IntradayCtx): string[] {
  const items = ctx.snap.news ?? [];
  // Prefer items that look "fresh"; we don't have strict 07:30 filter on all sources
  const cutoff = new Date();
  cutoff.setHours(7, 30, 0, 0);
  const filtered = items.filter((n) => {
    const t = Date.parse(n.publishedAt ?? "");
    if (!Number.isFinite(t)) return true; // keep if unknown, marked later
    return t >= cutoff.getTime();
  });
  const list = (filtered.length ? filtered : items).slice(0, 4);
  return list.map((n) => {
    const sym = n.relatedSymbols?.length ? ` · ${n.relatedSymbols.slice(0, 2).join(",")}` : "";
    return `• ${n.title} — ${n.source}${sym}`;
  });
}

/**
 * Compose Intraday Brief — delta-only vs Morning, scenario-anchored.
 * May return a very short report when market is quiet (framework §4.3).
 */
export function composeIntradayFramework(
  ctx: IntradayCtx,
  baseAssumptions: string[],
): { sections: Section[]; assumptions: string[] } {
  const assumptions = [...baseAssumptions];
  const { snap, intel, slot, timeLabel } = ctx;
  const idx = snap.indices?.find((i) => i.code === "VNINDEX") ?? snap.indices?.[0] ?? null;
  const tone: "up" | "down" | "neutral" =
    snap.pulse.score > 0.15 ? "up" : snap.pulse.score < -0.15 ? "down" : "neutral";

  const { status, note: statusNote, heldBase } = inferScenarioStatus(ctx);
  const statusVi = statusLabel(status);

  // Detect "quiet session" → short form
  const changeAbs = idx?.changePercent != null ? Math.abs(idx.changePercent) : null;
  const quiet =
    (changeAbs == null || changeAbs < 0.4) &&
    status === "ON_TRACK" &&
    !(intel.contributors?.positive?.length || intel.contributors?.negative?.length);

  if (quiet) {
    const short: Section[] = [
      {
        heading: "0. Live Header",
        tone: "neutral",
        paragraphs: sanitize([
          `[${timeLabel}] VN-Index: ${idx ? `${num(idx.value)} (${pct(idx.changePercent)})` : "UNAVAILABLE"} · GTGD: ${intel.liquidity?.valueTraded != null ? bigVnd(intel.liquidity.valueTraded) : "—"}`,
          `Trạng thái so với kịch bản sáng: ${statusVi}`,
          statusNote,
        ]),
      },
      {
        heading: "6. Góc nhìn phần phiên còn lại",
        tone: "neutral",
        paragraphs: sanitize([
          "Thị trường đi ngang đúng kịch bản Cơ sở sáng nay, không có yếu tố mới đáng kể.",
          "Hành động: Giữ nguyên khuyến nghị sáng — không mở vị thế mới vì thiếu tín hiệu.",
          slot === "pre_atc"
            ? "Trước ATC: không đuổi giá; ưu tiên giữ / chốt lệnh đã có kế hoạch, tránh mở mới sau 14:15."
            : "Chưa cần phản ứng.",
        ]),
      },
      {
        heading: "Disclaimer",
        tone: "neutral",
        paragraphs: [
          "Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư.",
        ],
      },
    ];
    assumptions.push("Bản rút gọn (phiên yên ả) — đúng nguyên tắc Intraday Framework: không độn chữ.");
    return { sections: short, assumptions };
  }

  const sections: Section[] = [];

  // ——— Block 0: Live Header (bắt buộc dòng scenario status) ———
  const liq =
    intel.liquidity?.valueTraded != null
      ? `${bigVnd(intel.liquidity.valueTraded)} VND`
      : "—";
  sections.push({
    heading: "0. Live Header",
    tone,
    paragraphs: sanitize([
      `[${timeLabel}] · Slot: ${SLOT_LABEL[slot]}`,
      `VN-Index: ${idx ? `${num(idx.value)} (${pct(idx.changePercent)})` : "UNAVAILABLE"} · GTGD: ${liq}${intel.liquidity?.note ? ` (${intel.liquidity.note.slice(0, 80)})` : ""}`,
      `Trạng thái so với kịch bản sáng: ${statusVi}`,
      statusNote,
      ctx.morningReport
        ? `Neo Morning Brief: «${ctx.morningReport.title}»`
        : "Chưa có Morning Brief cùng ngày trong kho — neo theo pulse/biên ±1%.",
    ]),
  });

  // ——— Block 1: Biến động nổi bật ———
  const moveParas: string[] = [];
  const pos = intel.contributors?.positive?.slice(0, 5) ?? [];
  const neg = intel.contributors?.negative?.slice(0, 5) ?? [];
  if (pos.length) {
    moveParas.push(
      `Top kéo (proxy %): ${pos.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`,
    );
  }
  if (neg.length) {
    moveParas.push(
      `Top đè (proxy %): ${neg.map((c) => `${c.symbol} ${pct(c.changePercent)}`).join(", ")}.`,
    );
  }
  if (intel.breadth?.available) {
    const b = intel.breadth;
    moveParas.push(
      `Độ rộng: ${b.advancers}↑ / ${b.decliners}↓ / ${b.unchanged ?? 0}—${b.regimeVi ? ` · ${b.regimeVi}` : ""}.`,
    );
  }
  if (!moveParas.length) {
    moveParas.push("Chưa đủ board/contributors LIVE — không liệt kê mã giả.");
  }
  // Session phase hint by slot
  if (slot === "mid_morning") {
    moveParas.push("Khung: ATO → 10h — phản ứng tin/dữ liệu đầu phiên.");
  } else if (slot === "lunch") {
    moveParas.push("Khung: tổng kết phiên sáng trước nghỉ trưa.");
  } else if (slot === "pre_atc") {
    moveParas.push("Khung: phiên chiều → trước ATC — ưu tiên vị thế cần xử lý trước 14:30.");
  }
  sections.push({
    heading: "1. Biến động nổi bật",
    tone,
    paragraphs: sanitize(moveParas),
  });

  // ——— Block 2: Dòng tiền real-time ———
  const flowParas: string[] = [];
  if (intel.flow?.available) {
    const f = intel.flow;
    flowParas.push(
      `Khối ngoại ròng (đến thời điểm báo cáo): ${f.foreignNet != null ? bigVnd(f.foreignNet) : "—"} · tự doanh ${f.propNet != null ? bigVnd(f.propNet) : "—"} · ETF ${f.etfNet != null ? bigVnd(f.etfNet) : "—"}.`,
    );
    if (f.note) flowParas.push(f.note.slice(0, 200));
    flowParas.push(
      "So cùng giờ hôm qua / TB5 phiên: chưa có chuỗi intraday cùng giờ — sẽ bổ sung khi connector đủ lịch sử.",
    );
  } else {
    flowParas.push("Dòng tiền phiên: UNAVAILABLE — không ước lượng foreign/prop.");
  }
  sections.push({
    heading: "2. Dòng tiền real-time",
    tone: "neutral",
    paragraphs: sanitize(flowParas),
  });

  // ——— Block 3: Tin nóng trong phiên (sau ~07:30) ———
  const newsLines = newsAfterMorning(ctx);
  sections.push({
    heading: "3. Tin nóng trong phiên",
    tone: "neutral",
    paragraphs: sanitize(
      newsLines.length
        ? ["Chỉ tin ưu tiên sau cửa sổ Morning Brief (nếu timestamp có):", ...newsLines]
        : ["Không có tin breaking đạt ngưỡng sau Morning Brief — không lặp tin sáng."],
    ),
  });

  // ——— Block 4: Phái sinh (honest if missing) ———
  sections.push({
    heading: "4. Phái sinh real-time",
    tone: "neutral",
    paragraphs: sanitize([
      "VN30F1M / basis / OI: connector phái sinh chưa gắn trong pipeline hiện tại — block UNAVAILABLE.",
      "Khi LIVE: giá F1M · basis · OI · Δ đầu phiên · cảnh báo nếu |basis| bất thường trước ATC.",
    ]),
  });

  // ——— Block 5: Cảnh báo kỹ thuật (chỉ khi có sự kiện) ———
  const techParas: string[] = [];
  if (idx && idx.changePercent != null) {
    if (Math.abs(idx.changePercent) >= 1) {
      techParas.push(
        `VN-Index ${pct(idx.changePercent)} — vượt ngưỡng biến động 1% trong phiên; kiểm tra KL xác nhận.`,
      );
    }
    if (status === "DEVIATING") {
      techParas.push(`Phá/tiệm cận biên kịch bản sáng: ${statusNote}`);
    }
  }
  if (!techParas.length) {
    techParas.push("Không có sự kiện kỹ thuật mới so với ngưỡng Morning Brief — không tường thuật lại chỉ báo.");
  }
  sections.push({
    heading: "5. Cảnh báo kỹ thuật",
    tone: status === "DEVIATING" ? tone : "neutral",
    paragraphs: sanitize(techParas),
  });

  // ——— Block 6: Outlook + action ———
  const outlook: string[] = [
    `GIỮ NGUYÊN kịch bản sáng: ${heldBase ? "Có" : "Không"}${heldBase ? "" : ` — ${statusNote}`}`,
  ];
  if (heldBase) {
    outlook.push("Hành động: Giữ nguyên. Không mở thêm vì thiếu tín hiệu phá biên.");
  } else if (status === "DEVIATING" && (idx?.changePercent ?? 0) < 0) {
    outlook.push("Hành động: Hạ tỷ trọng / đứng ngoài nếu mất S1 kèm bán lan tỏa. Không bắt đáy giữa phiên.");
  } else if (status === "DEVIATING") {
    outlook.push("Hành động: Chỉ nâng nhóm dẫn dắt có KL thực khi độ rộng mở; tránh đuổi toàn thị trường.");
  } else {
    outlook.push("Hành động: Chưa cần phản ứng — chờ xác nhận đóng cửa hoặc slot kế tiếp.");
  }
  if (slot === "pre_atc") {
    outlook.push(
      "HÀNH ĐỘNG TRƯỚC ATC: ưu tiên xử lý vị thế đã có kế hoạch chốt/cắt; hạn chế mở mới sau 14:15; theo dõi basis khi có dữ liệu phái sinh.",
    );
  }
  sections.push({
    heading: "6. Góc nhìn phần phiên còn lại",
    tone: "neutral",
    paragraphs: sanitize(outlook),
  });

  sections.push({
    heading: "Disclaimer",
    tone: "neutral",
    paragraphs: ["Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư."],
  });

  if (!ctx.morningReport) {
    assumptions.push("Chưa neo được Morning Brief cùng ngày từ DB — scenario status suy từ biên ±1% và breadth.");
  }

  return { sections, assumptions };
}

/** Optional helper for event-triggered short alerts (Block 0 + 1 related + action) */
export function composeIntradayAlert(
  ctx: IntradayCtx,
  triggerReason: string,
  action: string,
): { sections: Section[]; assumptions: string[] } {
  const idx = ctx.snap.indices?.[0] ?? null;
  const { status, note } = inferScenarioStatus(ctx);
  return {
    sections: [
      {
        heading: "0. Live Header (Alert)",
        tone: "down",
        paragraphs: sanitize([
          `[${ctx.timeLabel}] ALERT · ${triggerReason}`,
          `VN-Index: ${idx ? `${num(idx.value)} (${pct(idx.changePercent)})` : "UNAVAILABLE"}`,
          `Trạng thái so với kịch bản sáng: ${statusLabel(status)} — ${note}`,
        ]),
      },
      {
        heading: "Hành động",
        tone: "neutral",
        paragraphs: sanitize([action]),
      },
      {
        heading: "Disclaimer",
        tone: "neutral",
        paragraphs: ["Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư."],
      },
    ],
    assumptions: ["Bản event-triggered — ưu tiên tốc độ, bổ sung ngữ cảnh ở slot định kỳ gần nhất."],
  };
}
