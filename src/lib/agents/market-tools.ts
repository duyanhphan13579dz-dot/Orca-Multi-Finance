import "server-only";
import { getVnQuotes, getVnEquityDetail, getVnOhlcv, getVnIndices } from "../services/stocks";
import { buildStockAnalysis } from "../services/intelligence";
import { getNews } from "../services/news";
import { getVndCompanyProfile } from "../providers/vndirect";
import { getMarketRegime, getSectorRotation, getMarketBreadth } from "../services/market-intelligence";
import { buildMarketSnapshot } from "../services/market";
import { getCommodityMarket } from "../services/commodities";
import { getForexMarkets } from "../services/forex";
import type { FreshnessStatus } from "../types";
import { errResult, okResult, type ToolHandler, type ToolResult } from "./tool-types";

/**
 * STOCK / MARKET / COMMODITY / MACRO TOOLS — wrap data engine hiện có.
 * Mọi kết quả là structured data (contract); nguồn/freshness đi kèm meta.
 * Nguồn thiếu → DATA_UNAVAILABLE (không bao giờ sinh số giả).
 */

const symOf = (args: Record<string, unknown>): string | null => {
  const s = String(args.symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{3,6}$/.test(s) ? s : null;
};

const metaOf = (meta: { source: string; freshness: FreshnessStatus; providers?: string[] }): ToolResult["meta"] => ({
  source: meta.source,
  freshness: meta.freshness,
  provider: meta.providers,
  fetchedAt: new Date().toISOString(),
});

/* --------------------------------- stocks --------------------------------- */

export const stockTools: ToolHandler[] = [
  {
    spec: {
      name: "get_stock_quote",
      domain: "stock",
      category: "data",
      description: "Báo giá cổ phiếu VN (giá, % thay đổi, cao/thấp, khối lượng, giá trị giao dịch).",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu (VD: HPG)" }],
      outputType: "{ symbol, name, price, changePercent, high, low, volume, currency }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ (3–6 ký tự A-Z0-9)");
      const r = await getVnQuotes([symbol]);
      if (!r || !r.quotes.length) return errResult("DATA_UNAVAILABLE", `Không lấy được báo giá ${symbol} từ VNDirect`);
      const q = r.quotes[0];
      return okResult(
        {
          symbol: q.symbol,
          name: q.name ?? null,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          high: q.high ?? null,
          low: q.low ?? null,
          open: q.open ?? null,
          volume: q.volume ?? null,
          quoteVolume: q.quoteVolume ?? null,
          currency: q.currency ?? "VND",
        },
        { ...metaOf(r.meta), trace: ["vndirect-quotes"] },
      );
    },
  },
  {
    spec: {
      name: "get_stock_profile",
      domain: "stock",
      category: "data",
      description: "Hồ sơ doanh nghiệp VN (tên, sàn, ngành, năm niêm yết, vốn điều lệ, tỷ lệ nước ngoài).",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" }],
      outputType: "{ symbol, name, exchange, industry, listingDate, establishedYear, charterCapital, foreignPercent, status }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const profile = await getVndCompanyProfile(symbol);
      if (!profile) return errResult("DATA_UNAVAILABLE", `Không lấy được hồ sơ doanh nghiệp ${symbol} (VNDirect)`);
      return okResult(profile, { source: "vndirect", trace: ["vndirect-profile"] });
    },
  },
  {
    spec: {
      name: "get_stock_financials",
      domain: "stock",
      category: "data",
      description: "Báo cáo tài chính + chỉ số (revenue, netProfit, ROE, D/E, FCF, P/E, P/B) từ VNDirect.",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" }],
      outputType: "{ financialHealth, valuation, ratios, statements }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const analysis = await buildStockAnalysis(symbol);
      if (!analysis) return errResult("DATA_UNAVAILABLE", `Không lấy được dữ liệu tài chính ${symbol} (VNDirect offline)`);
      const c = analysis.contract;
      const fh = c.fundamental_state?.financial_health;
      const v = c.fundamental_state?.valuation;
      return okResult(
        {
          symbol,
          financialHealth: fh ?? null,
          valuation: v ?? null,
          notes: analysis.detail.notes,
        },
        { ...metaOf(analysis.meta), trace: ["vndirect-financials", "financial-health-engine", "valuation-engine"] },
      );
    },
  },
  {
    spec: {
      name: "get_stock_valuation",
      domain: "stock",
      category: "analysis",
      description: "Định giá: P/E, P/B, DCF (base/bull/bear) — từ valuation engine, không suy diễn từ 1 chỉ số.",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" }],
      outputType: "{ multiples, dcf, note }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const analysis = await buildStockAnalysis(symbol);
      if (!analysis) return errResult("DATA_UNAVAILABLE", `Không lấy được dữ liệu ${symbol}`);
      const v = analysis.contract.fundamental_state?.valuation as { multiples?: Record<string, number | null>; dcf?: unknown[] } | null;
      if (!v) return errResult("DATA_UNAVAILABLE", `Chưa đủ dữ liệu để định giá ${symbol}`);
      return okResult(
        { symbol, multiples: v.multiples ?? null, dcf: v.dcf ?? null, note: "Định giá dựa trên dữ liệu báo cáo + giá hiện tại; không phải khuyến nghị" },
        { ...metaOf(analysis.meta), trace: ["valuation-engine"] },
      );
    },
  },
  {
    spec: {
      name: "get_stock_technicals",
      domain: "stock",
      category: "analysis",
      description: "Phân tích kỹ thuật: RSI, MACD, trend, SMA, Bollinger, hỗ trợ/kháng cự, signals, ATR, volatility.",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" }],
      outputType: "{ rsi14, macd, trend, sma, bollinger, support, resistance, signals, atr14, volatility30d }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const analysis = await buildStockAnalysis(symbol);
      if (!analysis) return errResult("DATA_UNAVAILABLE", `Không lấy được dữ liệu ${symbol}`);
      const t = analysis.contract.technical_state as Record<string, unknown> | null;
      if (!t) return errResult("DATA_UNAVAILABLE", `Không đủ dữ liệu OHLCV để phân tích kỹ thuật ${symbol}`);
      return okResult({ symbol, ...t }, { ...metaOf(analysis.meta), trace: ["technical-engine"] });
    },
  },
  {
    spec: {
      name: "get_stock_history",
      domain: "stock",
      category: "data",
      description: "Lịch sử giá OHLCV (mặc định 250 bar ngày, realtime từ VNDirect).",
      params: [
        { name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" },
        { name: "limit", type: "number", required: false, min: 10, max: 500, description: "Số bar (mặc định 250)" },
      ],
      outputType: "{ symbol, bars: [{ time, open, high, low, close, volume }], meta }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const limit = Number(args.limit ?? 250);
      const r = await getVnOhlcv(symbol, limit);
      if (!r || !r.bars.length) return errResult("DATA_UNAVAILABLE", `Không lấy được lịch sử giá ${symbol}`);
      return okResult({ symbol, bars: r.bars }, metaOf(r.meta));
    },
  },
  {
    spec: {
      name: "get_stock_news",
      domain: "stock",
      category: "data",
      description: "Tin tức liên quan cổ phiếu (RSS multi-feed: CafeF, VnExpress, VietnamBiz, CoinTelegraph).",
      params: [
        { name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" },
        { name: "limit", type: "number", required: false, min: 1, max: 20, description: "Số bài (mặc định 5)" },
      ],
      outputType: "{ articles: [{ title, source, publishedAt, url, category }], errors, meta }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const limit = Number(args.limit ?? 5);
      const r = await getNews({ symbol, limit });
      if (!r || !r.articles.length) return errResult("DATA_UNAVAILABLE", `Không có tin mới cho ${symbol}`);
      return okResult(
        { articles: r.articles.map((a) => ({ title: a.title, source: a.source, publishedAt: a.publishedAt, url: a.url, category: a.category })), errors: r.errors },
        metaOf(r.meta),
      );
    },
  },
  {
    spec: {
      name: "get_stock_reports",
      domain: "stock",
      category: "data",
      description: "Báo cáo phân tích nội bộ (daily/intraweek) cho cổ phiếu, nếu có.",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" }],
      outputType: "{ reports: [{ id, type, title, generatedAt }] }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const { listReports } = await import("../services/report-engine");
      const reports = await listReports(null, 20);
      const filtered = reports.filter((r) => r.title?.toUpperCase().includes(symbol));
      if (!filtered.length) return errResult("DATA_UNAVAILABLE", `Không có báo cáo nội bộ nào cho ${symbol}`);
      return okResult({ reports: filtered.map((r) => ({ id: r.id, type: r.type, title: r.title, generatedAt: r.generatedAt })) });
    },
  },
  {
    spec: {
      name: "get_stock_recommendations",
      domain: "stock",
      category: "data",
      description: "Khuyến nghị analyst từ VNDirect — nguồn KHÔNG công bố qua API public, trả DATA_UNAVAILABLE thay vì bịa.",
      params: [{ name: "symbol", type: "string", required: true, description: "Mã cổ phiếu" }],
      outputType: "{ status: 'UNAVAILABLE', reason }",
    },
    async execute(args) {
      const symbol = symOf(args);
      if (!symbol) return errResult("INVALID_INPUT", "symbol không hợp lệ");
      const { getVndRecommendation } = await import("../providers/vndirect");
      const rec = await getVndRecommendation(symbol);
      return errResult("DATA_UNAVAILABLE", `Khuyến nghị ${symbol}: ${rec.reason}`, { source: "vndirect" });
    },
  },
  {
    spec: {
      name: "get_vn_indices",
      domain: "market",
      category: "data",
      description: "Chỉ số VN: VN-Index, VN30, HNX, UPCOM (giá, % thay đổi).",
      params: [],
      outputType: "{ items: [{ symbol, name, price, changePercent }] }",
    },
    async execute() {
      const r = await getVnIndices();
      if (!r || !r.items.length) return errResult("DATA_UNAVAILABLE", "Chưa lấy được chỉ số VN (VNDirect offline)");
      return okResult(
        { items: r.items.map((i) => ({ symbol: i.code, name: i.name, price: i.value, change: i.change, changePercent: i.changePercent })) },
        metaOf(r.meta),
      );
    },
  },
];

/* ---------------------------------- market --------------------------------- */

export const marketTools: ToolHandler[] = [
  {
    spec: {
      name: "market_context",
      domain: "market",
      category: "analysis",
      description: "Bối cảnh thị trường: regime (risk appetite, trend, volatility), chỉ số, crypto, commodities, tin top.",
      params: [],
      outputType: "{ pulse, regime, indices, cryptoSummary, commodities, newsTop }",
    },
    async execute() {
      const [regime, snap] = await Promise.allSettled([getMarketRegime(), buildMarketSnapshot()]);
      if (regime.status !== "fulfilled" && snap.status !== "fulfilled") {
        return errResult("DATA_UNAVAILABLE", "Thị trường tạm không khả dụng (VNDirect offline)");
      }
      const regimeData = regime.status === "fulfilled" ? regime.value?.regime ?? null : null;
      const snapData = snap.status === "fulfilled" ? snap.value.snapshot : null;
      const metaSnap = snap.status === "fulfilled" ? snap.value.meta : null;
      return okResult(
        {
          regime: regimeData ?? null,
          pulse: snapData?.pulse ?? null,
          indices: snapData?.indices?.slice(0, 4) ?? null,
          cryptoSummary: snapData?.crypto?.summary ?? null,
          commodities: snapData?.commodities ?? null,
          newsTop: snapData?.news?.slice(0, 5).map((n) => ({ title: n.title, source: n.source, publishedAt: n.publishedAt })) ?? null,
        },
        {
          source: regime.status === "fulfilled" && regime.value ? regime.value.meta.source : metaSnap?.source,
          freshness: ((regime.status === "fulfilled" && regime.value) ? regime.value.meta.freshness : metaSnap?.freshness) as never,
          trace: ["market-snapshot", regimeData ? "market-regime-engine" : "market-regime-unavailable"],
        },
      );
    },
  },
  {
    spec: {
      name: "sector_context",
      domain: "market",
      category: "analysis",
      description: "Xoay vòng ngành: ngành mạnh/yếu nhất, top ngành, độ phân tán, tỷ lệ tham gia.",
      params: [],
      outputType: "{ topSector, laggardSector, dispersionPct, rows }",
    },
    async execute() {
      const r = await getSectorRotation();
      if (!r) return errResult("DATA_UNAVAILABLE", "Chưa có dữ liệu xoay vòng ngành (VNDirect offline)");
      const rot = r.rotation;
      return okResult(
        {
          topSector: rot.topSector,
          laggardSector: rot.laggardSector,
          dispersionPct: rot.dispersionPct,
          marketMedianChangePct: rot.marketMedianChangePct,
          rows: rot.rows.slice(0, 10),
          note: rot.note,
        },
        metaOf(r.meta),
      );
    },
  },
  {
    spec: {
      name: "market_breadth",
      domain: "market",
      category: "analysis",
      description: "Độ rộng thị trường: số mã tăng/giảm, % trên SMA20/50, mã mới đỉnh/đáy.",
      params: [],
      outputType: "{ advancers, decliners, unchanged, score, pctAboveSma20, newHighs20, newLows20 }",
    },
    async execute() {
      const r = await getMarketBreadth();
      if (!r) return errResult("DATA_UNAVAILABLE", "Chưa có dữ liệu độ rộng thị trường");
      const b = r.breadth;
      return okResult(
        { advancers: b.advancers, decliners: b.decliners, unchanged: b.unchanged, total: b.total, score: b.score, pctAboveSma20: b.pctAboveSma20, pctAboveSma50: b.pctAboveSma50, newHighs20: b.newHighs20, newLows20: b.newLows20, note: b.note },
        metaOf(r.meta),
      );
    },
  },
];

/* ------------------------------- commodity/macro ---------------------------- */

export const commodityMacroTools: ToolHandler[] = [
  {
    spec: {
      name: "commodity_quotes",
      domain: "commodity",
      category: "data",
      description: "Giá hàng hóa trong nước (VietnamBiz: dầu, gas, phân bón, vật liệu, nông sản…).",
      params: [],
      outputType: "{ rows: [{ symbol, name, price, changePercent, unit }], note, meta }",
    },
    async execute() {
      const r = await getCommodityMarket();
      if (!r) return errResult("DATA_UNAVAILABLE", "Nguồn hàng hóa tạm không khả dụng");
      return okResult(
        {
          rows: r.data.rows.map((x) => ({ symbol: x.symbol, name: x.name ?? x.commodity, price: x.price, changePercent: x.changePercent, unit: x.unit, group: x.group })),
          unavailable: r.data.unavailable.map((u) => ({ name: u.name, reason: u.reason })),
          errors: r.data.errors,
          source: r.data.sourcesUsed,
        },
        { ...metaOf(r.meta), note: r.meta.note ?? (r.data.errors.length ? `${r.data.errors.length} mục không lấy được` : undefined) },
      );
    },
  },
  {
    spec: {
      name: "macro_fx_snapshot",
      domain: "macro",
      category: "data",
      description: "Tỷ giá FX + USD/VND: bảng giá đa nguồn (Swissquote/Yahoo/ECB) + mô hình Vietnam FX (VCB/VietnamBiz).",
      params: [],
      outputType: "{ rows, vnFx, usdNote }",
    },
    async execute() {
      const r = await getForexMarkets();
      if (!r || !r.data.rows.length) return errResult("DATA_UNAVAILABLE", "Chưa lấy được dữ liệu FX");
      return okResult(
        { rows: r.data.rows, vnFx: r.data.vnFx ?? null, usdNote: r.data.usdStrengthNote ?? null },
        metaOf(r.meta),
      );
    },
  },
  {
    spec: {
      name: "get_metal_quote",
      domain: "commodity",
      category: "data",
      description: "Giá kim loại quý (XAUUSD/XAGUSD/XPTUSD/XPDUSD) — Swissquote BBO → Yahoo fallback.",
      params: [{ name: "symbol", type: "string", required: true, description: "XAUUSD | XAGUSD | XPTUSD | XPDUSD" }],
      outputType: "{ symbol, name, price, bid, ask, changePercent, unit, provider }",
    },
    async execute(args) {
      const symbol = String(args.symbol ?? "").toUpperCase();
      const { getMetalDetail } = await import("../services/metals");
      const r = await getMetalDetail(symbol);
      if (!r || !r.detail.current) return errResult("DATA_UNAVAILABLE", `Không lấy được giá ${symbol}`);
      return okResult(
        {
          symbol: r.detail.symbol,
          name: r.detail.name,
          price: r.detail.current.price,
          bid: r.detail.current.bid ?? null,
          ask: r.detail.current.ask ?? null,
          changePercent: r.detail.current.changePercent,
          previousClose: r.detail.current.previousClose ?? null,
          unit: r.detail.unit,
          provider: r.detail.current.provider ?? r.meta.source,
        },
        metaOf(r.meta),
      );
    },
  },
];

export const allMarketTools: ToolHandler[] = [...stockTools, ...marketTools, ...commodityMacroTools];
