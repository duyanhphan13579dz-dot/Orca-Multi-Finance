import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketSnapshot } from "./market";
import { getCrossAsset, crossAssetChanges, type CrossAssetItem } from "./cross-asset";
import { getVnQuotes, getVnMarketBoard, vnstockConfigured } from "./stocks";
import { getNews } from "./news";
import * as vndirect from "../providers/vndirect";
import { getCafefPropFlow } from "../providers/cafef";
import { computeMarketCondition, computeContributions, type MarketConditionResult, type ContributionRow } from "../engines/market-condition";
import { getVnSession, type VnSessionInfo } from "../vn/sessions";
import { ensureHeartbeatStarted } from "../realtime/heartbeat";
import { VN_INDICES, getSecurity } from "../vn/master";
import type { FreshnessStatus, IndexQuote, Meta, NewsArticle } from "../types";
import { enrichBreadth } from "./breadth-utils";

export interface BreadthData {
  advancers: number;
  decliners: number;
  unchanged: number;
  source: string;
  available: boolean;
  note?: string;
  total?: number;
  adRatio?: number | null;
  advancePct?: number | null;
  netAdvances?: number | null;
  regime?: string | null;
  regimeVi?: string | null;
}

export { enrichBreadth, formatBreadthParagraphs } from "./breadth-utils";

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
  const res = await cached("market:intel:v6", {
    ttlMs: 10_000,
    staleMs: 30 * 60_000,
    producer: async () => {
      try {
        return await produceMarketIntel();
      } catch (e) {
        const session = getVnSession();
        const intel: MarketIntel = {
          session,
          sessionHint: session.labelVi,
          indices: null,
          indicesAvailable: false,
          breadth: { advancers: 0, decliners: 0, unchanged: 0, source: "degraded", available: false, note: "Engine tạm thời không lấy được breadth." },
          liquidity: { valueTraded: null, baseline: null, available: false, note: "Chưa có thanh khoản phiên." },
          flow: { foreignNet: null, propNet: null, etfNet: null, source: "degraded", available: false, note: e instanceof Error ? e.message : "degraded" },
          crossAsset: [],
          condition: computeMarketCondition({ index: null, breadth: null, liquidity: null, flow: null, crossAsset: null, cryptoBreadth: null }),
          contributors: { positive: [], negative: [], hasWeights: false, note: "Chưa có dữ liệu đóng góp." },
          news: [],
          sections: { indices: "UNAVAILABLE", breadth: "UNAVAILABLE", liquidity: "UNAVAILABLE", flow: "UNAVAILABLE", crossAsset: "UNAVAILABLE", news: "UNAVAILABLE" },
          vnDataNote: "Payload suy giảm — đang kết nối lại VNDirect.",
        };
        return { intel, meta: buildMeta({ source: "degraded", sourceTimestampMs: Date.now(), note: "Market intel degraded", degraded: true, hasData: false, slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 } }) };
      }
    },
  });
  return res.value;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.then((v) => v).catch(() => null as T | null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function produceMarketIntel(): Promise<{ intel: MarketIntel; meta: Meta }> {
  ensureHeartbeatStarted();
  const [indicesPack, quotesPack] = await Promise.all([
    withTimeout((async () => { const { getVnIndices } = await import("./stocks"); return getVnIndices(); })(), 5_500),
    withTimeout(getVnQuotes(VN30_BOARD.slice(0, 20)), 6_000),
  ]);
  const [snapRes, crossRes, foreignRes, etfRes, propRes, idxStats, marketBoardRes, newsPack] = await Promise.all([
    withTimeout(buildMarketSnapshot(), 10_000),
    withTimeout(getCrossAsset(), 5_000),
    withTimeout(vndirect.getVndForeignFlow(), 6_000),
    withTimeout(vndirect.getVndEtfFlow(), 5_000),
    withTimeout((async () => { const date = await vndirect.getVndLatestSessionDate(); return getCafefPropFlow(date); })(), 5_000),
    withTimeout(vndirect.getVndIndexSessionStats("VNINDEX"), 8_000),
    withTimeout(getVnMarketBoard(), 8_000),
    withTimeout(getNews({ limit: 20 }), 12_000),
  ]);
  const indices = indicesPack?.items?.length ? indicesPack.items : snapRes?.snapshot?.indices?.length ? snapRes.snapshot.indices : null;
  const indicesAvailable = Boolean(indices?.length);
  const session = getVnSession();
  const board = quotesPack;
  let breadth: BreadthData;
  if (idxStats && (idxStats.advances > 0 || idxStats.declines > 0)) {
    breadth = { advancers: idxStats.advances, decliners: idxStats.declines, unchanged: idxStats.unchanged, source: "vndirect vnmarket_prices", available: true, note: "Breadth từ VNDirect vnmarket_prices" };
  } else if (marketBoardRes?.quotes?.length) {
    const qs = marketBoardRes.quotes;
    const a = qs.filter((q) => (q.changePercent ?? 0) > 0).length;
    const d = qs.filter((q) => (q.changePercent ?? 0) < 0).length;
    breadth = { advancers: a, decliners: d, unchanged: qs.length - a - d, source: marketBoardRes.meta.source, available: true, note: `Breadth ước lượng từ ${qs.length} mã bảng giá` };
  } else if (board?.quotes?.length) {
    const a = board.quotes.filter((q) => (q.changePercent ?? 0) > 0).length;
    const d = board.quotes.filter((q) => (q.changePercent ?? 0) < 0).length;
    breadth = { advancers: a, decliners: d, unchanged: board.quotes.length - a - d, source: board.meta.source, available: true };
  } else {
    breadth = { advancers: 0, decliners: 0, unchanged: 0, source: "vndirect", available: false, note: "Chưa lấy được thống kê tăng/giảm phiên từ VNDirect." };
  }
  breadth = enrichBreadth(breadth);
  const boardSum = board?.quotes?.reduce((sum, q) => sum + (q.quoteVolume ?? q.volume ?? 0), 0) ?? 0;
  const fullBoardSum = marketBoardRes?.quotes?.reduce((sum, q) => sum + (q.quoteVolume ?? q.volume ?? 0), 0) ?? 0;
  let valueTraded: number | null = idxStats?.value && idxStats.value > 0 ? idxStats.value : fullBoardSum > 0 ? fullBoardSum : boardSum > 0 ? boardSum : null;
  let liqNote = idxStats?.value && idxStats.value > 0 ? "GTGD phiên từ VNDirect vnmarket_prices (VNINDEX)." : fullBoardSum > 0 ? `GTGD ước lượng từ ${marketBoardRes?.quotes?.length ?? 0} mã bảng giá (cộng quoteVolume).` : boardSum > 0 ? `GTGD ước lượng từ rổ VN30 theo dõi (${board?.quotes?.length ?? 0} mã).` : "Chưa có GTGD phiên — session-stats/board chưa trả volume.";
  if ((valueTraded == null || valueTraded <= 0) && foreignRes && (foreignRes.buyVal > 0 || foreignRes.sellVal > 0)) {
    const turnover = (foreignRes.buyVal ?? 0) + (foreignRes.sellVal ?? 0);
    if (turnover > 0) { valueTraded = turnover; liqNote = `Proxy: tổng GT mua+bán khối ngoại phiên ${foreignRes.sessionDate} (không phải GTGD toàn sàn).`; }
  }
  const liquidity = { valueTraded: valueTraded && valueTraded > 0 ? valueTraded : null, baseline: null as number | null, available: Boolean(valueTraded && valueTraded > 0), note: liqNote };
  const foreign = foreignRes;
  const etf = etfRes;
  const prop = propRes;
  const sessionDate = foreign?.sessionDate ?? etf?.sessionDate ?? prop?.sessionDate ?? null;
  const parts: string[] = [];
  if (foreign) parts.push(`Khối ngoại phiên ${foreign.sessionDate}: mua ${foreign.buyVal.toExponential(2)} / bán ${foreign.sellVal.toExponential(2)} (VND)`);
  if (prop) parts.push(`Tự doanh: mua ${prop.buyVal.toExponential(2)} / bán ${prop.sellVal.toExponential(2)} (CafeF EOD)`); else parts.push("Tự doanh: chưa có (CafeF EOD sau phiên)");
  if (etf) parts.push(`ETF NN: mua ${etf.buyVal.toExponential(2)} / bán ${etf.sellVal.toExponential(2)} (${etf.stockCount} mã)`); else parts.push("ETF: chưa có nguồn phiên");
  const flow: FlowData = {
    foreignNet: foreign?.netVal ?? null,
    propNet: prop?.netVal ?? null,
    etfNet: etf?.netVal ?? null,
    source: [foreign && "vndirect foreigns", prop && "cafef prop", etf && "vndirect etf"].filter(Boolean).join(" + ") || (indicesAvailable ? "vndirect-indices" : "partial"),
    available: Boolean(foreign || prop || etf || indicesAvailable),
    note: parts.join(". ") + (sessionDate ? "." : ""),
  };
  const cross = crossRes;
  const snap = snapRes;
  const cryptoSum = snap?.snapshot?.crypto?.summary ?? null;
  const condition = computeMarketCondition({
    index: indices?.[0] ? { changePercent: indices[0].changePercent, value: indices[0].value, code: indices[0].code } : null,
    breadth: breadth.available ? { advancers: breadth.advancers, decliners: breadth.decliners, unchanged: breadth.unchanged } : null,
    liquidity: liquidity.available ? { valueTraded: liquidity.valueTraded, baseline: liquidity.baseline } : null,
    flow: foreign || prop ? { foreignNet: foreign?.netVal ?? null, propNet: prop?.netVal ?? null } : null,
    crossAsset: cross ? crossAssetChanges(cross.items) : null,
    cryptoBreadth: cryptoSum ? { advancers: cryptoSum.advancers, decliners: cryptoSum.decliners, total: cryptoSum.marketCount, avgChange: cryptoSum.avgChangePercent } : null,
  });
  const contribSourceQuotes = (marketBoardRes?.quotes?.length ? marketBoardRes.quotes : board?.quotes) ?? [];
  const contribRows = contribSourceQuotes.filter((q) => q.changePercent != null).sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0)).slice(0, 40).map((q) => ({ symbol: q.symbol, changePercent: q.changePercent ?? null, weightPct: null as number | null }));
  const contributors = { ...computeContributions(indices?.[0]?.value ?? null, contribRows), note: "Đóng góp ước lượng theo % biến động rổ theo dõi (chưa có tỷ trọng chính thức)." };
  const newsFromPack = newsPack?.articles ?? [];
  const newsFromSnap = snap?.snapshot?.news ?? [];
  const news = newsFromPack.length > 0 ? newsFromPack : newsFromSnap.length > 0 ? newsFromSnap : [];
  const sections: Record<string, FreshnessStatus> = {
    indices: indicesAvailable ? (indicesPack?.meta.freshness ?? snap?.meta.freshness ?? "FRESH") : "UNAVAILABLE",
    breadth: breadth.available ? "FRESH" : "UNAVAILABLE",
    liquidity: liquidity.available ? "FRESH" : "UNAVAILABLE",
    flow: flow.available ? "FRESH" : "UNAVAILABLE",
    crossAsset: cross ? cross.meta.freshness : "UNAVAILABLE",
    news: news.length > 0 ? (newsPack?.meta.freshness ?? "FRESH") : "UNAVAILABLE",
  };
  const intel: MarketIntel = { session, sessionHint: session.labelVi, indices, indicesAvailable, breadth, liquidity, flow, crossAsset: cross?.items ?? [], condition, contributors, news: news.slice(0, 12), sections, vnDataNote: flow.note };
  const newest = prop?.sourceTs ?? etf?.sourceTs ?? foreign?.sourceTs ?? Date.now();
  return { intel, meta: buildMeta({ source: flow.source, sourceTimestampMs: newest, note: flow.note, partial: !indicesAvailable || !breadth.available || !liquidity.available || news.length === 0, degraded: !indicesAvailable && !board?.quotes?.length, hasData: Boolean(indicesAvailable || board?.quotes?.length || cross?.items?.length || news.length), slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 } }) };
}

function fmtCompactLocal(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export interface IndexConstituent { symbol: string; name: string | null; sector: string | null; price: number | null; changePercent: number | null; }
export interface IndexDetail {
  code: string; name: string; exchange: string; note: string | null; quote: IndexQuote | null; session: VnSessionInfo;
  pressure: { available: boolean; buying: number; selling: number; net: number | null; basis: string };
  breadth: BreadthData; intel: { trend: string; momentum: string; breadthState: string; liquidity: string };
  capitalFlow: CapitalFlowAnalysis; contributors: { positive: ContributionRow[]; negative: ContributionRow[]; hasWeights: boolean; note: string };
  constituents: IndexConstituent[]; liquidity: { available: boolean; note: string }; sections: Record<string, FreshnessStatus>;
}

export async function buildIndexDetail(code: string): Promise<{ detail: IndexDetail; meta: Meta } | null> {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const def = VN_INDICES.find((i) => i.code === raw || i.aliases?.some((a) => a.toUpperCase().replace(/[^A-Z0-9]/g, "") === raw)) ?? null;
  if (!def) return null;
  const [{ intel, meta }, statsRes, marketRes, foreignRes] = await Promise.all([buildMarketIntel(), vndirect.getVndIndexSessionStats(def.code).catch(() => null), getVnMarketBoard().catch(() => null), vndirect.getVndForeignFlow().catch(() => null)]);
  const quote = intel.indices?.find((i) => i.code === def.code || i.code === vndirect.vndIndexCode(def.code)) ?? null;
  const boardQuotes = (marketRes?.quotes ?? []).filter((c) => c.price != null).sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0));
  const contribSource = boardQuotes.filter((c) => c.changePercent != null).map((c) => ({ symbol: c.symbol, changePercent: c.changePercent, weightPct: null as number | null }));
  const computed = computeContributions(quote?.value ?? null, contribSource);
  const contributors = { ...computed, note: computed.hasWeights ? "Đóng góp điểm theo tỷ trọng chính thức" : "Chưa có bộ tỷ trọng rổ — hiển thị mã biến động mạnh nhất theo %." };
  const capitalFlow: CapitalFlowAnalysis = foreignRes
    ? { available: true, sessionDate: foreignRes.sessionDate, foreignBuy: foreignRes.buyVal, foreignSell: foreignRes.sellVal, foreignNet: foreignRes.netVal, stockCount: foreignRes.stockCount, topNetBuy: foreignRes.topNetBuy.map((r) => ({ symbol: r.symbol, buyVal: r.buyVal, sellVal: r.sellVal, netVal: r.netVal })), topNetSell: foreignRes.topNetSell.map((r) => ({ symbol: r.symbol, buyVal: r.buyVal, sellVal: r.sellVal, netVal: r.netVal })), source: "vndirect foreigns", note: `Dòng tiền khối ngoại phiên ${foreignRes.sessionDate} (cổ phiếu listed). Tự doanh/ETF xem panel dòng vốn thị trường.` }
    : { available: false, sessionDate: null, foreignBuy: null, foreignSell: null, foreignNet: null, stockCount: 0, topNetBuy: [], topNetSell: [], source: "vndirect foreigns", note: "Chưa lấy được thống kê khối ngoại phiên — hiển thị UNAVAILABLE, không ước lượng." };
  const liquidityAvailable = statsRes?.value != null || intel.liquidity.available;
  const liquidityNote = statsRes?.value != null ? `GTGD phiên ${fmtCompactLocal(statsRes.value)}` : intel.liquidity.available ? "Có dữ liệu giá trị giao dịch" : "UNAVAILABLE";
  let pressure: IndexDetail["pressure"];
  if (capitalFlow.available && capitalFlow.foreignBuy != null && capitalFlow.foreignSell != null) {
    const total = capitalFlow.foreignBuy + capitalFlow.foreignSell;
    const buying = total > 0 ? Math.round((capitalFlow.foreignBuy / total) * 100) : 50;
    pressure = { available: true, buying, selling: 100 - buying, net: capitalFlow.foreignNet, basis: `Tỷ trọng mua/bán theo GT khối ngoại phiên ${capitalFlow.sessionDate ?? "—"} (toàn thị trường listed).` };
  } else {
    pressure = { available: false, buying: 0, selling: 0, net: null, basis: "Chưa có dữ liệu áp lực mua/bán từ khối ngoại cho phiên này." };
  }
  const breadth: BreadthData = enrichBreadth(statsRes && (statsRes.advances > 0 || statsRes.declines > 0) ? { advancers: statsRes.advances, decliners: statsRes.declines, unchanged: statsRes.unchanged, source: "vndirect vnmarket_prices", available: true, note: `Độ rộng sàn gắn với ${def.code}` } : intel.breadth);
  const trendComp = intel.condition.components.find((c) => c.key === "trend");
  const liqComp = intel.condition.components.find((c) => c.key === "liquidity");
  const breadthComp = intel.condition.components.find((c) => c.key === "breadth");
  const intelBlock = {
    trend: trendComp?.available && trendComp.score != null ? `${Math.round(trendComp.score)}/100` : "UNAVAILABLE",
    momentum: intel.condition.score != null ? `${Math.round(intel.condition.score)} (${intel.condition.rating})` : "UNAVAILABLE",
    breadthState: breadthComp?.available && breadthComp.score != null ? `${Math.round(breadthComp.score)}/100` : breadth.available ? `${breadth.advancers}↑ ${breadth.decliners}↓ · ${breadth.regimeVi ?? ""}` : "UNAVAILABLE",
    liquidity: liqComp?.available && liqComp.score != null ? `${Math.round(liqComp.score)}/100` : liquidityAvailable ? liquidityNote : "UNAVAILABLE",
  };
  const constituents: IndexConstituent[] = boardQuotes.slice(0, 40).map((q) => { const sec = getSecurity(q.symbol); return { symbol: q.symbol, name: sec?.name ?? null, sector: sec?.sector ?? null, price: q.price ?? null, changePercent: q.changePercent ?? null }; });
  const detail: IndexDetail = { code: def.code, name: def.name, exchange: def.exchange, note: quote ? null : `Chưa lấy được quote chỉ số ${def.code} từ nguồn VN — giữ trạng thái UNAVAILABLE.`, quote, session: intel.session, pressure, breadth, intel: intelBlock, capitalFlow, contributors, constituents, liquidity: { available: liquidityAvailable, note: liquidityNote }, sections: { quote: quote ? meta.freshness : "UNAVAILABLE", flow: capitalFlow.available ? "FRESH" : "UNAVAILABLE", liquidity: liquidityAvailable ? "FRESH" : "UNAVAILABLE", contributors: contributors.positive.length || contributors.negative.length ? "FRESH" : "UNAVAILABLE", breadth: breadth.available ? "FRESH" : "UNAVAILABLE" } };
  return { detail, meta: buildMeta({ source: capitalFlow.source, sourceTimestampMs: Date.now(), note: capitalFlow.note, partial: !quote || !breadth.available, hasData: Boolean(quote || capitalFlow.available || breadth.available), slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 } }) };
}
