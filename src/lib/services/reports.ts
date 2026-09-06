import "server-only";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import type { Meta } from "../types";

/**
 * Report system — analyst-style narratives generated strictly AFTER fetching
 * the freshest snapshot (Report Freshness Gate). Every report records the
 * underlying data timestamps + freshness so readers know exactly what data
 * vintage they are looking at.
 */

export interface ReportSection {
  heading: string;
  tone: "up" | "down" | "neutral";
  paragraphs: string[];
}

export interface Report {
  type: "morning_brief";
  title: string;
  subtitle: string;
  generatedAt: string;
  marketDataTimestamp: string | null;
  freshness: Record<string, string>;
  sections: ReportSection[];
}

export async function generateMorningBrief(): Promise<{ report: Report; meta: Meta }> {
  const snap = await buildMarketSnapshot();
  const { snapshot, meta } = snap;
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const dateVi = vnNow.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });

  const sections: ReportSection[] = [];
  const p = snapshot.pulse;

  // 1. Tổng quan
  sections.push({
    heading: "Bức tranh chung",
    tone: p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral",
    paragraphs: [p.headline + ".", ...p.body.slice(0, 2)],
  });

  // 2. Việt Nam
  if (snapshot.indices?.length) {
    sections.push({
      heading: "Chứng khoán Việt Nam",
      tone: snapshot.indices[0].changePercent > 0 ? "up" : "down",
      paragraphs: [
        snapshot.indices
          .slice(0, 4)
          .map((i) => `${i.code}: ${i.value.toLocaleString("vi-VN")} điểm (${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%)`)
          .join("; ") +
          ". Cần quan sát thêm độ rộng và thanh khoản thực tế trước khi kết luận về chất lượng của nhịp điều chỉnh/tăng điểm.",
      ],
    });
  } else {
    sections.push({
      heading: "Chứng khoán Việt Nam",
      tone: "neutral",
      paragraphs: [
        "Nguồn dữ liệu VNDirect hiện chưa sẵn sàng (kết nối gián đoạn), nên bản tin hôm nay tạm thiếu phần chỉ số trong nước. Hệ thống ghi nhận trạng thái này một cách minh bạch thay vì lấp vào bằng số liệu cũ — khi kết nối phục hồi, phần này sẽ tự động cập nhật.",
      ],
    });
  }

  // 3. Crypto
  if (snapshot.crypto) {
    const s = snapshot.crypto.summary;
    const top = snapshot.crypto.top.slice(0, 5);
    sections.push({
      heading: "Tài sản số",
      tone: s.avgChangePercent > 0 ? "up" : "down",
      paragraphs: [
        `Trên ${s.marketCount} mã USDT có thanh khoản, ${s.advancers} mã tăng và ${s.decliners} mã giảm trong 24 giờ qua; mức biến động bình quân ${s.avgChangePercent >= 0 ? "+" : ""}${s.avgChangePercent.toFixed(2)}%. Tổng khối lượng quy đổi đạt khoảng $${(s.totalQuoteVolume / 1e9).toFixed(1)} tỷ.`,
        `Nhóm vốn hóa lớn: ${top.map((t) => `${t.baseAsset} ${t.changePercent != null ? (t.changePercent >= 0 ? "+" : "") + t.changePercent.toFixed(1) + "%" : "?"}`).join(", ")}.`,
      ],
    });
  }

  // 4. Forex
  if (snapshot.forex) {
    const majors = snapshot.forex.rows.filter((r) => r.group === "major").slice(0, 5);
    sections.push({
      heading: "Ngoại hối",
      tone: "neutral",
      paragraphs: [
        snapshot.forex.usdStrengthNote,
        majors
          .map((r) => `${r.symbol} ${r.price >= 100 ? r.price.toFixed(2) : r.price.toFixed(4)}${r.changePercent != null ? ` (${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}%)` : ""}`)
          .join("; ") + ".",
        "Số liệu tỷ giá là tham chiếu từ nguồn công khai (exchangerate-api/ECB) khi Biquote chưa được cấu hình — phù hợp để quan sát xu hướng, cần đối chiếu giá giao dịch trước khi hành động.",
      ],
    });
  }

  // 5. Hàng hóa
  if (snapshot.commodities?.length) {
    sections.push({
      heading: "Hàng hóa",
      tone: "neutral",
      paragraphs: [
        snapshot.commodities
          .slice(0, 8)
          .map((c) => `${c.commodity}: ${c.price.toLocaleString("vi-VN")} ${c.unit ?? ""}${c.changePercent != null ? ` (${c.changePercent >= 0 ? "+" : ""}${c.changePercent.toFixed(2)}%)` : ""}`)
          .join("; ") + ".",
        "Diễn biến hàng hóa đầu vào (dầu, thép, nông sản) thường lan sang lợi nhuận các nhóm ngành tương ứng tại Việt Nam theo độ trễ nhất định — xem bản đồ tác động tại mục Commodities.",
      ],
    });
  }

  // 6. Tin doanh nghiệp & vĩ mô
  if (snapshot.news?.length) {
    sections.push({
      heading: "Dòng tin đáng chú ý",
      tone: "neutral",
      paragraphs: snapshot.news.slice(0, 6).map((n) => `${n.title} — ${n.source}.`),
    });
  }

  // 7. Triển vọng & rủi ro
  sections.push({
    heading: "Điều cần theo dõi trong phiên",
    tone: "neutral",
    paragraphs: [
      p.score >= 0.15
        ? "Dòng tiền đang nghiêng về tài sản rủi ro, nhưng độ rộng chưa đồng thuận hoàn toàn — ưu tiên các nhóm có thanh khoản xác nhận thay vì đuổi những mã đã tăng nóng. Theo dõi phản ứng của BTC tại các vùng kháng cự gần và diễn biến USD."
        : p.score <= -0.15
          ? "Ưu thế phòng thủ đang hiện hữu: các nhịp hồi nên được kiểm chứng bằng thanh khoản trước khi coi là đảo chiều. Quản trị tỷ trọng, tránh đòn bẩy cao khi volatility giãn nở."
          : "Thị trường phân hóa mạnh — đây là giai đoạn chọn lọc cổ phiếu/tài sản theo câu chuyện riêng hơn là đánh theo beta. Kiên nhẫn chờ xác nhận ở các vùng hỗ trợ quan trọng.",
      "Lưu ý: nội dung bản tin được dựng hoàn toàn từ dữ liệu thị trường realtime tại thờ điểm phát hành, phục vụ mục đích nghiên cứu — không phải khuyến nghị đầu tư.",
    ],
  });

  const report: Report = {
    type: "morning_brief",
    title: `ORCA Morning Brief — ${dateVi}`,
    subtitle: "Tổng hợp từ dữ liệu thị trường mới nhất tại thờ điểm phát hành",
    generatedAt: now.toISOString(),
    marketDataTimestamp: meta.sourceTimestamp,
    freshness: (meta.sections ?? {}) as Record<string, string>,
    sections,
  };
  void persist(report);
  const outMeta = buildMeta({
    source: "orca-report-engine",
    sourceTimestampMs: meta.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : null,
    sections: meta.sections,
    note: "Dữ liệu sử dụng: " + Object.entries(meta.sections ?? {}).map(([k, v]) => `${k}=${v}`).join(", "),
  });
  return { report, meta: outMeta };
}

async function persist(report: Report) {
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
