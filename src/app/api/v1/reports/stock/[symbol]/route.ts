import { ok, unavailable } from "@/lib/envelope";
import { generateStockReport } from "@/lib/services/intelligence";
import { vnstockConfigured } from "@/lib/services/stocks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * STOCK REPORT GENERATION ENGINE —
 * fetch → validate → quant engines → risk → contract → (LLM reasoning +
 * output validation) → analyst-style report with FACT/CALCULATION/
 * INTERPRETATION/SCENARIO separation.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  if (!vnstockConfigured()) {
    return unavailable("vnstock", "Stock Report cần VNSTOCK_API_KEY — pipeline đã sẵn sàng, chờ nguồn dữ liệu thật.");
  }
  const r = await generateStockReport(symbol);
  if (!r) return unavailable("vnstock", `Không tạo được report cho ${symbol.toUpperCase()}.`);
  return ok(r.report, r.meta);
}
