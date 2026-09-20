import { ok, fail } from "@/lib/envelope";
import { getSentiment } from "@/lib/services/sentiment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/sentiment?asset=crypto|forex&symbol=BTCUSDT|EURUSD
 * Hybrid: quant score always present; LLM narrative when OPENROUTER_API_KEY (or GROQ_API_KEY) is set.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const asset = (url.searchParams.get("asset") ?? "crypto").toLowerCase();
    const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return fail("symbol required", 400);
    if (asset !== "crypto" && asset !== "forex") return fail("asset must be crypto|forex", 400);
    const { result, meta } = await getSentiment(asset as "crypto" | "forex", symbol);
    return ok(result, meta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sentiment failed";
    return fail(msg, 500);
  }
}
