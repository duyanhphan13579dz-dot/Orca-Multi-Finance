import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import { getCrossAsset, crossAssetChanges, type CrossAssetItem } from "./cross-asset";
import { getVnQuotes, getVnMarketBoard, vnstockConfigured } from "./stocks";
import * as vndirect from "../providers/vndirect";
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
  const res = await cached("market:intel:v2", {
    ttlMs: 15_000,
    staleMs: 20 * 60_000,
    producer: async () => {
      const [snapRes, crossRes, boardRes] = await Promise.allSettled([
        buildMarketSnapshot(),
        getCrossAsset(),
        getVnQuotes(VN30_BOARD), // VNDirect path — không bắt buộc VNSTOCK_API_KEY
      ]);

      const snap = snapRes.status === "fulfilled" ? snapRes.value : null;
      const cross = crossRes.status === "fulfilled" ? crossRes.value : null;
      const board = boardRes.status === "fulfilled" ? boardRes.value : null;

      const indices = snap?.snapshot.indices ?? null;
      const indicesAvailable = Boolean(indices?.length);
      const session = getVnSession();

      /* breadth — prefer official index advances/declines, else VN30 board participation */
      let breadth: BreadthData;
      const idxStats = await vndirect.getVndIndexSessionStats("VNINDEX").catch(() => null);
      if (idxStats && (idxStats.advances > 0 || idxStats.declines > 0)) {
        breadth = {
          advancers: idxStats.advances,
          decliners: idxStats.declines,
          unchanged: idxStats.unchanged,
          source: "vndirect vnmarket_prices",
          available: true,
          note: `Phiên ${idxStats.date ?? "—"}`,
        };
      } else if (board?.quotes?.length) {
        const a = board.quotes.filter((q) => (q.changePercent ?? 0) > 0).length;
        const d = board.quotes.filter((q) => (q.changePercent ?? 0) < 0).length;
        breadth = { advancers: a, decliners: d, unchanged: board.quotes.length - a - d, source: board.meta.source, available: true };
      } else {
        breadth = {
          advancers: 0, decliners: 0, unchanged: 0,
          source: "vndirect",
          available: false,
          note: "Chưa lấy được thống kê tăng/giảm phiên từ VNDirect.",
        };
      }

      /* liquidity — traded value vs baseline (requires VN value data) */
      const valueTraded =
        idxStats?.value ??
        board?.quotes?.reduce((sum, q) => sum + (q.quoteVolume ?? 0), 0) ??
        null;
      const liquidity = {
        valueTraded: valueTraded && valueTraded > 0 ? valueTraded : null,
        baseline: null as number | null,
        available: Boolean(valueTraded && valueTraded > 0),
        note: valueTraded
          ? "Giá trị giao dịch phiên (chỉ số hoặc rổ theo dõi)."
          : "Cần dữ liệu giá trị giao dịch từ provider VN.",
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
        weightPct: null as number | null,
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
          vnDataNote: indicesAvailable ? null : "VNDirect/VNStock chưa phản hồi chỉ số — engine tự hạ độ tin cậy.",
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

  const [{ intel, meta }, statsRes, marketRes] = await Promise.all([
    buildMarketIntel(),
    vndirect.getVndIndexSessionStats(def.code).catch(() => null),
    getVnMarketBoard().catch(() => null),
  ]);

  const aliases = new Set(
    [def.code, ...def.aliases].map((a) => a.toUpperCase().replace(/[^A-Z0-9]/g, "")),
  );
  const quote =
    intel.indices?.find((i) => aliases.has(i.code.replace(/[^A-Z0-9]/g, ""))) ??
    marketRes?.indices.find((i) => aliases.has(i.code.replace(/[^A-Z0-9]/g, ""))) ??
    null;

  let breadth = intel.breadth;
  if (statsRes && (statsRes.advances > 0 || statsRes.declines > 0)) {
    breadth = {
      advancers: statsRes.advances,
      decliners: statsRes.declines,
      unchanged: statsRes.unchanged,
      source: "vndirect vnmarket_prices",
      available: true,
      note: `Phiên ${statsRes.date ?? "—"} · mã không GD ${statsRes.noTrade}`,
    };
  }

  const adv = breadth.advancers;
  const dec = breadth.decliners;
  const tot = adv + dec;
  const pressure =
    tot > 0
      ? {
          buying: Math.round((adv / tot) * 100),
          selling: Math.round((dec / tot) * 100),
          net: Math.round(((adv - dec) / tot) * 100),
          basis: "Tỷ lệ mã tăng/giảm trên sàn (participation-based) — không suy ra từ dấu chỉ số.",
          available: true,
        }
      : {
          buying: null,
          selling: null,
          net: null,
          basis: "Chưa có thống kê tăng/giảm phiên — hệ thống không gán nhãn từ dấu chỉ số.",
          available: false,
        };

  const quoteMap = new Map((marketRes?.quotes ?? []).map((q) => [q.symbol, q]));
  if (quoteMap.size < 10) {
    const targeted = await getVnQuotes(VN30_BOARD).catch(() => null);
    for (const q of targeted?.quotes ?? []) quoteMap.set(q.symbol, q);
  }

  const constituents = (def.code === "VN30" || def.code === "VNINDEX" || def.code === "VN100"
    ? VN30_BOARD
    : [...quoteMap.keys()].slice(0, 40))
    .map((sym) => {
      const q = quoteMap.get(sym);
      const sec = getSecurity(sym);
      return {
        symbol: sym,
        name: q?.name ?? sec?.name ?? null,
        sector: sec?.sector ?? null,
        changePercent: q?.changePercent ?? null,
        price: q?.price ?? null,
      };
    })
    .filter((c) => c.price != null)
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0));

  const contribSource = constituents
    .filter((c) => c.changePercent != null)
    .map((c) => ({ symbol: c.symbol, changePercent: c.changePercent, weightPct: null as number | null }));
  const computed = computeContributions(quote?.value ?? null, contribSource);
  const contributors = {
    ...computed,
    note: computed.hasWeights
      ? "Đóng góp điểm theo tỷ trọng chính thức"
      : "Chưa có bộ tỷ trọng rổ — hiển thị mã biến động mạnh nhất theo % (không quy đổi điểm chỉ số).",
  };

  const liquidityAvailable = statsRes?.value != null || intel.liquidity.available;
  const liquidityNote =
    statsRes?.value != null
      ? `GTGD phiên ${fmtCompactLocal(statsRes.value)}`
      : intel.liquidity.available
        ? "Có dữ liệu giá trị giao dịch"
        : "UNAVAILABLE";

  const detail: IndexDetail = {
    code: def.code,
    name: def.name,
    exchange: def.exchange,
    quote: quote
      ? {
          ...quote,
          volume: quote.volume ?? statsRes?.volume ?? null,
        }
      : null,
    session: intel.session,
    breadth,
    pressure,
    contributors,
    constituents: constituents.slice(0, 40),
    intel: {
      trend: quote
        ? quote.changePercent > 0.4
          ? "Tăng"
          : quote.changePercent < -0.4
            ? "Giảm"
            : "Đi ngang"
        : "Chưa xác định (thiếu dữ liệu)",
      momentum:
        intel.condition.components.find((c) => c.key === "trend")?.score != null
          ? `${intel.condition.components.find((c) => c.key === "trend")?.score?.toFixed(0)}/100`
          : "—",
      breadthState: breadth.available
        ? `${adv} tăng / ${dec} giảm / ${breadth.unchanged} đứng giá`
        : "UNAVAILABLE",
      liquidity: liquidityAvailable ? liquidityNote : "UNAVAILABLE",
      risks: intel.condition.risks,
    },
    available: Boolean(quote),
    note: quote
      ? statsRes
        ? `Breadth & KL từ VNDirect · phiên ${statsRes.date ?? "—"}`
        : null
      : "Chỉ số chưa có báo giá — kiểm tra kết nối VNDirect.",
  };

  const mergedMeta = buildMeta({
    source: meta.source,
    sourceTimestampMs: statsRes?.sourceTs ?? (meta.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : null),
    cached: meta.cached,
    stale: meta.stale,
    note: detail.note ?? meta.note,
  });

  return { detail, meta: mergedMeta };
}

function fmtCompactLocal(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
