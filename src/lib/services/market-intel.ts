import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import { getCrossAsset, crossAssetChanges, type CrossAssetItem } from "./cross-asset";
import { getVnQuotes, vnstockConfigured } from "./stocks";
import { computeMarketCondition, computeContributions, type MarketConditionResult, type ContributionRow } from "../engines/market-condition";
import { getVnSession, type VnSessionInfo } from "../vn/sessions";
import { VN_INDICES, getSecurity } from "../vn/master";
import type { FreshnessStatus, IndexQuote, Meta, NewsArticle } from "../types";

/**
 * MARKET INTELLIGENCE ENGINE — the homepage command center payload.
 * Composes: VN indices + breadth + liquidity + flow + cross-asset + condition
 * scores + index contributions, each carrying source/timestamp/freshness.
 */

export interface BreadthData {
  advancers: number;
  decliners: number;
  unchanged: number;
  source: string;
  available: boolean;
  note?: string;
}

export interface FlowData {
  foreignNet: number | null;
  propNet: number | null;
  etfNet: number | null;
  source: string;
  available: boolean;
  note: string;
}

export interface MarketIntel {
  session: VnSessionInfo;
  sessionHint: string;
  indices: IndexQuote[] | null;
  indicesAvailable: boolean;
  breadth: BreadthData;
  liquidity: { valueTraded: number | null; baseline: number | null; available: boolean; note: string };
  flow: FlowData;
  crossAsset: CrossAssetItem[];
  condition: MarketConditionResult;
  contributors: { positive: ContributionRow[]; negative: ContributionRow[]; hasWeights: boolean; note: string };
  news: NewsArticle[];
  sections: Record<string, FreshnessStatus>;
  vnDataNote: string | null;
}

const VN30_BOARD = ["VCB", "BID", "CTG", "TCB", "MBB", "VPB", "ACB", "STB", "HDB", "VIC", "VHM", "VRE", "HPG", "FPT", "VNM", "MSN", "MWG", "GAS", "PLX", "SSI", "POW", "SAB", "BCM", "GVR", "SHB", "TPB", "BVH", "PDR", "KDH", "VJC"];

export async function buildMarketIntel(): Promise<{ intel: MarketIntel; meta: Meta }> {
  const res = await cached("market:intel:v1", {
    ttlMs: 15_000,
    staleMs: 20 * 60_000,
    producer: async () => {
      const [snapRes, crossRes, boardRes] = await Promise.allSettled([
        buildMarketSnapshot(),
        getCrossAsset(),
        vnstockConfigured() ? getVnQuotes(VN30_BOARD) : Promise.resolve(null),
      ]);

      const snap = snapRes.status === "fulfilled" ? snapRes.value : null;
      const cross = crossRes.status === "fulfilled" ? crossRes.value : null;
      const board = boardRes.status === "fulfilled" ? boardRes.value : null;

      const indices = snap?.snapshot.indices ?? null;
      const indicesAvailable = Boolean(indices?.length);
      const session = getVnSession();

      /* breadth — real VN board when available, else declared proxy */
      let breadth: BreadthData;
      if (board?.quotes?.length) {
        const a = board.quotes.filter((q) => (q.changePercent ?? 0) > 0).length;
        const d = board.quotes.filter((q) => (q.changePercent ?? 0) < 0).length;
        breadth = { advancers: a, decliners: d, unchanged: board.quotes.length - a - d, source: board.meta.source, available: true };
      } else {
        breadth = {
          advancers: 0, decliners: 0, unchanged: 0,
          source: "vnstock",
          available: false,
          note: "Cần VNStock/VNDirect để tính độ rộng thực của HOSE/HNX/UPCoM — hệ thống không ước lượng thay.",
        };
      }

      /* liquidity — traded value vs baseline (requires VN value data) */
      const valueTraded = board?.quotes?.reduce((sum, q) => sum + (q.quoteVolume ?? 0), 0) ?? null;
      const liquidity = {
        valueTraded: valueTraded && valueTraded > 0 ? valueTraded : null,
        baseline: null as number | null,
        available: Boolean(valueTraded && valueTraded > 0),
        note: valueTraded ? "Tổng giá trị giao dịch rổ theo dõi; nền 20 phiên sẽ tính khi có chuỗi lịch sử." : "Cần dữ liệu giá trị giao dịch từ provider VN.",
      };

      /* capital flow — never fabricated */
      const flow: FlowData = {
        foreignNet: null, propNet: null, etfNet: null,
        source: "vnstock/vndirect",
        available: false,
        note: "Dòng vốn khối ngoại / tự doanh / ETF cần endpoint chuyên biệt từ provider VN. Hệ thống hiển thị UNAVAILABLE thay vì tạo số liệu giả định.",
      };

      /* condition engine */
      const cryptoSum = snap?.snapshot.crypto?.summary ?? null;
      const condition = computeMarketCondition({
        index: indices?.[0] ? { changePercent: indices[0].changePercent, value: indices[0].value, code: indices[0].code } : null,
        breadth: breadth.available ? { advancers: breadth.advancers, decliners: breadth.decliners, unchanged: breadth.unchanged } : null,
        liquidity: liquidity.available ? { valueTraded: liquidity.valueTraded, baseline: liquidity.baseline } : null,
        flow: null,
        crossAsset: cross ? crossAssetChanges(cross.items) : null,
        cryptoBreadth: cryptoSum
          ? { advancers: cryptoSum.advancers, decliners: cryptoSum.decliners, total: cryptoSum.marketCount, avgChange: cryptoSum.avgChangePercent }
          : null,
      });

      /* index contributions (weight × change) */
      const contribRows = (board?.quotes ?? []).map((q) => ({
        symbol: q.symbol,
        changePercent: q.changePercent ?? null,
        weightPct: null as number | null, // index weights require provider constituent data
      }));
      const contrib = computeContributions(indices?.[0]?.value ?? null, contribRows);

      return {
        intel: {
          session,
          sessionHint: snap?.snapshot.vnSessionHint ?? "",
          indices,
          indicesAvailable,
          breadth,
          liquidity,
          flow,
          crossAsset: cross?.items ?? [],
          condition,
          contributors: {
            ...contrib,
            note: contrib.hasWeights
              ? "Đóng góp điểm = giá trị chỉ số × tỷ trọng × %thay đổi."
              : "Chưa có tỷ trọng cấu phần chỉ số từ provider — bảng xếp theo %thay đổi và ghi rõ chưa quy đổi ra điểm số đóng góp.",
          },
          news: snap?.snapshot.news?.slice(0, 6) ?? [],
          sections: (snap?.meta.sections ?? {}) as Record<string, FreshnessStatus>,
          vnDataNote: indicesAvailable ? null : "VNStock/VNDirect chưa kết nối — các cấu phần VN hiển thị UNAVAILABLE, engine tự hạ độ tin cậy thay vì suy diễn.",
        } satisfies MarketIntel,
        newest: cross?.meta.sourceTimestamp ? Date.parse(cross.meta.sourceTimestamp) : Date.now(),
        crossMeta: cross?.meta ?? null,
      };
    },
  });

  const meta = buildMeta({
    source: "orca-market-intelligence",
    sourceTimestampMs: res.value.newest,
    cached: res.cached,
    stale: res.stale,
    sections: res.value.intel.sections,
    note: res.value.intel.vnDataNote ?? undefined,
  });
  return { intel: res.value.intel, meta };
}

/* --------------------------- index detail payload -------------------------- */

export interface IndexDetail {
  code: string;
  name: string;
  exchange: string;
  quote: IndexQuote | null;
  session: VnSessionInfo;
  breadth: BreadthData;
  pressure: { buying: number | null; selling: number | null; net: number | null; basis: string; available: boolean };
  contributors: { positive: ContributionRow[]; negative: ContributionRow[]; hasWeights: boolean; note: string };
  constituents: { symbol: string; name: string | null; sector: string | null; changePercent: number | null; price: number | null }[];
  intel: { trend: string; momentum: string; breadthState: string; liquidity: string; risks: string[] };
  available: boolean;
  note: string | null;
}

export async function buildIndexDetail(codeRaw: string): Promise<{ detail: IndexDetail; meta: Meta } | null> {
  const code = codeRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const def = VN_INDICES.find((i) => i.code === code || i.aliases.some((a) => a.toUpperCase().replace(/[^A-Z0-9]/g, "") === code));
  if (!def) return null;

  const { intel, meta } = await buildMarketIntel();
  const quote = intel.indices?.find((i) => i.code.replace(/[^A-Z0-9]/g, "") === def.code) ?? null;
  const board = vnstockConfigured() ? await getVnQuotes(VN30_BOARD) : null;

  const constituents = (board?.quotes ?? []).map((q) => {
    const sec = getSecurity(q.symbol);
    return { symbol: q.symbol, name: sec?.name ?? null, sector: sec?.sector ?? null, changePercent: q.changePercent ?? null, price: q.price ?? null };
  });

  /* buying/selling pressure from breadth + participation — NOT from index sign */
  const adv = intel.breadth.advancers;
  const dec = intel.breadth.decliners;
  const tot = adv + dec;
  const pressure = tot > 0
    ? {
        buying: Math.round((adv / tot) * 100),
        selling: Math.round((dec / tot) * 100),
        net: Math.round(((adv - dec) / tot) * 100),
        basis: "Tỷ lệ mã tăng/giảm trong rổ theo dõi (participation-based) — không suy ra từ dấu của chỉ số.",
        available: true,
      }
    : { buying: null, selling: null, net: null, basis: "Cần dữ liệu độ rộng thực để tính áp lực mua/bán — hệ thống không gán nhãn từ dấu chỉ số.", available: false };

  const detail: IndexDetail = {
    code: def.code,
    name: def.name,
    exchange: def.exchange,
    quote,
    session: intel.session,
    breadth: intel.breadth,
    pressure,
    contributors: intel.contributors,
    constituents,
    intel: {
      trend: quote ? (quote.changePercent > 0.4 ? "Tăng" : quote.changePercent < -0.4 ? "Giảm" : "Đi ngang") : "Chưa xác định (thiếu dữ liệu)",
      momentum: intel.condition.components.find((c) => c.key === "trend")?.score != null ? `${intel.condition.components.find((c) => c.key === "trend")?.score?.toFixed(0)}/100` : "—",
      breadthState: intel.breadth.available ? `${adv} tăng / ${dec} giảm / ${intel.breadth.unchanged} đứng giá` : "UNAVAILABLE",
      liquidity: intel.liquidity.available ? "Có dữ liệu giá trị giao dịch" : "UNAVAILABLE",
      risks: intel.condition.risks,
    },
    available: Boolean(quote),
    note: quote ? null : "Chỉ số này cần VNStock/VNDirect để hiển thị giá trị realtime — cấu trúc phân tích đã sẵn sàng.",
  };
  return { detail, meta };
}
