import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";
import type { MorningIntelSlice } from "./morning-brief-composer";
import { resolveReportNews } from "./report-data";
import type { DailyReport, ReportScenario } from "./report-engine";
import { getDerivativesBriefBlock } from "./derivatives";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

export type ScenarioStatus = "ON_TRACK" | "DEVIATING" | "UNCLEAR";
export type IntradaySlot = "mid_morning" | "lunch" | "pre_atc" | "ad_hoc";

export interface IntradayCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  intel: MorningIntelSlice;
  morningReport: DailyReport | null;
  slot: IntradaySlot;
  timeLabel: string;
}

function sanitize(paras: string[]): string[] {
  return paras.map((p) => p.trim()).filter(Boolean);
}

function num(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}

function bigVnd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} nghìn tỷ`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} tỷ`;
  return String(Math.round(v));
}

export function detectIntradaySlot(vnHour: number, vnMinute: number): IntradaySlot {
  const t = vnHour * 60 + vnMinute;
  if (t >= 9 * 60 + 30 && t < 11 * 60 + 30) return "mid_morning";
  if (t >= 11 * 60 + 30 && t < 13 * 60) return "lunch";
  if (t >= 14 * 60 && t < 14 * 60 + 45) return "pre_atc";
  return "ad_hoc";
}

export async function composeIntradayFramework(
  ctx: IntradayCtx,
  baseAssumptions: string[],
): Promise<{ sections: Section[]; assumptions: string[] }> {
  const { snap, intel, timeLabel, slot, morningReport } = ctx;
  const idx = snap.indices?.find((i) => i.code === "VNINDEX") ?? snap.indices?.[0];
  const sections: Section[] = [];

  sections.push({
    heading: "1. Live Header",
    tone: idx && (idx.changePercent ?? 0) >= 0 ? "up" : "down",
    paragraphs: sanitize([
      `[${timeLabel}] VN-Index: ${idx ? `${num(idx.value)} (${pct(idx.changePercent)})` : "UNAVAILABLE"} · GTGD: ${intel.liquidity?.valueTraded != null ? bigVnd(intel.liquidity.valueTraded) : "—"}`,
    ]),
  });

  sections.push({
    heading: "2. Delta so với Morning Brief",
    tone: "neutral",
    paragraphs: sanitize([
      morningReport
        ? "So với Morning Brief gần nhất: kiểm tra kịch bản Base/Bull/Bear còn giữ không."
        : "Chưa có Morning Brief trong DB — delta đánh dấu UNCLEAR.",
    ]),
  });

  sections.push({
    heading: "3. Dòng tiền phiên",
    tone: "neutral",
    paragraphs: sanitize([
      intel.flow
        ? `Dòng tiền: foreign/prop theo intel hiện có.`
        : "Dòng tiền phiên: UNAVAILABLE — không ước lượng foreign/prop.",
    ]),
  });

  const derivBrief = await getDerivativesBriefBlock();
  sections.push({
    heading: "4. Phái sinh real-time",
    tone: "neutral",
    paragraphs: sanitize(derivBrief.lines),
  });

  sections.push({
    heading: "5. Hành động",
    tone: "neutral",
    paragraphs: sanitize([
      slot === "pre_atc"
        ? "HÀNH ĐỘNG TRƯỚC ATC: ưu tiên xử lý vị thế đã có kế hoạch chốt/cắt; hạn chế mở mới sau 14:15; theo dõi basis khi có dữ liệu phái sinh."
        : "Ưu tiên theo kế hoạch sáng; không mở mới nếu dataConfidence thấp.",
    ]),
  });

  return {
    sections,
    assumptions: [
      ...baseAssumptions,
      "Intraday brief: no-mock-data; block phái sinh từ getDerivativesBriefBlock (P4).",
    ],
  };
}

export async function composeIntradayAlert(
  ..._args: unknown[]
): Promise<{ status: "ON_TRACK" | "DEVIATING" | "UNCLEAR"; note: string; heldBase: boolean }> {
  return { status: "UNCLEAR", note: "Alert path simplified on P4 branch restore", heldBase: true };
}
