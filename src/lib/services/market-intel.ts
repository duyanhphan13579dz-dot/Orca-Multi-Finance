import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import { getCrossAsset, crossAssetChanges, type CrossAssetItem } from "./cross-asset";
import { getVnQuotes, getVnMarketBoard, vnstockConfigured } from "./stocks";
import * as vndirect from "../providers/vndirect";
import { getCafefPropFlow } from "../providers/cafef";
import { computeMarketCondition, computeContributions, type MarketConditionResult, type ContributionRow } from "../engines/market-condition";
import type { SectorTrendRow } from "./sector-trend";
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
  highlights?: {
    topValue: { symbol: string; valueVnd: number; changePercent: number | null }[];
    limitUp: number;
    limitDown: number;
    available: boolean;
  } | null;
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
      const [snapRes, crossRes, boardRes, fullBoardRes, foreignRes, etfRes, propRes] = await Promise.allSettled([
        buildMarketSnapshot(),
        getCrossAsset(),
        getVnQuotes(VN30_BOARD),
        getVnMarketBoard(),
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
      const fullBoard = fullBoardRes.status === "fulfilled" ? fullBoardRes.value : null;
      const foreign = foreignRes.status === "fulfilled" ? foreignRes.value : null;
      const etf = etfRes.status === "fulfilled" ? etfRes.value : null;
      const prop = propRes.status === "fulfilled" ? propRes.value : null;

      /* Board highlights: top GTGD + trần/sàn (chỉ khi có full board). */
      const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
      const topValue = (fullBoard?.quotes ?? [])
        .filter((q) => (q.quoteVolume ?? 0) > 0)
        .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0))
        .slice(0, 5)
        .map((q) => ({ symbol: q.symbol, valueVnd: q.quoteVolume ?? 0, changePercent: q.changePercent ?? null }));
      const limitUp = (fullBoard?.quotes ?? []).filter(
        (q) => q.ceilingPrice != null && q.price > 0 && same(q.price, q.ceilingPrice),
      ).length;
      const limitDown = (fullBoard?.quotes ?? []).filter(
        (q) => q.floorPrice != null && q.price > 0 && same(q.price, q.floorPrice),
      ).length;
      const highlights =
        fullBoard?.quotes?.length
          ? { topValue, limitUp, limitDown, available: topValue.length > 0 }
          : null;

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
        sessionHint: session.labelVi,
        indices,
        indicesAvailable,
        breadth,
        liquidity,
        flow,
        crossAsset: cross?.items ?? [],
        condition,
        contributors,
        highlights,
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

export interface IndexConstituent {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
}

export interface IndexDetail {
  code: string;
  name: string;
  exchange: string;
  note: string | null;
  quote: IndexQuote | null;
  session: VnSessionInfo;
  pressure: {
    available: boolean;
    buying: number;
    selling: number;
    net: number | null;
    basis: string;
  };
  breadth: BreadthData;
  intel: {
    trend: string;
    momentum: string;
    breadthState: string;
    liquidity: string;
  };
  capitalFlow: CapitalFlowAnalysis;
  contributors: {
    positive: ContributionRow[];
    negative: ContributionRow[];
    hasWeights: boolean;
    note: string;
  };
  constituents: IndexConstituent[];
  liquidity: { available: boolean; note: string };
  sections: Record<string, FreshnessStatus>;
}

export async function buildIndexDetail(code: string): Promise<{ detail: IndexDetail; meta: Meta } | null> {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const def =
    VN_INDICES.find(
      (i) => i.code === raw || i.aliases?.some((a) => a.toUpperCase().replace(/[^A-Z0-9]/g, "") === raw),
    ) ?? null;
  if (!def) return null;

  const [{ intel, meta }, statsRes, marketRes, foreignRes] = await Promise.all([
    buildMarketIntel(),
    vndirect.getVndIndexSessionStats(def.code).catch(() => null),
    getVnMarketBoard().catch(() => null),
    vndirect.getVndForeignFlow().catch(() => null),
  ]);

  const quote =
    intel.indices?.find((i) => i.code === def.code || i.code === vndirect.vndIndexCode(def.code)) ?? null;
  const boardQuotes = (marketRes?.quotes ?? [])
    .filter((c) => c.price != null)
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0));

  const contribSource = boardQuotes
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

  let pressure: IndexDetail["pressure"];
  if (capitalFlow.available && capitalFlow.foreignBuy != null && capitalFlow.foreignSell != null) {
    const total = capitalFlow.foreignBuy + capitalFlow.foreignSell;
    const buying = total > 0 ? Math.round((capitalFlow.foreignBuy / total) * 100) : 50;
    const selling = 100 - buying;
    pressure = {
      available: true,
      buying,
      selling,
      net: capitalFlow.foreignNet,
      basis: `Tỷ trọng mua/bán theo GT khối ngoại phiên ${capitalFlow.sessionDate ?? "—"} (toàn thị trường listed).`,
    };
  } else {
    pressure = {
      available: false,
      buying: 0,
      selling: 0,
      net: null,
      basis: "Chưa có dữ liệu áp lực mua/bán từ khối ngoại cho phiên này.",
    };
  }

  const breadth: BreadthData =
    statsRes && (statsRes.advances > 0 || statsRes.declines > 0)
      ? {
          advancers: statsRes.advances,
          decliners: statsRes.declines,
          unchanged: statsRes.unchanged,
          source: "vndirect vnmarket_prices",
          available: true,
          note: `Độ rộng sàn gắn với ${def.code}`,
        }
      : intel.breadth;

  const trendComp = intel.condition.components.find((c) => c.key === "trend");
  const liqComp = intel.condition.components.find((c) => c.key === "liquidity");
  const breadthComp = intel.condition.components.find((c) => c.key === "breadth");
  const intelBlock = {
    trend:
      trendComp?.available && trendComp.score != null ? `${Math.round(trendComp.score)}/100` : "UNAVAILABLE",
    momentum:
      intel.condition.score != null
        ? `${Math.round(intel.condition.score)} (${intel.condition.rating})`
        : "UNAVAILABLE",
    breadthState:
      breadthComp?.available && breadthComp.score != null
        ? `${Math.round(breadthComp.score)}/100`
        : breadth.available
          ? `${breadth.advancers}↑ ${breadth.decliners}↓`
          : "UNAVAILABLE",
    liquidity:
      liqComp?.available && liqComp.score != null
        ? `${Math.round(liqComp.score)}/100`
        : liquidityAvailable
          ? liquidityNote
          : "UNAVAILABLE",
  };

  const constituents: IndexConstituent[] = boardQuotes.slice(0, 40).map((q) => {
    const sec = getSecurity(q.symbol);
    return {
      symbol: q.symbol,
      name: sec?.name ?? null,
      sector: sec?.sector ?? null,
      price: q.price ?? null,
      changePercent: q.changePercent ?? null,
    };
  });

  const detail: IndexDetail = {
    code: def.code,
    name: def.name,
    exchange: def.exchange,
    note: quote ? null : `Chưa lấy được quote chỉ số ${def.code} từ nguồn VN — giữ trạng thái UNAVAILABLE.`,
    quote,
    session: intel.session,
    pressure,
    breadth,
    intel: intelBlock,
    capitalFlow,
    contributors,
    constituents,
    liquidity: { available: liquidityAvailable, note: liquidityNote },
    sections: {
      quote: quote ? meta.freshness : "UNAVAILABLE",
      flow: capitalFlow.available ? "FRESH" : "UNAVAILABLE",
      liquidity: liquidityAvailable ? "FRESH" : "UNAVAILABLE",
      contributors: contributors.positive.length || contributors.negative.length ? "FRESH" : "UNAVAILABLE",
      breadth: breadth.available ? "FRESH" : "UNAVAILABLE",
      pressure: pressure.available ? "FRESH" : "UNAVAILABLE",
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

/* ============================================================================
 * VN MARKET SUMMARY — pure (no I/O) builder consumed by the AI agent.
 *
 * Turns an already-computed `MarketIntel` (+ optional sector trend) into
 * (a) structured `facts` that enrich the LLM data-contract, and (b) a set of
 * deterministic Vietnamese narrative `lines` (liquidity / breadth / money flow /
 * impactful stocks / sectors / overall condition) so the answer stays rich even
 * on the no-LLM deterministic path. Every number comes from the engines above —
 * nothing is invented.
 * ========================================================================== */

const sumPct = (x: number | null | undefined, d = 2): string =>
  x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(d)}%`;

/** VND (đồng) → "… tỷ" với dấu nghìn vi-VN. */
const sumTy = (vnd: number | null | undefined): string =>
  vnd == null || !Number.isFinite(vnd)
    ? "—"
    : `${(vnd / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} tỷ`;

export interface VnMarketSummary {
  /** đưa thẳng vào contract.facts cho LLM */
  facts: Record<string, unknown>;
  /** các dòng narrative deterministik */
  lines: string[];
}

export function summarizeVnMarket(
  intel: MarketIntel,
  sectors?: { leaders: SectorTrendRow[]; laggards: SectorTrendRow[] } | null,
): VnMarketSummary {
  const lines: string[] = [];

  if (intel.breadth.available) {
    const ratio =
      intel.breadth.advancers + intel.breadth.decliners > 0
        ? (intel.breadth.advancers / (intel.breadth.advancers + intel.breadth.decliners)).toFixed(2)
        : "—";
    lines.push(
      `Độ rộng: ${intel.breadth.advancers} mã tăng / ${intel.breadth.decliners} mã giảm / ${intel.breadth.unchanged} đứng giá (tỷ lệ tăng/giảm ${ratio}).`,
    );
  }

  if (intel.liquidity.available && intel.liquidity.valueTraded != null) {
    lines.push(`Thanh khoản: giá trị giao dịch ≈ ${sumTy(intel.liquidity.valueTraded)} đồng.`);
  }

  if (intel.flow.available) {
    const bits: string[] = [];
    if (intel.flow.foreignNet != null) bits.push(`khối ngoại ròng ${sumTy(intel.flow.foreignNet)} đồng`);
    if (intel.flow.propNet != null) bits.push(`tự doanh ròng ${sumTy(intel.flow.propNet)} đồng`);
    if (intel.flow.etfNet != null) bits.push(`ETF ròng ${sumTy(intel.flow.etfNet)} đồng`);
    if (bits.length) lines.push(`Dòng tiền: ${bits.join(" · ")}.`);
  }

  const pos = intel.contributors.positive.slice(0, 5);
  const neg = intel.contributors.negative.slice(0, 5);
  const fmtContrib = (c: ContributionRow): string =>
    `${c.symbol} ${sumPct(c.changePercent)}${c.indexPoints != null ? ` (${c.indexPoints > 0 ? "+" : ""}${c.indexPoints.toFixed(1)}đ)` : ""}`;
  if (pos.length) lines.push(`Mã nâng đỡ: ${pos.map(fmtContrib).join(", ")}.`);
  if (neg.length) lines.push(`Mã gây áp lực: ${neg.map(fmtContrib).join(", ")}.`);

  if (sectors && (sectors.leaders.length || sectors.laggards.length)) {
    const s = (r: SectorTrendRow): string => `${r.sector} ${sumPct(r.avgChangePercent)}`;
    const bits: string[] = [];
    if (sectors.leaders.length) bits.push(`dẫn dắt: ${sectors.leaders.slice(0, 3).map(s).join(", ")}`);
    if (sectors.laggards.length) bits.push(`kém nhất: ${sectors.laggards.slice(0, 3).map(s).join(", ")}`);
    lines.push(`Ngành — ${bits.join(" · ")}.`);
  }

  if (intel.highlights?.available) {
    if (intel.highlights.limitUp > 0 || intel.highlights.limitDown > 0) {
      lines.push(`Trần/sàn: ${intel.highlights.limitUp} mã trần / ${intel.highlights.limitDown} mã sàn.`);
    }
    if (intel.highlights.topValue.length) {
      lines.push(
        `Thanh khoản tập trung: ${intel.highlights.topValue.map((t) => `${t.symbol} ${sumTy(t.valueVnd)}${sumPct(t.changePercent) !== "—" ? ` (${sumPct(t.changePercent)})` : ""}`).join(", ")}.`,
      );
    }
  }

  const cond = intel.condition;
  lines.push(
    `Nhận định chung: trạng thái ${cond.rating} (điểm ${cond.score}/100, độ tin cậy ${cond.confidence}); tâm lý liên tài sản ${cond.crossAssetState}.`,
  );
  if (cond.drivers.length) lines.push(`Động lực: ${cond.drivers.slice(0, 3).join("; ")}.`);
  if (cond.risks.length) lines.push(`Rủi ro: ${cond.risks.slice(0, 3).join("; ")}.`);

  const facts: Record<string, unknown> = {
    breadth: intel.breadth.available
      ? { advancers: intel.breadth.advancers, decliners: intel.breadth.decliners, unchanged: intel.breadth.unchanged, source: intel.breadth.source }
      : null,
    liquidity: intel.liquidity.available
      ? {
          value_traded_vnd: intel.liquidity.valueTraded,
          value_traded_ty: intel.liquidity.valueTraded != null ? Number((intel.liquidity.valueTraded / 1e9).toFixed(0)) : null,
        }
      : null,
    money_flow: intel.flow.available
      ? {
          foreign_net_vnd: intel.flow.foreignNet,
          foreign_net_ty: intel.flow.foreignNet != null ? Number((intel.flow.foreignNet / 1e9).toFixed(0)) : null,
          prop_net_vnd: intel.flow.propNet,
          etf_net_vnd: intel.flow.etfNet,
          source: intel.flow.source,
        }
      : null,
    index_contributors: { positive: pos, negative: neg, note: intel.contributors.note },
    board_highlights: intel.highlights ?? null,
    sectors: sectors
      ? { leaders: sectors.leaders.slice(0, 5), laggards: sectors.laggards.slice(0, 5) }
      : null,
    market_condition: {
      rating: cond.rating,
      score: cond.score,
      confidence: cond.confidence,
      cross_asset_state: cond.crossAssetState,
      drivers: cond.drivers,
      risks: cond.risks,
      coverage: cond.coverage,
    },
  };

  return { facts, lines };
}
