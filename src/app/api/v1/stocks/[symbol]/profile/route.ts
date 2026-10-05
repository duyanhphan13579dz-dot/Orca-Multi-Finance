import { ok, unavailable } from "@/lib/envelope";
import { getStockCompanyPackage } from "@/lib/services/stock-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return unavailable("company", "Thiếu mã cổ phiếu");

  try {
    let r = await getStockCompanyPackage(sym);
    if (!r?.data?.profile) {
      r = await getStockCompanyPackage(sym);
    }
    if (!r?.data) {
      return unavailable("company", `Không lấy được hồ sơ doanh nghiệp ${sym}.`);
    }
    // Always 200 when package exists (master fallback for listed codes)
    return ok(r.data, r.meta);
  } catch (e) {
    console.error("[stocks/profile]", sym, e);
    try {
      const r = await getStockCompanyPackage(sym);
      if (r?.data) return ok(r.data, r.meta);
    } catch {
      /* */
    }
    return unavailable("company", e instanceof Error ? e.message : `Lỗi hồ sơ ${sym}`);
  }
}
