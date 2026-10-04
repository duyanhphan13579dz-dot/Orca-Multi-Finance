import { ok, unavailable } from "@/lib/envelope";
import { getStockCompanyPackage } from "@/lib/services/stock-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await ctx.params;
  const sym = (symbol ?? "").toUpperCase();

  async function load() {
    return getStockCompanyPackage(sym);
  }

  try {
    let r = await load();
    if (!r?.data?.profile) {
      await new Promise((res) => setTimeout(res, 350));
      r = await load();
    }
    if (!r) {
      return unavailable("company", `Không lấy được hồ sơ doanh nghiệp ${sym}.`);
    }
    // Prefer 200 partial over 503 so UI can render + refresh
    return ok(r.data, r.meta);
  } catch (e) {
    console.error("[stocks/profile]", sym, e);
    return unavailable("company", e instanceof Error ? e.message : `Lỗi hồ sơ ${sym}`);
  }
}
