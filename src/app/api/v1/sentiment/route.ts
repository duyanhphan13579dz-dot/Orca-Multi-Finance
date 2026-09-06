import { ok, unavailable, badRequest } from "@/lib/envelope";
import { getCryptoSentiment, getForexSentiment } from "@/lib/services/sentiment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/sentiment?assetType=crypto&symbol=BTCUSDT
 * GET /api/v1/sentiment?assetType=forex&symbol=EURUSD
 *
 * Hybrid: quant score always present; LLM narrative when AI_PROVIDER_KEY is set.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const assetType = (url.searchParams.get("assetType") ?? "").toLowerCase();
  const symbol = (url.searchParams.get("symbol") ?? "").trim();
  if (!symbol) return badRequest("Thiếu symbol");
  if (assetType !== "crypto" && assetType !== "forex") return badRequest("assetType phải là crypto|forex");

  const r =
    assetType === "crypto" ? await getCryptoSentiment(symbol) : await getForexSentiment(symbol);
  if (!r) return unavailable("sentiment", `Không tính được sentiment cho ${symbol}`);
  return ok(r.data, r.meta);
}
