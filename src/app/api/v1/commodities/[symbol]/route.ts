import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCommodityDetail } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/commodities/:symbol — chi tiết một hàng hóa (unified model).
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
  const data = {
    id: def.key,
    symbol: def.symbol,
    name: def.name,
    nameVi: def.nameVi,
    category: def.category,
    subcategory: def.subcategory ?? null,
    unit: row.unit,
    currency: row.currency,
    /** chart khả dụng khi có nguồn OHLC thật (Yahoo futures / PAXG) */
    hasChart: Boolean(def.yahooSymbol || def.binanceSymbol),
    chartNote: def.yahooSymbol
      ? `Biểu đồ dùng ${def.yahooSymbol} — cùng symbol futures mà trang Simplize hiển thị`
      : def.binanceSymbol
        ? "Vàng thế giới qua PAXG (1:1 gold-ounce, USD) — nguồn thực 24/7"
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
  };
  return ok(data);
}
