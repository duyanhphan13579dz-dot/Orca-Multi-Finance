import { ok, fail, unavailable, badRequest } from "@/lib/envelope";
import { getForexDetail } from "@/lib/services/forex";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để sử dụng Forex", 401);
  const { symbol } = await ctx.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length !== 6) return badRequest("Cặp tỷ giá phải dạng 6 ký tự, ví dụ EURUSD");
  const r = await getForexDetail(clean);
  if (!r) return unavailable("forex-providers", `Không lấy được dữ liệu ${clean} (Biquote/ECB).`);
  return ok(r.detail, r.meta);
}