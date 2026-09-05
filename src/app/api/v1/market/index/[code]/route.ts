import { ok, notFound, fail } from "@/lib/envelope";
import { buildIndexDetail } from "@/lib/services/market-intel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** INDEX DETAIL — VN-INDEX / VN30 / HNX-INDEX / UPCOM analysis payload. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  try {
    const r = await buildIndexDetail(code);
    if (!r) return notFound(`Không nhận diện được chỉ số "${code}"`);
    return ok(r.detail, r.meta);
  } catch (e) {
    return fail("INDEX_DETAIL_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
