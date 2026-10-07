import { ok, unavailable } from "@/lib/envelope";
import { getOrGenerateCompanyIntelligence } from "@/lib/services/company-intelligence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const data = await getOrGenerateCompanyIntelligence(symbol);
  if (!data) return unavailable("company-intelligence", `Chưa có dữ liệu phân tích doanh nghiệp ${symbol.toUpperCase()}.`);
  return ok(data, { source: data.sources.join(" + "), sourceTimestampMs: Date.parse(data.analyzedAt), note: "Suy luận từ BCTC, tin tức và lịch sử giá" });
}
