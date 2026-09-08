import { ok, unavailable } from "@/lib/envelope";
import { getFinancialsForSymbol } from "@/lib/financial/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const r = await getFinancialsForSymbol(symbol);
  if (!r || (!r.financials.income && !r.financials.balance && !r.financials.cashflow)) {
    return unavailable(
      "financial-engine",
      `Không lấy được báo cáo tài chính ${symbol.toUpperCase()} từ mọi nguồn (VNStock/VNDirect).`,
    );
  }
  return ok(
    {
      symbol: symbol.toUpperCase(),
      financials: r.financials,
      health: r.health,
      packageMeta: r.packageMeta,
      notes: r.notes,
    },
    r.meta,
  );
}
