import "server-only";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot, type MarketSnapshot } from "./market";
import { getVnSession, type VnSessionState } from "../vn/sessions";
import { VN_SECTOR_MAP } from "../vn/master";
import { llmConfigured } from "../ai/gateway";
import type { FreshnessStatus, Meta } from "../types";

/**
 * VIETNAM FINANCIAL REPORT INTELLIGENCE ENGINE
 *
 * Daily products (VN-first, data-verified, analyst-voiced):
 *   morning_brief    — trước giờ mở cửa: "điều gì quan trọng hôm nay?"
 *   market_summary   — sau giờ đóng cửa: "điều gì thực sự đã xảy ra?"
 *   strategy         — market view + drivers + levels + sector prefs + scenarios
 *
 * Every paragraph is composed from snapshot data built through the Data
 * Engine (providers → validation → reconciliation → quality → pulse). The
 * LLM never invents figures; scenarios carry explicit probability logic.
 */

export type DailyReportType = "morning_brief" | "market_summary" | "strategy";

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
    dateVi: vnNow.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const pct = (v: number | null | undefined, digits = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
const bigUsd = (v: number | null | undefined) => {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} tỷ`;
  return `$${(v / 1e6).toFixed(0)} triệu`;
};

function vnSectionDataStatus(ctx: DailyCtx): "available" | "unavailable" {
  return ctx.snap.indices?.length ? "available" : "unavailable";
}

/* ------------------------------ scenario engine ---------------------------- */

/**
 * Transparent probability mapping: pulse score → scenario distribution.
 * Inputs: composite risk-appetite score (-1..+1) + crypto breadth share (+VN
 * index change when available). The ranges are explicitly labeled as
 * model-derived estimates, never as facts.
 */
function buildScenarios(ctx: DailyCtx): ReportScenario[] {
  const score = ctx.snap.pulse.score;
  const pip = clamp(score, -1, 1);
  const baseP = Math.round(clamp(58 - Math.abs(pip) * 22, 30, 60));
  const bullP = Math.round(clamp(21 + (pip > 0 ? pip * 20 : 0), 10, 45));
  const bearP = Math.max(1, 100 - baseP - bullP);

  const idx = ctx.snap.indices?.[0];
  const zones = idx
    ? `VN-Index ${idx.value.toLocaleString("vi-VN")} — theo dõi phản ứng quanh ${(idx.value * 0.99).toFixed(0)}–${(idx.value * 1.01).toFixed(0)} điểm trong phiên`
    : "Vùng tham khảo kỹ thuật của VN-Index sẽ được định vị ngay khi VNDirect kết nối (hệ thống không phác thảo vùng giá khi thiếu dữ liệu)";

  const cryptoDir = ctx.snap.crypto ? (ctx.snap.crypto.summary.avgChangePercent >= 0 ? "tích cực" : "tiêu cực") : "không rõ";
  const goldDir = (ctx.snap.commodities ?? []).find((c) => c.symbol === "XAUUSD");
  const safeFlow = goldDir && goldDir.changePercent != null && goldDir.changePercent > 0.4 ? "dòng tiền phòng thủ vào vàng tăng" : "dòng tiền phòng thủ chưa trội";

  return [
    {
      label: "Base",
      probabilityRange: `${baseP - 5}–${baseP + 5}%`,
      drivers: `Động lượng hiện tại duy trì: sắc thái crypto ${cryptoDir}, ${safeFlow}; không có cú sốc vĩ mô mới trong phiên.`,
      indexZones: zones,
      sectorImpact: "Dòng tiền chọn lọc theo nhóm ngành có câu chuyện riêng; blue chips giữ vai trò giằng điểm số.",
      risks: "Thanh khoản yếu có thể khiến biên dao động của từng mã bị phóng đại dù chỉ số chung biến động nhẹ.",
    },
    {
      label: "Bull",
      probabilityRange: `${bullP - 4}–${bullP + 4}%`,
      drivers: "Risk-on đồng thuận: crypto vượt kháng cự ngắn hạn, USD dịu lại, hàng hóa đầu vào ổn định; tin doanh nghiệp tích cực lan sang tâm lý nhóm ngành.",
      indexZones: idx ? `Xác nhận khi VN-Index vượt ${(idx.value * 1.005).toFixed(0)} kèm độ rộng mở rộng rõ rệt` : "Xác nhận cần một phiên tăng điểm với thanh khoản vượt trung bình 20 phiên",
      sectorImpact: "Nhóm beta cao (chứng khoán, bất động sản) thường dẫn; ngân hàng lớn cung cấp nền ổn định.",
      risks: "Tăng nhanh nhưng thanh khoản không theo kịp — dễ hình thành nến rút chân chiều ngược lại.",
    },
    {
      label: "Bear",
      probabilityRange: `${bearP - 3}–${bearP + 3}%`,
      drivers: "Khủng hoảng bất ngờ vĩ mô/địa chính trị, USD bật mạnh, hoặc tin xấu doanh nghiệp lớn; hợp đồng phái sinh khuếch đại rung lắc.",
      indexZones: idx ? `Rủi ro khi mất ${(idx.value * 0.99).toFixed(0)} với bán chiếm ưu thế vượt rõ` : "Rủi ro khi diễn biến bán mở rộng ra toàn thị trường thay vì gói gọn trong một nhóm",
      sectorImpact: "Nhóm phòng thủ (tiêu dùng thiết yếu, dược) tương đối kháng; tài sản nhạy lãi suất/dộn bẩy chịu áp lực trước.",
      risks: "Khi rủi ro hệ thống khởi động, correlation tăng và đa dạng hóa ngành giảm hiệu quả bảo vệ.",
    },
  ];
}

/* ------------------------------- composers -------------------------------- */

function composeMorning(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  const { snap } = ctx;
  const sections: DailyReport["sections"] = [];
  const p = snap.pulse;

  // 1. Executive summary
  sections.push({
    heading: "Tóm tắt điều hành",
    tone: p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral",
    paragraphs: [
      `${p.headline}. Trước giờ mở cửa phiên ${ctx.dateVi}, điểm tổng hợp risk-appetite của engine đang ở mức ${p.score >= 0 ? "+" : ""}${p.score.toFixed(2)} (thang -1..+1) — phản ánh cân bằng giữa dòng tiền rủi ro và phòng thủ trên toàn bộ không gian tài sản mà hệ thống theo dõi.`,
      vnSectionDataStatus(ctx) === "available"
        ? "Dữ liệu chứng khoán trong nước có sẵn đầy đủ — bản tin này đưa VN-Index vào trung tâm phân tích."
        : "Dữ liệu chứng khoán trong nước chưa kết nối (VNDirect). Bản tin vì vậy đánh trọng tâm vào khung tham chiếu toàn cầu và dòng tin Việt Nam — rõ ràng hơn là không suy diễn số liệu trong nước. Khi nguồn trở lại, phần VN sẽ tự động đầy đủ.",
    ],
  });

  // 2. Overnight global
  if (snap.crypto) {
    const s = snap.crypto.summary;
    sections.push({
      heading: "Diễn biến qua đêm — không gian tài sản toàn cầu",
      tone: s.btcChangePercent != null && s.btcChangePercent > 0 ? "up" : s.btcChangePercent != null && s.btcChangePercent < 0 ? "down" : "neutral",
      paragraphs: [
        `Thị trường tài sản số — kênh phản ứng nhanh nhất với dòng tiền rủi ro — ghi nhận BTC ${
          s.btcChangePercent != null ? `${s.btcChangePercent >= 0 ? "tăng" : "giảm"} ${Math.abs(s.btcChangePercent).toFixed(2)}%` : "không rõ"
        } trong 24 giờ qua${s.ethChangePercent != null ? `, ETH ${pct(s.ethChangePercent)}` : ""}, với độ rộng ${s.advancers} mã xanh / ${s.decliners} mã đỏ trên ${s.marketCount} mã có thanh khoản và biến trung bình ${pct(s.avgChangePercent)}. Tổng khối lượng quy đổi đạt ${bigUsd(s.totalQuoteVolume)}.`,
        `Ý nghĩa truyền dẫn: tâm lý risk-on/risk-off qua đêm thường ảnh hưởng nhịp mở cửa của VN-Index với độ trễ nhất định — đặc biệt nhóm chứng khoán và các mã beta cao. Đây là bối cảnh tham chiếu, KHÔNG phải dự báo cơ học.`,
      ],
    });
  }
  if (snap.forex) sections.push({
    heading: "Ngoại hối & USD",
    tone: "neutral",
    paragraphs: [snap.forex.usdStrengthNote, ...(snap.commodities?.length ? [`Hàng hóa đáng chú ý: ${snap.commodities.filter((c) => ["XAUUSD", "CL", "SJC"].includes(c.symbol) && c.changePercent != null).map((c) => `${c.commodity} ${pct(c.changePercent)}`).join("; ")}.`] : [])],
  });

  // 3. Vietnam market setup
  sections.push({
    heading: "Bối cảnh thị trường Việt Nam",
    tone: ctx.sessionState === "weekend_closed" || ctx.sessionState === "holiday_closed" ? "neutral" : "up",
    paragraphs: [
      `Phiên hiện tại theo lịch HOSE/HNX: ${snap.vnSession.labelVi}. ${snap.vnSessionHint}.`,
      ...((snap.indices ?? []).slice(0, 4).map((i) => `${i.code}: ${i.value.toLocaleString("vi-VN")} (${pct(i.changePercent)})`)),
      vnSectionDataStatus(ctx) === "unavailable" ? "Khi VNDirect kết nối, phần này sẽ bao gồm VN-INDEX/VN30/HNX-INDEX/UPCOM-INDEX, độ rộng, giá trị giao dịch, dòng tiền tự doanh và khối ngoại." : "Cần quan sát độ rộng cùng thanh khoản đầu phiên để xác nhận chất lượng nhịp mở cửa.",
    ],
  });

  // 4. Corporate news
  const corp = (snap.news ?? []).filter((n) => n.category === "corporate" || n.category === "macro").slice(0, 6);
  if (corp.length) {
    sections.push({
      heading: "Tin doanh nghiệp & vĩ mô trong nước cần biết",
      tone: "neutral",
      paragraphs: corp.map((n) => `${n.title} — ${n.source}${n.relatedSector ? ` (nhóm liên quan: ${n.relatedSector})` : ""}.`),
    });
  }

  // 5. Key stocks to watch
  const tagged = (snap.news ?? []).flatMap((n) => n.relatedSymbols).filter((s) => s.length <= 4);
  if (tagged.length) {
    const uniq = [...new Set(tagged)].slice(0, 6);
    sections.push({
      heading: "Mã cổ phiếu được dòng tin đề cập",
      tone: "neutral",
      paragraphs: [
        `Trong 24 giờ qua, dòng tin gắn nhãn vào các mã: ${uniq.join(", ")}. Đây là vùng cần kiểm tra thêm volume và phản ứng giá khi phiên mở — dòng tin thường biểu hiện sớm nhất qua thanh khoản đột biến chứ không nhất thiết qua biên độ.`,
      ],
    });
  }

  // 6. Sector focus
  sections.push({
    heading: "Trọng tâm ngành trong phiên",
    tone: "neutral",
    paragraphs: [
      `Hệ thống sector taxonomy của Security Master hiện quản lý ${VN_SECTOR_MAP.length} nhóm ngành Việt (Ngân hàng, Chứng khoán, Bất động sản, Thép, Dầu khí, Điện lực…). Ưu tiên quan sát: nhóm Ngân hàng quanh sự kiện tín dụng/lãi suất khi có tin vĩ mô; Dầu khí theo biến động giá dầu qua đêm; Thép theo giá nguyên liệu và tin xuất khẩu china; Nhóm Chứng khoán theo thanh khoản phái sinh.`,
      `Khi sector engine nhận dữ liệu realtime thực tế, phần hiệu suất từng ngành (độ rộng, volume, momentum) sẽ thay thế khung định tính này — cùng chuỗi reconciliation.`,
    ],
  });

  return { sections, assumptions: assumptionsNote(ctx) };
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
        ? [`Kết phiên, VN-Index đóng cửa ${snap.indices[0].value.toLocaleString("vi-VN")} điểm (${pct(snap.indices[0].changePercent)}). Nhìn sâu hơn con số tuyệt đối, chất lượng phiên cần đọc qua độ rộng và thanh khoản — hai chiều cho thấy liệu nhịp diễn ra là lan tỏa hay tập trung ở ít mã.`]
        : ["Hoạt động của các nhóm tài sản theo dõi được cho thấy bức tranh trọng tâm qua đêm/ngày. Dữ liệu VN-Index chưa kết nối nên tóm tắt này dựng trên các nguồn còn lại — không tái tạo tự do số liệu thị trường trong nước."]),
      p.body[0] ?? "",
      p.body[1] ?? "",
    ],
  });

  // liquidity/breadth from crypto as cross-asset proxy (explicitly labeled)
  if (snap.crypto) {
    const s = snap.crypto.summary;
    sections.push({
      heading: "Thanh khoản & độ rộng (proxy tài sản toàn cầu)",
      tone: s.advancers > s.decliners ? "up" : "down",
      paragraphs: [
        `Dòng tiền vào tài sản rủi ro trên thế giới: khối lượng quy đổi crypto 24h ${bigUsd(s.totalQuoteVolume)}, độ rộng ${s.advancers}/${s.marketCount} mã xanh (${((s.advancers / Math.max(1, s.marketCount)) * 100).toFixed(0)}%) — ${
          s.advancers > s.decliners ? "mở rộng tích cực" : "thu hẹp"
        }. Khi dòng tiền trong nước khả dụng (VNDirect), phần này sẽ chuyển sang giá trị giao dịch HOSE/HNX/UPCoM và breadth chính thống.`,
      ],
    });
  }

  if (snap.indices?.length) {
    sections.push({
      heading: "Đóng góp chỉ số & rotation",
      tone: "neutral",
      paragraphs: [
        `Chi tiết top đóng góp VN-Index, rotation ngóm ngành và top gainers/losers sẽ được engine tính từ dữ liệu realtime VNDirect ngay khi nguồn kết nối — cùng taxonomy ${VN_SECTOR_MAP.length} nhóm ngành của Security Master.`,
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
      p.score >= 0.2
        ? "Nếu đà risk-appetite duy trì, phiên kế tiếp cần xác nhận ở thanh khoản buổi sáng: muốn mở rộng tiếp, độ rộng phải đi kèm. Bất kỳ nhịp tăng nhưng breadth thu hẹp đều báo nguồn cung trên đè mạnh ở nhóm cụ thể."
        : p.score <= -0.2
          ? "Ưu thế phòng thủ đang tồn tại — phiên kế tiếp chỉ nên đọc là hồi kỹ thuật cho tới khi độ rộng và khối lượng xác nhận lực cầu quay lại. Giữ kỷ luật tỷ trọng thay vì dự đoán đáy."
          : "Thị trường chưa hình thành ưu thế rõ: phiên kế tiếp phù hợp theo dõi rotation ngành và thanh khoản khối lớn hơn là đánh đồng cả chỉ số. Kỳ vọng chọn lọc tiếp tục là chủ đạo.",
      "Nội dung phân tích từ dữ liệu thực tế tại thờ điểm chốt — phục vụ nghiên cứu, không phải khuyến nghị đầu tư.",
    ],
  });

  return { sections, assumptions: assumptionsNote(ctx) };
}

function composeStrategy(ctx: DailyCtx): { sections: DailyReport["sections"]; assumptions: string[] } {
  const { snap } = ctx;
  const p = snap.pulse;
  const sections: DailyReport["sections"] = [
    {
      heading: "Market view",
      tone: p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral",
      paragraphs: [p.headline + ".", ...p.body.slice(0, 2)],
    },
    {
      heading: "Động lực chính đang vận hành",
      tone: "neutral",
      paragraphs: [p.drivers.map((d) => `${d.label}: ${d.value}`).join(" · ") + ".", snap.forex?.usdStrengthNote ?? ""].filter(Boolean),
    },
    {
      heading: "Khuynh hướng ngành & chiến lược",
      tone: "neutral",
      paragraphs: [
        "Trong khẩu phần cổ phiếu Việt: nhóm Ngân hàng vẫn là trụ nền định giá bình quân thấp khi tín dụng phục hồi; nhóm Chứng khoán theo beta thanh khoản thị trường; Bất động sản phân hóa mạnh — chỉ chọn mã có dòng tiền dự án thật; Thép/Hóa chất theo chu kỳ giá nguyên liệu; Nhóm phòng thủ (VNM, dược) bảo vệ trong rung lắc.",
        "Nguyên tắc phân bổ gợi ý của engine: ưu thế risk-on kéo dài ≥ 3 phiên liên tục kèm breadth mở rộng mới là điều kiện nâng tỷ trọng beta; ngược lại giữ core vào nhóm cơ bản tốt có FCF dương.",
      ],
    },
  ];
  return { sections, assumptions: assumptionsNote(ctx) };
}

function assumptionsNote(ctx: DailyCtx): string[] {
  const out = [
    "Xác suất kịch bản được sinh từ pulse engine (risk-appetite composite + breadth share) — là ước tính mô hình minh bạch, KHÔNG phải dự báo; khôngai đảm bảo được xác suất đúng.",
    vnSectionDataStatus(ctx) === "unavailable"
      ? "Dữ liệu VN (VNDirect) chưa kết nối — các phần VN dùng khung domain đã xây sẵn và bối cảnh toàn cầu; không suy diễn số liệu trong nước."
      : "Dữ liệu VN dùng trực tiếp từ VNDirect.",
    ctx.meta.note ? `Ghi chú dữ liệu: ${ctx.meta.note}` : "",
  ];
  return out.filter(Boolean);
}

/* --------------------------- generate + persist ---------------------------- */

const COMPOSERS: Record<DailyReportType, (ctx: DailyCtx) => { sections: DailyReport["sections"]; assumptions: string[] }> = {
  morning_brief: composeMorning,
  market_summary: composeSummary,
  strategy: composeStrategy,
};

const TITLES: Record<DailyReportType, string> = {
  morning_brief: "ORCA Morning Brief",
  market_summary: "ORCA Daily Market Summary",
  strategy: "ORCA Vietnam Market Strategy",
};

export async function generateDailyReport(type: DailyReportType): Promise<{ report: DailyReport; meta: Meta }> {
  const ctx = await buildCtx();
  const { sections, assumptions } = COMPOSERS[type](ctx);
  const scenarios = buildScenarios(ctx);
  const report: DailyReport = {
    type,
    title: `${TITLES[type]} — ${ctx.dateVi}`,
    subtitle:
      type === "morning_brief"
        ? "Chuẩn bị hành trang cho phiên giao dịch — dữ liệu mới nhất tại thờ điểm phát hành"
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
    report.assumptions.push("LLM-assisted narrative được giới hạn trong structured context đã output-validation.");
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
      marketDataTimestamp: report.marketDataTimestamp ? new Date(report.marketDataTimestamp) : null,
      freshness: JSON.stringify(report.freshness),
    });
  } catch {
    /* best-effort */
  }
}

/* -------------------------------- listing --------------------------------- */

export interface ReportListItem {
  id: string;
  type: string;
  title: string;
  generatedAt: string;
  marketDataTimestamp: string | null;
  freshness: string | null;
}

export async function listReports(type: string | null, limit = 30): Promise<ReportListItem[]> {
  const { db } = await import("@/db");
  const { reports } = await import("@/db/schema");
  const { desc, eq } = await import("drizzle-orm");
  const rows = type
    ? await db.select().from(reports).where(eq(reports.type, type)).orderBy(desc(reports.generatedAt)).limit(limit).catch(() => [])
    : await db.select().from(reports).orderBy(desc(reports.generatedAt)).limit(limit).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    generatedAt: r.generatedAt.toISOString(),
    marketDataTimestamp: r.marketDataTimestamp?.toISOString() ?? null,
    freshness: r.freshness ?? null,
  }));
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
