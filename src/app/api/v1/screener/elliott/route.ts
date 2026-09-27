import { ok } from "@/lib/envelope";
import { screenElliott, type ElliottPattern } from "@/lib/services/elliott-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PATTERNS = new Set<ElliottPattern>([
  "impulse-up",
  "impulse-down",
  "corrective-abc-up",
  "corrective-abc-down",
  "diagonal",
  "unclear",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("pattern") ?? "all").toLowerCase();
  const pattern =
    raw === "all" ? "all" : PATTERNS.has(raw as ElliottPattern) ? (raw as ElliottPattern) : "all";
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const minConfidence = Number(url.searchParams.get("minConfidence") ?? 25);
  const r = await screenElliott({
    symbols: symbols.length ? symbols : undefined,
    pattern,
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : 25,
    sector: url.searchParams.get("sector") || undefined,
    limit: Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 60),
  });
  const payload = r ?? {
    rows: [],
    scanned: 0,
    skipped: 0,
    meta: {
      source: "elliott-screener",
      sourceTimestampMs: Date.now(),
      hasData: false,
      partial: true,
      note: "OHLCV tạm lỗi — thử lại sau",
    },
  };
  return ok(
    { universe: "elliott", rows: payload.rows, scanned: payload.scanned, skipped: payload.skipped },
    payload.meta,
  );
}
