import { ok, unavailable } from "@/lib/envelope";
import { generateStockReport } from "@/lib/services/intelligence";
import { vndirectConfigured } from "@/lib/services/stocks";

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
  if (!vndirectConfigured()) {
    return unavailable("vndirect", "Stock Report cần dữ liệu VNDirect — pipeline đã sẵn sàng, provider offline lần này.");
  }
  const r = await generateStockReport(symbol);
  if (!r) return unavailable("vndirect", `Không tạo được report cho ${symbol.toUpperCase()}.`);
  return ok(r.report, r.meta);
}
