import "server-only";
import { buildMeta, worstFreshness } from "../freshness";
import { cached } from "../cache";
import { getCryptoMarkets, getCryptoDetail, type CryptoSummary } from "./crypto";
import { getForexMarkets } from "./forex";
import { getCommodityMarket } from "./commodities";
import { getVnIndices } from "./stocks";
import { getNews } from "./news";
import { getVnSession, sessionFreshnessHint, type VnSessionInfo } from "../vn/sessions";
import type {
  CommodityRow, CryptoMarketRow, ForexRow, FreshnessStatus, IndexQuote, Meta, NewsArticle,
} from "../types";

/**
 * Central market snapshot — single aggregation point consumed by the
 * dashboard, reports, and the AI agent (avoids per-component provider storms).
 */

export interface PulseResult {
  score: number; // -1 .. +1 composite risk-appetite
  headline: string;
  body: string[];
  drivers: { label: string; value: string; tone: "up" | "down" | "neutral" }[];
}

export interface MarketSnapshot {
  indices: IndexQuote[] | null;
  crypto: { top: CryptoMarketRow[]; summary: CryptoSummary } | null;
  forex: { rows: ForexRow[]; usdStrengthNote: string } | null;
  commodities: CommodityRow[] | null;
  news: NewsArticle[] | null;
  pulse: PulseResult;
  /** Vietnam market session (exchange-calendar awareness) */
  vnSession: VnSessionInfo;
  vnSessionHint: string;
}

interface SnapshotPayload {
  snapshot: MarketSnapshot;
  sections: Record<string, FreshnessStatus>;
  freshestTs: number | null;
  notes: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

/** Race provider với timeout — snapshot không đợi nguồn chậm, trả partial ngay */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.then((v) => { clearTimeout(timer); return v; }, () => { clearTimeout(timer); return fallback; }), timeout]);
}

export async function buildMarketSnapshot(): Promise<{ snapshot: MarketSnapshot; meta: Meta }> {
  const res = await cached("market:snapshot", {
    ttlMs: 20_000,
    staleMs: 10 * 60_000,
    producer: async (): Promise<SnapshotPayload> => {
      // Mỗi provider chỉ được 3.5s — nếu chậm hơn, coi như UNAVAILABLE và trả partial để ticker không treo
      const vnP = withTimeout(getVnIndices().catch(() => null), 3_500, null);
      const cryptoP = withTimeout(getCryptoMarkets().catch(() => null), 3_500, null);
      const forexP = withTimeout(getForexMarkets().catch(() => null), 3_500, null);
      const commP = withTimeout(getCommodityMarket().catch(() => null), 3_500, null);
      const newsP = withTimeout(getNews({ limit: 10 }).catch(() => null), 3_500, null);
      const [vnRes, cryptoRes, forexRes, commRes, newsRes] = await Promise.allSettled([vnP, cryptoP, forexP, commP, newsP]);
      const sections: Record<string, FreshnessStatus> = {
        vn_stocks: vnRes.status === "fulfilled" && vnRes.value ? vnRes.value.meta.freshness : "UNAVAILABLE",
        crypto: cryptoRes.status === "fulfilled" && cryptoRes.value ? cryptoRes.value.meta.freshness : "UNAVAILABLE",
        forex: forexRes.status === "fulfilled" && forexRes.value ? forexRes.value.meta.freshness : "UNAVAILABLE",
        commodities: commRes.status === "fulfilled" && commRes.value ? commRes.value.meta.freshness : "UNAVAILABLE",
        news: newsRes.status === "fulfilled" && newsRes.value ? newsRes.value.meta.freshness : "UNAVAILABLE",
      };
      const indices = vnRes.status === "fulfilled" ? vnRes.value?.items ?? null : null;
      const crypto = cryptoRes.status === "fulfilled" && cryptoRes.value
        ? { top: cryptoRes.value.rows.slice(0, 60), summary: cryptoRes.value.summary }
        : null;
      const forex = forexRes.status === "fulfilled" ? forexRes.value?.data ?? null : null;
      const commodities = commRes.status === "fulfilled" ? commRes.value?.data.rows ?? null : null;
      const news = newsRes.status === "fulfilled" ? newsRes.value?.articles ?? null : null;

      const tsCandidates = [
        crypto ? Date.parse(crypto.summary.fetchedAt) : null,
        forex?.rows[0]?.updatedAt ? Date.parse(forex.rows[0].updatedAt) : null,
        news?.[0] ? Date.parse(news[0].publishedAt) : null,
      ].filter((x): x is number => x != null);
      const freshestTs = tsCandidates.length ? Math.max(...tsCandidates) : null;

      const pulse = composePulse({ indices, crypto, forex, commodities, news, vnUnavailable: sections.vn_stocks === "UNAVAILABLE" });
      const notes: string[] = [];
      if (sections.vn_stocks === "UNAVAILABLE") notes.push("VNStock chưa khả dụng — nhóm dữ liệu chứng khoán Việt Nam đang ở trạng thái UNAVAILABLE");
      if (sections.forex === "DELAYED" || sections.forex === "STALE") notes.push("Forex đang dùng tỷ giá tham chiếu ngày (ECB/exchangerate-api)");
      const vnSession = getVnSession();
      return {
        snapshot: { indices, crypto, forex, commodities, news, pulse, vnSession, vnSessionHint: sessionFreshnessHint(vnSession.state) },
        sections, freshestTs, notes,
      };
    },
  });
  const meta = buildMeta({
    source: "orca-market-engine",
    sourceTimestampMs: res.value.freshestTs,
    cached: res.cached,
    stale: res.stale,
    partial: Object.values(res.value.sections).some((s) => s !== "LIVE" && s !== "FRESH"),
    degraded: Object.values(res.value.sections).includes("DEGRADED"),
    note: res.value.notes.join(" • ") || undefined,
    sections: res.value.sections,
  });
  return { snapshot: res.value.snapshot, meta };
}

/* ------------------------------ pulse engine ------------------------------- */

function composePulse(args: {
  indices: IndexQuote[] | null;
  crypto: { top: CryptoMarketRow[]; summary: CryptoSummary } | null;
  forex: { rows: ForexRow[]; usdStrengthNote: string } | null;
  commodities: CommodityRow[] | null;
  news: NewsArticle[] | null;
  vnUnavailable: boolean;
}): PulseResult {
  const { indices, crypto, forex, commodities, news, vnUnavailable } = args;
  const drivers: PulseResult["drivers"] = [];
  let score = 0;

  // crypto risk-appetite component (weight depends on VN availability)
  if (crypto) {
    const s = crypto.summary;
    const breadth = (s.advancers - s.decliners) / Math.max(s.marketCount, 1);
    const trendPart = clamp(s.avgChangePercent / 3, -1, 1);
    score += (trendPart * 0.55 + breadth * 0.2) * (vnUnavailable ? 1 : 0.7);
    drivers.push({
      label: "Độ rộng crypto",
      value: `${s.advancers} tăng / ${s.decliners} giảm (trên ${s.marketCount} mã)`,
      tone: breadth > 0.1 ? "up" : breadth < -0.1 ? "down" : "neutral",
    });
    if (s.btcChangePercent != null) {
      drivers.push({ label: "BTC 24h", value: fmtPct(s.btcChangePercent), tone: s.btcChangePercent > 0 ? "up" : s.btcChangePercent < 0 ? "down" : "neutral" });
    }
  }
  if (indices?.length && !vnUnavailable) {
    const idx = indices[0];
    score += clamp(idx.changePercent / 1.2, -1, 1) * 0.3;
    drivers.push({ label: idx.code, value: `${idx.value.toLocaleString("vi-VN")} (${fmtPct(idx.changePercent)})`, tone: idx.changePercent > 0 ? "up" : idx.changePercent < 0 ? "down" : "neutral" });
  }
  score = clamp(score, -1, 1);

  const gold = commodities?.find((c) => c.symbol === "XAUUSD") ?? null;
  if (gold?.changePercent != null) {
    drivers.push({ label: "Vàng thế giới", value: fmtPct(gold.changePercent), tone: gold.changePercent > 0 ? "up" : gold.changePercent < 0 ? "down" : "neutral" });
  }
  const wti = commodities?.find((c) => c.symbol === "CL");
  if (wti?.changePercent != null) drivers.push({ label: "Dầu WTI", value: fmtPct(wti.changePercent), tone: wti.changePercent > 0 ? "up" : wti.changePercent < 0 ? "down" : "neutral" });
  if (news) {
    const hot = news.filter((n) => Date.now() - Date.parse(n.publishedAt) < 3 * 3_600_000).length;
    drivers.push({ label: "Luồng tin (3h)", value: `${hot} bài mới`, tone: "neutral" });
  }

  const headline =
    score >= 0.45
      ? "Dòng tiền đang nghiêng mạnh về phía tài sản rủi ro"
      : score >= 0.15
        ? "Sắc thái tích cực, dòng tiền vẫn có chọn lọc"
        : score > -0.15
          ? "Thị trường phân hóa, chưa hình thành xu hướng thống nhất"
          : score > -0.45
            ? "Ưu thế phòng thủ đang dần được thiết lập"
            : "Tâm lý né rủi ro bao trùm các nhóm tài sản";

  const body: string[] = [];
  if (crypto) {
    const s = crypto.summary;
    const btcTxt = s.btcChangePercent != null ? `BTC ${s.btcChangePercent >= 0 ? "tăng" : "giảm"} ${Math.abs(s.btcChangePercent).toFixed(2)}%` : "BTC chưa rõ hướng";
    const ethTxt = s.ethChangePercent != null ? `, ETH ${fmtPct(s.ethChangePercent)}` : "";
    body.push(
      `Khối tài sản crypto cho thấy ${btcTxt}${ethTxt} trong 24 giờ qua; độ rộng thị trường nghiêng về phía ${s.advancers >= s.decliners ? "tăng điểm" : "giảm điểm"} với ${s.advancers} mã xanh và ${s.decliners} mã đỏ trên tổng ${s.marketCount} mã giao dịch sôi động. Mức biến động trung bình toàn thị trường ở ngưỡng ${fmtPct(s.avgChangePercent)}.`,
    );
  }
  if (indices?.length && !vnUnavailable) {
    const list = indices
      .slice(0, 4)
      .map((i) => `${i.code} ${fmtPct(i.changePercent)}`)
      .join(", ");
    body.push(`Tại Việt Nam — sản phẩm lõi của ORCA — các chỉ số chính ghi nhận ${list}. Đây là tín hiệu ngắn hạn cần đối chiếu thêm với độ rộng và thanh khoản từng nhóm ngành trước khi kết luận về xu hướng trong nước.`);
  } else {
    body.push(
      "Mảng chứng khoán Việt Nam hiện chưa có dữ liệu trực tiếp: kết nối VNStock chưa được cấu hình hoặc đang gián đoạn. Bức tranh tổng thể dưới đây được dựng từ crypto, ngoại hối, hàng hóa và dòng tin — các phần vẫn đang cập nhật bình thường và được ghi nhãn rõ ràng. Lịch phiên HOSE/HNX vẫn được theo dõi đầy đủ tại VN Market Center.",
    );
  }
  if (forex) body.push(forex.usdStrengthNote);
  if (commodities?.length) {
    const parts = commodities
      .filter((c) => ["XAUUSD", "CL", "SJC"].includes(c.symbol) && c.changePercent != null)
      .map((c) => `${c.commodity} ${fmtPct(c.changePercent)}`);
    if (parts.length) body.push(`Mặt hàng đáng chú ý: ${parts.join("; ")}. Biến động hàng hóa đầu vào thường lan sang các nhóm ngành tương ứng của thị trường Việt Nam với độ trễ nhất định.`);
  }
  return { score, headline, body, drivers };
}

/* convenience re-exports for the agent */
export { getCryptoDetail };
