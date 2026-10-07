import "server-only";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import type { Meta } from "../types";

/**
 * Legacy thin report helper — Morning Brief prefers full report-engine (Data Hub).
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
  // Ưu tiên engine đầy đủ (composers + Data Hub); fallback snapshot đơn giản nếu lỗi
  try {
    const { generateDailyReport } = await import("./report-engine");
    const { report: daily, meta } = await generateDailyReport("morning_brief");
    return {
      report: {
        type: "morning_brief",
        title: daily.title,
        subtitle: daily.subtitle,
        generatedAt: daily.generatedAt,
        marketDataTimestamp: daily.marketDataTimestamp,
        freshness: daily.freshness as unknown as Report["freshness"],
        sections: daily.sections,
      },
      meta,
    };
  } catch {
    /* fallback below */
  }

  const snap = await buildMarketSnapshot();
  const { snapshot, meta } = snap;
  const now = new Date();
  const vnNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const dateVi = vnNow.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const sections: ReportSection[] = [];
  const p = snapshot.pulse ?? { score: 0, headline: "", body: [] as string[] };

  sections.push({
    heading: "Bức tranh chung",
    tone: p.score > 0.15 ? "up" : p.score < -0.15 ? "down" : "neutral",
    paragraphs: [p.headline + ".", ...p.body.slice(0, 2)],
  });

  if (snapshot.indices?.length) {
    sections.push({
      heading: "Chứng khoán Việt Nam",
      tone: (snapshot.indices[0].changePercent ?? 0) > 0 ? "up" : "down",
      paragraphs: [
        snapshot.indices
          .slice(0, 4)
          .map(
            (i) =>
              `${i.code}: ${i.value.toLocaleString("vi-VN")} điểm (${i.changePercent != null && i.changePercent >= 0 ? "+" : ""}${i.changePercent?.toFixed(2) ?? "—"}%)`,
          )
          .join("; ") + ".",
      ],
    });
  } else {
    sections.push({
      heading: "Chứng khoán Việt Nam",
      tone: "neutral",
      paragraphs: ["Chưa có chỉ số VN trong snapshot — chờ nguồn LIVE."],
    });
  }

  if (snapshot.crypto) {
    const s = snapshot.crypto.summary;
    const top = snapshot.crypto.top.slice(0, 5);
    sections.push({
      heading: "Tài sản số",
      tone: s.avgChangePercent > 0 ? "up" : "down",
      paragraphs: [
        `Trên ${s.marketCount} mã: ${s.advancers} tăng / ${s.decliners} giảm; TB ${s.avgChangePercent >= 0 ? "+" : ""}${s.avgChangePercent.toFixed(2)}%.`,
        `Nhóm lớn: ${top.map((t) => `${t.baseAsset} ${t.changePercent != null ? (t.changePercent >= 0 ? "+" : "") + t.changePercent.toFixed(1) + "%" : "?"}`).join(", ")}.`,
      ],
    });
  }

  if (snapshot.forex) {
    const majors = snapshot.forex.rows.filter((r) => r.group === "major").slice(0, 5);
    sections.push({
      heading: "Ngoại hối",
      tone: "neutral",
      paragraphs: [
        majors.length
          ? majors
              .map(
                (r) =>
                  `${r.pair ?? r.symbol}: ${r.price != null ? r.price : "—"}${r.changePercent != null ? ` (${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}%)` : ""}`,
              )
              .join("; ")
          : "Chưa có majors.",
        snapshot.forex.usdStrengthNote ?? "",
      ].filter(Boolean),
    });
  }

  if (snapshot.news?.length) {
    sections.push({
      heading: "Tin nổi bật",
      tone: "neutral",
      paragraphs: (snapshot.news as { title?: string; source?: string }[])
        .slice(0, 6)
        .map((n) => `${n.title ?? "—"} — ${n.source ?? ""}.`),
    });
  }

  return {
    report: {
      type: "morning_brief",
      title: `ORCA Morning Brief — ${dateVi}`,
      subtitle: "Fallback snapshot · Data Hub path ưu tiên qua report-engine",
      generatedAt: now.toISOString(),
      marketDataTimestamp: meta.sourceTimestamp ?? null,
      freshness: (meta.sections as Record<string, string>) ?? {},
      sections,
    },
    meta: buildMeta({
      source: "orca-reports-legacy+snapshot",
      sourceTimestampMs: meta.sourceTimestamp ? Date.parse(String(meta.sourceTimestamp)) : null,
      note: "legacy fallback after report-engine",
    }),
  };
}
