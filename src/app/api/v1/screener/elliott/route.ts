import { ok, unavailable } from "@/lib/envelope";
import { screenElliott, type ElliottPattern } from "@/lib/services/elliott-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PATTERNS = new Set<ElliottPattern>(["impulse-up", "impulse-down", "corrective-abc-up", "corrective-abc-down", "diagonal", "unclear"]);

export async function GET(req: Request) {
  const url = new URL(req.url); const raw = (url.searchParams.get("pattern") ?? "all").toLowerCase();
  const pattern = raw === "all" ? "all" : PATTERNS.has(raw as ElliottPattern) ? raw as ElliottPattern : "all";
  const symbols = (url.searchParams.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const minConfidence = Number(url.searchParams.get("minConfidence") ?? 25);
  const r = await screenElliott({ symbols: symbols.length ? symbols : undefined, pattern, minConfidence: Number.isFinite(minConfidence) ? minConfidence : 25, sector: url.searchParams.get("sector") || undefined, limit: Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 60) });
  if (!r) return unavailable("elliott-screener", "Chưa đủ nến OHLCV để quét Elliott Wave.");
  return ok({ universe: "elliott", rows: r.rows, scanned: r.scanned, skipped: r.skipped }, r.meta);
}
