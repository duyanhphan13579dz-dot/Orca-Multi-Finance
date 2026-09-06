import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCommodityDetail, getCommodityNews, getCommodityCorrelation } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** catalyst markers — news-driven only (never hypothetical) */
const CATALYST_RE = /tăng|giảm|chính sách|thuế|cung|nguồn cung|xuất khẩu|nhập khẩu|giá |thị trường|điều chỉnh|cắt giảm|sản lượng|thời tiết|hạn hán|đình công|stockpile|inventory/i;

/**
 * GET /api/v1/commodities/:symbol — chi tiết một hàng hóa (unified model +
 * intelligence profile: performance, correlation/sensitivity, news/catalysts).
 * Backward-compatible envelope: { success, data, meta }.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!clean) return badRequest("symbol không hợp lệ");
  const r = await getCommodityDetail(clean);
  if (!r) return badRequest(`Không biết hàng hóa "${clean}"`);
  const { def, row, unavailableReason } = r;
  if (!row) {
    return unavailable(
      "commodity-providers",
      unavailableReason ?? `Chưa có nguồn dữ liệu đáng tin cậy cho ${def.name} — hệ thống không mock giá.`,
    );
  }
  // intelligence — best-effort, never crash the detail page
  const [corrRes, newsRes] = await Promise.allSettled([getCommodityCorrelation(clean), getCommodityNews(clean)]);
  const correlation = corrRes.status === "fulfilled" ? (corrRes.value?.correlation ?? null) : null;
  const latestNews = newsRes.status === "fulfilled" ? (newsRes.value?.articles ?? []) : [];
  const catalysts = latestNews
    .filter((a) => CATALYST_RE.test(`${a.title} ${a.summary ?? ""}`))
    .slice(0, 5);
  const data = {
    id: def.key,
    symbol: def.symbol,
    name: def.name,
    nameVi: def.nameVi,
    category: def.category,
    subcategory: def.subcategory ?? null,
    subgroup: def.subgroup ?? def.subcategory ?? null,
    market: def.market,
    unit: row.unit,
    currency: row.currency,
    /** chart khả dụng khi có nguồn OHLC lịch sử thật (Yahoo futures — GC=F/CL=F/…); quote hiện tại từ WiFeed */
    hasChart: Boolean(def.yahooSymbol),
    chartNote: def.yahooSymbol
      ? `Biểu đồ OHLC lịch sử dùng ${def.yahooSymbol} (Yahoo futures); giá hiện tại từ VietnamBiz Data (WiFeed)`
      : null,
    quote: {
      price: row.price,
      change: row.change,
      changePercent: row.changePercent,
      open: row.open,
      high: row.high,
      low: row.low,
      previousClose: row.previousClose,
      priceType: row.priceType,
    },
    performance: row.performance,
    relatedStocks: row.relatedStocks ?? [],
    sourceRecords: row.sourceRecords,
    source: row.sourceRecords[0]?.source ?? null,
    freshness: row.freshness,
    marketState: row.marketState,
    freshnessNote: row.freshnessNote,
    updatedAt: row.updatedAt,
    sourceTimestamp: row.sourceTimestamp,
    sourceUrl: row.sourceUrl,
    /** intelligence profile — historical statistics, never causal evidence */
    correlation,
    latestNews,
    catalysts,
    newsNote: newsRes.status === "fulfilled" ? (newsRes.value?.note ?? null) : "Nguồn tin chưa khả dụng",
  };
  return ok(data);
}
