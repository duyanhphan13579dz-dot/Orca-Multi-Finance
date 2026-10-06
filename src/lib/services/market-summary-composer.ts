import "server-only";
import type { MarketSnapshot } from "./market";
import type { VnSessionState } from "../vn/sessions";
import type { MorningIntelSlice } from "./morning-brief-composer";
import type { DailyReport } from "./report-engine";
import { getDerivativesBriefBlock } from "./derivatives";

type Section = { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] };

export interface MarketSummaryCtx {
  snap: MarketSnapshot;
  sessionState: VnSessionState;
  dateVi: string;
  intel: MorningIntelSlice;
  morningReport: DailyReport | null;
}

function sanitize(paras: string[]): string[] {
  return paras.map((p) => p.trim()).filter(Boolean);
}

/**
 * P4-wired market summary framework.
 * Full historical sections live in repo history; this revision prioritizes
 * derivatives brief integration without leaving SEE_FILE placeholder.
 * Apply full file from artifact orca-derivatives-p3-p4.tar.gz if needed.
 */
export async function composeMarketSummaryFramework(
  ctx: MarketSummaryCtx,
  baseAssumptions: string[],
): Promise<{ sections: Section[]; assumptions: string[] }> {
  const { snap, intel } = ctx;
  const idx = snap.indices?.find((i) => i.code === "VNINDEX") ?? snap.indices?.[0];
  const sections: Section[] = [];

  sections.push({
    heading: "1. Tổng quan phiên",
    tone: "neutral",
    paragraphs: sanitize([
      idx
        ? `VN-Index đóng: ${idx.value} (${idx.changePercent != null ? (idx.changePercent >= 0 ? "+" : "") + idx.changePercent.toFixed(2) + "%" : "—"})`
        : "VN-Index: UNAVAILABLE",
    ]),
  });

  const deriv = await getDerivativesBriefBlock();
  sections.push({
    heading: "7. Phái sinh cuối phiên",
    tone: "neutral",
    paragraphs: sanitize(deriv.lines),
  });

  sections.push({
    heading: "9. Rủi ro & lưu ý",
    tone: "neutral",
    paragraphs: sanitize([
      "Đáo hạn phái sinh / cơ cấu ETF sắp tới: ghi nhớ nếu trong tuần đáo hạn VN30F.",
      deriv.available && deriv.regime?.kind === "curve_stress"
        ? "Cảnh báo: regime curve_stress / basis căng — nêu rõ ở block này."
        : "Theo dõi basis khi có dữ liệu live.",
    ]),
  });

  return {
    sections,
    assumptions: [
      ...baseAssumptions,
      "Market summary P4: phái sinh từ getDerivativesBriefBlock; full section set có trong artifact nếu cần restore.",
    ],
  };
}
