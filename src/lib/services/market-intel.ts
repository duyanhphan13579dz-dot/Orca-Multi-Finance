import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import { getCrossAsset, crossAssetChanges, type CrossAssetItem } from "./cross-asset";
import { getVnQuotes, getVnMarketBoard, vnstockConfigured } from "./stocks";
import * as vndirect from "../providers/vndirect";
import { getCafefPropFlow } from "../providers/cafef";
import { computeMarketCondition, computeContributions, type MarketConditionResult, type ContributionRow } from "../engines/market-condition";
import { getVnSession, type VnSessionInfo } from "../vn/sessions";
import { VN_INDICES, getSecurity } from "../vn/master";
import type { FreshnessStatus, IndexQuote, Meta, NewsArticle } from "../types";

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

export interface CapitalFlowRow {
  symbol: string;
  buyVal: number;
  sellVal: number;
  netVal: number;
}

export interface CapitalFlowAnalysis {
  available: boolean;
  sessionDate: string | null;
  foreignBuy: number | null;
  foreignSell: number | null;
  foreignNet: number | null;
  stockCount: number;
  topNetBuy: CapitalFlowRow[];
  topNetSell: CapitalFlowRow[];
  source: string;
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
  const res = await cached("market:intel:v4", {
    ttlMs: 15_000,
    staleMs: 20 * 60_000,
    producer: async () => {
      const [snapRes, crossRes, boardRes, foreignRes, etfRes, propRes] = await Promise.allSettled([
        buildMarketSnapshot(),
        getCrossAsset(),
        getVnQuotes(VN30_BOARD),
        vndirect.getVndForeignFlow(),
        vndirect.getVndEtfFlow(),
        (async () => {
          const date = await vndirect.getVndLatestSessionDate();
          return getCafefPropFlow(date);
        })(),
      ]);

      const snap = snapRes.status === "fulfilled" ? snapRes.value : null;
      const cross = crossRes.status === "fulfilled" ? crossRes.value : null;
      const board = boardRes.status === "fulfilled" ? boardRes.value : null;
      const foreign = foreignRes.status === "fulfilled" ? foreignRes.value : null;
      const etf = etfRes.status === "fulfilled" ? etfRes.value : null;
      const prop = propRes.status === "fulfilled" ? propRes.value : null;

      const indices = snap?.snapshot.indices ?? null;
      const indicesAvailable = Boolean(indices?.length);
      const session = getVnSession();

      let breadth: BreadthData;
      const idxStats = await vndirect.getVndIndexSessionStats("VNINDEX").catch(() => null);
      if (idxStats && (idxStats.advances > 0 || idxStats.declines > 0)) {
        breadth = {
          advancers: idxStats.advances,
          decliners: idxStats.declines,
          unchanged: idxStats.unchanged,
          source: "vndirect vnmarket_prices",
          available: true,
          note: "Breadth từ VNDirect vnmarket_prices",
        };
      } else if (board?.quotes?.length) {
        const a = board.quotes.filter((q) => (q.changePercent ?? 0) > 0).length;
        const d = board.quotes.filter((q) => (q.changePercent ?? 0) < 0).length;
        breadth = {
          advancers: a,
          decliners: d,
          unchanged: board.quotes.length - a - d,
          source: board.meta.source,
          available: true,
        };
      } else {
        breadth = {
          advancers: 0,
          decliners: 0,
          unchanged: 0,
          source: "vndirect",
          available: false,
          note: "Chưa lấy được thống kê tăng/giảm phiên từ VNDirect.",
        };
      }

      const valueTraded =
        idxStats?.value ?? board?.quotes?.reduce((sum, q) => sum + (q.quoteVolume ?? 0), 0) ?? null;
      const liquidity = {
        valueTraded: valueTraded && valueTraded > 0 ? valueTraded : null,
        baseline: null as number | null,
        available: Boolean(valueTraded && valueTraded > 0),
        note: valueTraded
          ? "Giá trị giao dịch phiên (chỉ số hoặc rổ theo dõi)."
          : "Cần dữ liệu giá trị giao dịch từ provider VN.",
      };

      const sessionDate = foreign?.sessionDate ?? etf?.sessionDate ?? prop?.sessionDate ?? null;
      const parts: string[] = [];
      if (foreign) {
        parts.push(
          `Khối ngoại phiên ${foreign.sessionDate}: mua ${foreign.buyVal.toExponential(2)} / bán ${foreign.sellVal.toExponential(2)} (VND)`,
        );
      }
      if (prop) {
        parts.push(
          `Tự doanh: mua ${prop.buyVal.toExponential(2)} / bán ${prop.sellVal.toExponential(2)} (CafeF EOD)`,
        );
      } else {
        parts.push("Tự doanh: chưa có (CafeF EOD sau phiên)");
      }
      if (etf) {
        parts.push(
          `ETF NN: mua ${etf.buyVal.toExponential(2)} / bán ${etf.sellVal.toExponential(2)} (${etf.stockCount} mã)`,
        );
      } else {
        parts.push("ETF: chưa có nguồn phiên");
      }

      const flow: FlowData = {
        foreignNet: foreign?.netVal ?? null,
        propNet: prop?.netVal ?? null,
        etfNet: etf?.netVal ?? null,
        source:
          [foreign && "vndirect foreigns", prop && "cafef prop", etf && "vndirect etf"]
            .filter(Boolean)
            .join(" + ") || "unavailable",
        available: Boolean(foreign || prop || etf),
        note: parts.join(". ") + (sessionDate ? "." : ""),
      };

      const cryptoSum = snap?.snapshot.crypto?.summary ?? null;
      const condition = computeMarketCondition({
        index: indices?.[0]
          ? { changePercent: indices[0].changePercent, value: indices[0].value, code: indices[0].code }
          : null,
        breadth: breadth.available
          ? { advancers: breadth.advancers, decliners: breadth.decliners, unchanged: breadth.unchanged }
          : null,
        liquidity: liquidity.available
          ? { valueTraded: liquidity.valueTraded, baseline: liquidity.baseline }
          : null,
        flow: foreign || prop ? { foreignNet: foreign?.netVal ?? null, propNet: prop?.netVal ?? null } : null,
        crossAsset: cross ? crossAssetChanges(cross.items) : null,
        cryptoBreadth: cryptoSum
          ? {
              advancers: cryptoSum.advancers,
              decliners: cryptoSum.decliners,
              total: cryptoSum.marketCount,
              avgChange: cryptoSum.avgChangePercent,
            }
          : null,
      });

      const contribRows = (board?.quotes ?? []).map((q) => ({
        symbol: q.symbol,
        changePercent: q.changePercent ?? null,
        weightPct: null as number | null,
      }));
      const contributors = {
        ...computeContributions(indices?.[0]?.value ?? null, contribRows),
        note: "Đóng góp ước lượng theo % biến động rổ theo dõi (chưa có tỷ trọng chính thức).",
      };

      const news = snap?.snapshot.news ?? [];
      const sections: Record<string, FreshnessStatus> = {
        indices: indicesAvailable ? (snap?.meta.freshness ?? "FRESH") : "UNAVAILABLE",
        breadth: breadth.available ? "FRESH" : "UNAVAILABLE",
        liquidity: liquidity.available ? "FRESH" : "UNAVAILABLE",
        flow: flow.available ? "FRESH" : "UNAVAILABLE",
        crossAsset: cross ? cross.meta.freshness : "UNAVAILABLE",
      };

      const intel: MarketIntel = {
        session,
        sessionHint: session.label,
        indices,
        indicesAvailable,
        breadth,
        liquidity,
        flow,
        crossAsset: cross?.items ?? [],
        condition,
        contributors,
        news: news.slice(0, 12),
        sections,
        vnDataNote: flow.note,
      };

      const newest =
        prop?.sourceTs ??
        etf?.sourceTs ??
        foreign?.sourceTs ??
        (cross?.meta.sourceTimestamp ? Date.parse(cross.meta.sourceTimestamp) : Date.now());

      return {
        intel,
        meta: buildMeta({
          source: flow.source,
          sourceTimestampMs: newest,
          note: flow.note,
          slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
        }),
      };
    },
  });

  return res.value;
}

function fmtCompactLocal(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export interface IndexDetail {
  code: string;
  name: string;
  quote: IndexQuote | null;
  session: VnSessionInfo;
  capitalFlow: CapitalFlowAnalysis;
  contributors: {
    positive: ContributionRow[];
    negative: ContributionRow[];
    hasWeights: boolean;
    note: string;
  };
  liquidity: { available: boolean; note: string };
  sections: Record<string, FreshnessStatus>;
}

export async function buildIndexDetail(code: string): Promise<{ detail: IndexDetail; meta: Meta } | null> {
  const def = VN_INDICES.find((i) => i.code === code.toUpperCase()) ?? {
    code: code.toUpperCase(),
    name: code.toUpperCase(),
  };

  const [{ intel, meta }, statsRes, marketRes, foreignRes] = await Promise.all([
    buildMarketIntel(),
    vndirect.getVndIndexSessionStats(def.code).catch(() => null),
    getVnMarketBoard().catch(() => null),
    vndirect.getVndForeignFlow().catch(() => null),
  ]);

  const quote = intel.indices?.find((i) => i.code === def.code) ?? null;
  const constituents = (marketRes?.quotes ?? [])
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
      : "Chưa có bộ tỷ trọng rổ — hiển thị mã biến động mạnh nhất theo %.",
  };

  const capitalFlow: CapitalFlowAnalysis = foreignRes
    ? {
        available: true,
        sessionDate: foreignRes.sessionDate,
        foreignBuy: foreignRes.buyVal,
        foreignSell: foreignRes.sellVal,
        foreignNet: foreignRes.netVal,
        stockCount: foreignRes.stockCount,
        topNetBuy: foreignRes.topNetBuy.map((r) => ({
          symbol: r.symbol,
          buyVal: r.buyVal,
          sellVal: r.sellVal,
          netVal: r.netVal,
        })),
        topNetSell: foreignRes.topNetSell.map((r) => ({
          symbol: r.symbol,
          buyVal: r.buyVal,
          sellVal: r.sellVal,
          netVal: r.netVal,
        })),
        source: "vndirect foreigns",
        note: `Dòng tiền khối ngoại phiên ${foreignRes.sessionDate} (cổ phiếu listed). Tự doanh/ETF xem panel dòng vốn thị trường.`,
      }
    : {
        available: false,
        sessionDate: null,
        foreignBuy: null,
        foreignSell: null,
        foreignNet: null,
        stockCount: 0,
        topNetBuy: [],
        topNetSell: [],
        source: "vndirect foreigns",
        note: "Chưa lấy được thống kê khối ngoại phiên — hiển thị UNAVAILABLE, không ước lượng.",
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
    quote,
    session: intel.session,
    capitalFlow,
    contributors,
    liquidity: { available: liquidityAvailable, note: liquidityNote },
    sections: {
      quote: quote ? meta.freshness : "UNAVAILABLE",
      flow: capitalFlow.available ? "FRESH" : "UNAVAILABLE",
      liquidity: liquidityAvailable ? "FRESH" : "UNAVAILABLE",
      contributors: contributors.positive.length || contributors.negative.length ? "FRESH" : "UNAVAILABLE",
    },
  };

  return {
    detail,
    meta: buildMeta({
      source: meta.source,
      sourceTimestampMs:
        foreignRes?.sourceTs ?? statsRes?.sourceTs ?? (meta.sourceTimestamp ? Date.parse(meta.sourceTimestamp) : null),
      note: capitalFlow.note,
      slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
    }),
  };
}
