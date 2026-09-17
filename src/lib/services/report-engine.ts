import "server-only";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot, type MarketSnapshot } from "./market";
import { getVnSession, type VnSessionState } from "../vn/sessions";
import { VN_SECTOR_MAP } from "../vn/master";
import { llmConfigured } from "../ai/gateway";
import type { FreshnessStatus, Meta } from "../types";
import { composeMorningFramework } from "./morning-brief-composer";

/**
 * VIETNAM FINANCIAL REPORT INTELLIGENCE ENGINE
 *
 * Daily products (VN-first, data-verified, analyst-voiced):
 *   morning_brief    — trước giờ mở cửa: "điều gì quan trọng hôm nay?" (10 khối Framework)
 *   market_summary   — sau giờ đóng cửa: "điều gì thực sự đã xảy ra?"
 *   strategy         — market view + drivers + levels + sector prefs + scenarios
 *
 * Every paragraph is composed from snapshot data built through the Data
 * Engine (providers → validation → reconciliation → quality → pulse). The
 * LLM never invents figures; scenarios carry explicit probability logic.
 */

export type DailyReportType = "morning_brief" | "intraday_brief" | "market_summary" | "strategy";

export interface ReportScenario {
  label: "Base" | "Bull" | "Bear";
  probabilityRange: string;
  drivers: string;
  indexZones: string;
  sectorImpact: string;
  risks: string;
}

export interface DailyReport {
  type: DailyReportType;
  title: string;
  subtitle: string;
  generatedAt: string;
  sessionState: VnSessionState;
  marketDataTimestamp: string | null;
  freshness: Record<string, FreshnessStatus>;
  sections: { heading: string; tone: "up" | "down" | "neutral"; paragraphs: string[] }[];
  scenarios: ReportScenario[];
  assumptions: string[];
}

/* ------------------------------- context ---------------------------------- */

interface DailyCtx {
  snap: MarketSnapshot;
  meta: Meta;
  sessionState: VnSessionState;
  dateVi: string;
}

async function buildCtx(): Promise<DailyCtx> {
  const s = await buildMarketSnapshot();
  const session = getVnSession();
  const vnNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return {
    snap: s.snapshot,
    meta: s.meta,
    sessionState: session.state,
    dateVi: vnNow.toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
const bigUsd = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} tỷ`;
  return `$${(v / 1e6).toFixed(0)} triệu`;
};

function vnSectionDataStatus(ctx: DailyCtx): "available" | "unavailable" {
  return ctx.snap.indices?.length ? "available" : "unavailable";
}

/* ------------------------------ scenario engine ---------------------------- */

function buildScenarios(ctx: DailyCtx): ReportScenario[] {
  const score = ctx.snap.pulse.score;
  const pip = clamp(score, -1, 1);
  const baseP = Math.round(clamp(58 - Math.abs(pip) * 22, 30, 60));
  const bullP = Math.round(clamp(21 + (pip > 0 ? pip * 20 : 0), 10, 45));
  const bearP = Math.max(1, 100 - baseP - bullP);

  const idx = ctx.snap.indices?.[0];
  const zones = idx
    ? `VN-Index ${idx.value.toLocaleString("vi-VN")} — theo dõi phản ứng quanh ${(idx.value * 0.99).toFixed(0)}–${(idx.value * 1.01).toFixed(0)} điểm trong phiên`
    : "Vùng tham khảo kỹ thuật của VN-Index sẽ được định vị ngay khi VNStock kết nối (hệ thống không phác thảo vùng giá khi thiếu dữ liệu)";

  const cryptoDir = ctx.snap.crypto
    ? ctx.snap.crypto.summary.avgChangePercent >= 0
      ? "tích cực"
      : "tiêu cực"
    : "không rõ";
  const goldDir = (ctx.snap.commodities ?? []).find((c) => c.symbol === "XAUUSD");
  const safeFlow =
    goldDir && goldDir.changePercent != null && goldDir.changePercent > 0.4
      ? "dòng tiền phòng thủ vào vàng tăng"
      : "dòng tiền phòng thủ chưa trội";

  return [
    {
      label: "Base",
      probabilityRange: `${baseP - 5}–${baseP + 5}%`,
      drivers: `Động lượng hiện tại duy trì: sắc thái crypto ${cryptoDir}, ${safeFlow}; không có cú sốc vĩ mô mới trong phiên.`,
      indexZones: zones,
      sectorImpact:
        "Dòng tiền chọn lọc theo nhóm ngành có câu chuyện riêng; blue chips giữ vai trò giằng điểm số.",
      risks:
        "Thanh khoản yếu có thể khiến biên dao động của từng mã bị phóng đại dù chỉ số chung biến động nhẹ.",
    },
    {
      label: "Bull",
      probabilityRange: `${bullP - 4}–${bullP + 4}%`,
      drivers:
        "Risk-on đồng thuận: crypto vượt kháng cự ngắn hạn, USD dịu lại, hàng hóa đầu vào ổn định; tin doanh nghiệp tích cực lan sang tâm lý nhóm ngành.",
      indexZones: idx
        ? `Xác nhận khi VN-Index vượt ${(idx.value * 1.005).toFixed(0)} kèm độ rộng mở rộng rõ rệt`
        : "Xác nhận cần một phiên tăng điểm với thanh khoản vượt trung bình 20 phiên",
      sectorImpact:
        "Nhóm beta cao (chứng khoán, bất động sản) thường dẫn; ngân hàng lớn cung cấp nền ổn định.",
      risks: "Tăng nhanh nhưng thanh khoản không theo kịp — dễ hình thành nến rút chân chiều ngược lại.",
    },
    {
      label: "Bear",
      probabilityRange: `${bearP - 3}–${bearP + 3}%`,
      drivers:
        "Khủng hoảng bất ngờ vĩ mô/địa chính trị, USD bật mạnh, hoặc tin xấu doanh nghiệp lớn; hợp đồng phái sinh khuếch đại rung lắc.",
      indexZones: idx
        ? `Rủi ro khi mất ${(idx.value * 0.99).toFixed(0)} với bán chiếm ưu thế vượt rõ`
        : "Rủi ro khi diễn biến bán mở rộng ra toàn thị trường thay vì gói gọn trong một nhóm",
      sectorImpact:
        "Nhóm phòng thủ (tiêu dùng thiết yếu, dược) tương đối kháng; tài sản nhạy lãi suất/đòn bẩy chịu áp lực trước.",
      risks:
        "Khi rủi ro hệ thống khởi động, correlation tăng và đa dạng hóa ngành giảm hiệu quả bảo vệ.",
    },
  ];
}

/* ------------------------------- composers -------------------------------- */

function composeIntraday(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  const { snap } = ctx;
  const index = snap.indices?.[0];
  const tone = snap.pulse.score > 0.15 ? "up" : snap.pulse.score < -0.15 ? "down" : "neutral";
  const sections: DailyReport["sections"] = [
    {
      heading: "Tóm tắt điều hành giữa phiên",
      tone,
      paragraphs: [
        `${snap.pulse.headline}. Tại thời điểm nghỉ trưa, thị trường cần được đọc qua tương quan giữa điểm số, độ rộng và thanh khoản thay vì chỉ nhìn biến động VN-Index.`,
        index
          ? `VN-Index đang ở ${index.value.toLocaleString("vi-VN")} điểm (${pct(index.changePercent)}). Trạng thái phiên: ${snap.vnSession.labelVi}.`
          : "Chưa có dữ liệu VN-Index hợp lệ để định lượng điểm số; hệ thống không suy diễn số liệu khi nguồn chưa khả dụng.",
      ],
    },
    {
      heading: "Diễn biến chỉ số và chất lượng độ rộng",
      tone: "neutral",
      paragraphs: [
        ...(snap.indices ?? []).slice(0, 4).map(
          (i) => `${i.code}: ${i.value.toLocaleString("vi-VN")} điểm (${pct(i.changePercent)}).`,
        ),
        "Độ rộng là bộ lọc quan trọng cho phiên chiều: chỉ số tăng nhưng số mã dẫn dắt thu hẹp cho thấy lực kéo tập trung; chỉ số đi ngang cùng độ rộng cải thiện thường là tín hiệu tích lũy lành mạnh hơn.",
      ],
    },
    {
      heading: "Dòng tiền, thanh khoản và nhóm dẫn dắt",
      tone: "neutral",
      paragraphs: [
        `Risk-appetite composite đang ở mức ${snap.pulse.score >= 0 ? "+" : ""}${snap.pulse.score.toFixed(2)} trên thang -1..+1. ${snap.pulse.drivers.map((d) => `${d.label}: ${d.value}`).join("; ")}.`,
        "Buổi chiều cần kiểm tra thanh khoản có tiếp tục mở rộng cùng hướng với chỉ số hay không; nếu giá tăng nhưng dòng tiền suy yếu, ưu tiên coi đó là nhịp hồi kỹ thuật và tránh đuổi giá.",
      ],
    },
    {
      heading: "Nhận định kỹ thuật và nhận xét thị trường",
      tone,
      paragraphs: [
        snap.pulse.body[0] ?? "Động lượng hiện chưa đủ mạnh để xác nhận một xu hướng mới.",
        snap.pulse.body[1] ?? "Cần chờ phản ứng tại các vùng hỗ trợ/kháng cự gần nhất và sự xác nhận của thanh khoản.",
        "Quan điểm giữa phiên: duy trì kỷ luật theo tín hiệu xác nhận, phân biệt rõ cổ phiếu mạnh thật sự với các mã chỉ tăng do cung cầu ngắn hạn.",
      ],
    },
    {
      heading: "Kịch bản phần còn lại của phiên",
      tone: "neutral",
      paragraphs: [
        "Kịch bản cơ sở: thị trường dao động phân hóa, dòng tiền tiếp tục chọn lọc và chỉ số cần giữ nền buổi sáng để tránh áp lực bán cuối phiên.",
        "Kịch bản tích cực: độ rộng mở rộng, thanh khoản tăng hợp lý và nhóm vốn hóa lớn cùng xác nhận sẽ nâng xác suất kéo chỉ số về vùng cao trong ngày.",
        "Kịch bản rủi ro: mất nền buổi sáng kèm bán lan tỏa; khi đó ưu tiên giảm giao dịch theo cảm xúc và chờ dữ liệu đóng cửa xác nhận.",
      ],
    },
    {
      heading: "Hành động và rủi ro cần theo dõi",
      tone: "neutral",
      paragraphs: [
        "Hành động nghiên cứu: theo dõi nhóm dẫn dắt có thanh khoản thực, đặt ngưỡng vô hiệu hóa trước khi mở vị thế và không dùng bản tin này thay thế khẩu vị rủi ro cá nhân.",
        "Rủi ro chính: dữ liệu giữa phiên có thể thay đổi nhanh, độ trễ nguồn cung cấp và biến động bất ngờ từ tin doanh nghiệp/vĩ mô. Không có dữ liệu đủ tin cậy thì không kết luận định lượng.",
      ],
    },
  ];
  return { sections, assumptions: assumptionsNote(ctx) };
}

function composeMorning(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  return composeMorningFramework(
    { snap: ctx.snap, sessionState: ctx.sessionState, dateVi: ctx.dateVi },
    assumptionsNote(ctx),
  );
}

function composeSummary(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  const { snap } = ctx;
  const sections: DailyReport["sections"] = [];
  const p = snap.pulse;

  sections.push({
    heading: "Tóm tắt điều hành — phiên hôm nay đã xảy ra gì?",
    tone: p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral",
    paragraphs: [
      ...(snap.indices?.length
        ? [
            `Kết phiên, VN-Index đóng cửa ${snap.indices[0].value.toLocaleString("vi-VN")} điểm (${pct(snap.indices[0].changePercent)}). Nhìn sâu hơn con số tuyệt đối, chất lượng phiên cần đọc qua độ rộng và thanh khoản — hai chiều cho thấy liệu nhịp diễn ra là lan tỏa hay tập trung ở ít mã.`,
          ]
        : [
            "Hoạt động của các nhóm tài sản theo dõi được cho thấy bức tranh trọng tâm qua đêm/ngày. Dữ liệu VN-Index chưa kết nối nên tóm tắt này dựng trên các nguồn còn lại — không tái tạo tự do số liệu thị trường trong nước.",
          ]),
      p.body[0] ?? "",
      p.body[1] ?? "",
    ],
  });

  if (snap.crypto) {
    const s = snap.crypto.summary;
    sections.push({
      heading: "Thanh khoản & độ rộng (proxy tài sản toàn cầu)",
      tone: s.advancers > s.decliners ? "up" : "down",
      paragraphs: [
        `Dòng tiền vào tài sản rủi ro trên thế giới: khối lượng quy đổi crypto 24h ${bigUsd(s.totalQuoteVolume)}, độ rộng ${s.advancers}/${s.marketCount} mã xanh (${((s.advancers / Math.max(1, s.marketCount)) * 100).toFixed(0)}%) — ${
          s.advancers > s.decliners ? "mở rộng tích cực" : "thu hẹp"
        }. Khi dòng tiền trong nước khả dụng (VNStock), phần này sẽ chuyển sang giá trị giao dịch HOSE/HNX/UPCoM và breadth chính thống.`,
      ],
    });
  }

  if (snap.indices?.length) {
    sections.push({
      heading: "Đóng góp chỉ số & rotation",
      tone: "neutral",
      paragraphs: [
        `Chi tiết top đóng góp VN-Index, rotation nhóm ngành và top gainers/losers sẽ được engine tính từ dữ liệu realtime đã reconciliation ngay khi VNStock kết nối — cùng taxonomy ${VN_SECTOR_MAP.length} nhóm ngành của Security Master.`,
      ],
    });
  }

  const news = (snap.news ?? []).slice(0, 5);
  if (news.length) {
    sections.push({
      heading: "Tin tức tác động phiên nay",
      tone: "neutral",
      paragraphs: news.map((n) => `${n.title} — ${n.source}.`),
    });
  }

  sections.push({
    heading: "Triển vọng phiên tiếp theo",
    tone: "neutral",
    paragraphs: [
      "Phiên tới ưu tiên quan sát phản ứng tại vùng hỗ trợ/kháng cự đã hình thành và chất lượng thanh khoản mở cửa.",
      "Kịch bản Base/Bull/Bear (bảng dưới) được sinh từ pulse engine — xác suất model-derived, không phải cam kết.",
    ],
  });

  return { sections, assumptions: assumptionsNote(ctx) };
}

function composeStrategy(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  const { snap } = ctx;
  const p = snap.pulse;
  const tone = p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral";
  const sections: DailyReport["sections"] = [
    {
      heading: "Market view",
      tone,
      paragraphs: [
        `${p.headline}. Composite risk-appetite ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)} (−1..+1).`,
        p.body[0] ?? "",
      ],
    },
    {
      heading: "Động lực chính đang vận hành",
      tone: "neutral",
      paragraphs: p.drivers.map((d) => `${d.label}: ${d.value}`),
    },
    {
      heading: "Khuynh hướng ngành & chiến lược",
      tone: "neutral",
      paragraphs: [
        `Taxonomy ${VN_SECTOR_MAP.length} nhóm ngành VN. Ưu tiên quan sát nhóm có thanh khoản thực và câu chuyện riêng trong tuần.`,
        "Chiến lược: chờ xác nhận độ rộng + thanh khoản; không đuổi giá khi chỉ số tăng mà breadth thu hẹp.",
      ],
    },
  ];
  return { sections, assumptions: assumptionsNote(ctx) };
}

function assumptionsNote(ctx: DailyCtx): string[] {
  const notes: string[] = [
    "Báo cáo dựng từ dữ liệu đã qua Data Engine (freshness gate) — không mock, không nội suy số liệu thiếu.",
    `Trạng thái phiên VN: ${ctx.sessionState}.`,
  ];
  if (vnSectionDataStatus(ctx) === "unavailable") {
    notes.push("VN equity data UNAVAILABLE tại thời điểm phát hành — các block VN được đánh dấu rõ, không suy diễn.");
  }
  notes.push(
    "Thông tin mang tính tham khảo, không phải khuyến nghị đầu tư.",
  );
  return notes;
}

const COMPOSERS: Record<
  DailyReportType,
  (ctx: DailyCtx) => { sections: DailyReport["sections"]; assumptions: string[] }
> = {
  morning_brief: composeMorning,
  intraday_brief: composeIntraday,
  market_summary: composeSummary,
  strategy: composeStrategy,
};

const TITLES: Record<DailyReportType, string> = {
  morning_brief: "ORCA Morning Brief",
  intraday_brief: "ORCA Intraday Brief",
  market_summary: "ORCA Market Summary",
  strategy: "ORCA Strategy Note",
};

export async function generateDailyReport(
  type: DailyReportType,
): Promise<{ report: DailyReport; meta: Meta }> {
  const ctx = await buildCtx();
  const { sections, assumptions } = COMPOSERS[type](ctx);
  const scenarios = buildScenarios(ctx);
  const report: DailyReport = {
    type,
    title: `${TITLES[type]} — ${ctx.dateVi}`,
    subtitle:
      type === "morning_brief"
        ? "Chuẩn bị hành động trước ATO — 10 khối theo ORCA Morning Brief Framework · no-mock-data"
        : type === "intraday_brief"
          ? "Toàn cảnh giữa phiên — nhận định, kịch bản và điểm cần theo dõi cho buổi chiều"
          : type === "market_summary"
            ? "Điều gì thực sự đã xảy ra trên thị trường — giải mã từ dữ liệu"
            : "Market view · drivers · levels · sector preferences · scenarios",
    generatedAt: new Date().toISOString(),
    sessionState: ctx.sessionState,
    marketDataTimestamp: ctx.meta.sourceTimestamp,
    freshness: (ctx.meta.sections ?? {}) as Record<string, FreshnessStatus>,
    sections,
    scenarios,
    assumptions,
  };
  await persist(report);
  const meta = buildMeta({
    source: "orca-report-engine",
    sourceTimestampMs: ctx.meta.sourceTimestamp ? Date.parse(ctx.meta.sourceTimestamp) : null,
    sections: ctx.meta.sections,
    note: `scheduler-ready · freshness gate per section`,
  });
  ensureLlmNote(report);
  return { report, meta };
}

function ensureLlmNote(report: DailyReport) {
  if (llmConfigured()) {
    report.assumptions.push(
      "LLM-assisted narrative được giới hạn trong structured context đã output-validation.",
    );
  }
}

async function persist(report: DailyReport) {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    await db.insert(reports).values({
      type: report.type,
      title: report.title,
      body: report as unknown as Record<string, unknown>,
      marketDataTimestamp: report.marketDataTimestamp
        ? new Date(report.marketDataTimestamp)
        : null,
      freshness: JSON.stringify(report.freshness),
    });
  } catch {
    /* best-effort */
  }
}

export interface ReportListItem {
  id: string;
  type: string;
  title: string;
  generatedAt: string;
  marketDataTimestamp: string | null;
  freshness: string | null;
}

export async function listReports(type: string | null, limit = 30): Promise<ReportListItem[]> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { desc, eq } = await import("drizzle-orm");
    let q = db.select().from(reports).orderBy(desc(reports.createdAt)).limit(limit);
    if (type) {
      const rows = await db
        .select()
        .from(reports)
        .where(eq(reports.type, type))
        .orderBy(desc(reports.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        generatedAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
        marketDataTimestamp: r.marketDataTimestamp?.toISOString?.() ?? null,
        freshness: r.freshness,
      }));
    }
    const rows = await q;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      generatedAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
      marketDataTimestamp: r.marketDataTimestamp?.toISOString?.() ?? null,
      freshness: r.freshness,
    }));
  } catch {
    return [];
  }
}

export async function getReportById(id: string): Promise<DailyReport | null> {
  try {
    const { db } = await import("@/db");
    const { reports } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return (row?.body as unknown as DailyReport) ?? null;
  } catch {
    return null;
  }
}
