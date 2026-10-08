import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getWorldBankMacro } from "@/lib/services/macro-worldbank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/macro/worldbank?country=VN
 * Structured World Bank macro series (no API key).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") ?? "VN").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return badRequest("country phải là mã ISO2 (vd: VN, US)");
  }

  const result = await getWorldBankMacro(country);
  if (!result) {
    return unavailable(
      "worldbank",
      `Chưa lấy được chuỗi macro World Bank cho ${country}. Thử lại sau.`,
    );
  }
  return ok(result.data, result.meta, {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  });
}
