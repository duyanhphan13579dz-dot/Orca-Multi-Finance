import { ok, unavailable } from "@/lib/envelope";
import { screenWyckoff } from "@/lib/services/wyckoff-screener";
import type { WyckoffPhase } from "@/lib/engines/wyckoff-elliott";
import type { WyckoffSetup } from "@/lib/services/wyckoff-screener";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHASES = new Set<WyckoffPhase>([
  "accumulation",
  "markup",
  "distribution",
  "markdown",
  "re-accumulation",
  "re-distribution",
  "unknown",
]);

const SETUPS = new Set<WyckoffSetup>([
  "spring",
  "upthrust",
  "sos-breakout",
  "sow-breakdown",
  "accumulation-range",
  "distribution-range",
  "markup",
  "markdown",
  "watch",
]);

/**
 * GET /api/v1/screener/wyckoff
 * Quét rổ thanh khoản VN theo heuristic Wyckoff trên nến ngày.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const phaseRaw = (url.searchParams.get("phase") ?? "all").toLowerCase();
  const setupRaw = (url.searchParams.get("setup") ?? "all").toLowerCase();
  const phase = phaseRaw === "all" ? "all" : PHASES.has(phaseRaw as WyckoffPhase) ? (phaseRaw as WyckoffPhase) : "all";
  const setup = setupRaw === "all" ? "all" : SETUPS.has(setupRaw as WyckoffSetup) ? (setupRaw as WyckoffSetup) : "all";
  const minConfidence = url.searchParams.get("minConfidence") != null ? Number(url.searchParams.get("minConfidence")) : 40;
  const sector = url.searchParams.get("sector") || undefined;
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40) || 40, 60);

  const r = await screenWyckoff({
    symbols: symbols.length ? symbols : undefined,
    phase,
    setup,
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : 40,
    sector,
    limit,
  });
  if (!r) {
    return unavailable("wyckoff-screener", "Chưa đủ nến OHLCV để quét Wyckoff — nguồn lịch sử tạm lỗi.");
  }
  return ok(
    {
      universe: "wyckoff",
      rows: r.rows,
      scanned: r.scanned,
      skipped: r.skipped,
    },
    r.meta,
  );
}
