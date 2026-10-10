import { ok, unavailable } from "@/lib/envelope";
import { cronUnauthorized } from "@/lib/cron-auth";
import { hotStats } from "@/lib/hot-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** P8a: unified endpoint is thin — prefer focused crons to avoid 1102 */
export const maxDuration = 12;

/**
 * P8a: thin status / optional fan-out coordinator.
 * Prefer focused crons (no shared 28s budget):
 *   /api/v1/cron/board-warm
 *   /api/v1/cron/forex-warm
 *   /api/v1/cron/crypto-warm
 *   /api/v1/cron/global-warm
 *   /api/v1/cron/intel-warm
 *   /api/v1/cron/multi-asset-warm
 *   /api/v1/cron/screener-warm
 *   /api/v1/cron/commodities-warm
 *
 * This route only reports slot ages — does NOT warm all domains
 * (that caused late-slot 1102 under one 28s wall).
 *
 * Optional ?trigger=board,forex — fire light sequential warms if budget left.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const trigger = (url.searchParams.get("trigger") ?? "").trim().toLowerCase();
  const t0 = Date.now();
  const results: Record<string, { ok: boolean; ms: number; note?: string }> = {};

  // Optional single-domain trigger only (never all-at-once)
  if (trigger === "board" || trigger === "forex" || trigger === "crypto" || trigger === "global") {
    try {
      const origin = new URL(req.url).origin;
      const secret = url.searchParams.get("secret") ?? "";
      const pathMap: Record<string, string> = {
        board: "/api/v1/cron/board-warm",
        forex: "/api/v1/cron/forex-warm",
        crypto: "/api/v1/cron/crypto-warm",
        global: "/api/v1/cron/global-warm",
      };
      const path = pathMap[trigger];
      const s = Date.now();
      const res = await fetch(`${origin}${path}?secret=${encodeURIComponent(secret)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      results[trigger] = {
        ok: res.ok,
        ms: Date.now() - s,
        note: `proxy ${res.status}`,
      };
    } catch (e) {
      results[trigger] = {
        ok: false,
        ms: Date.now() - t0,
        note: e instanceof Error ? e.message : "err",
      };
    }
  }

  const slots = hotStats();
  const hasAny = Object.values(slots).some((s) => s.has);

  if (!hasAny && !Object.values(results).some((r) => r.ok)) {
    return unavailable(
      "hot-warm",
      "Chưa có hot slot — gọi board-warm / forex-warm / crypto-warm / global-warm / intel-warm riêng",
    );
  }

  return ok(
    {
      ok: true,
      mode: "p8a-thin",
      slots,
      results,
      durationMs: Date.now() - t0,
      recommend: [
        "board-warm every 45–60s",
        "forex-warm every 45–60s",
        "crypto-warm every 60s",
        "global-warm every 60s",
        "intel-warm every 60–90s",
        "multi-asset-warm every 60–90s",
        "screener-warm every 2–3min",
        "commodities-warm every 2–5min",
      ],
    },
    { source: "hot-warm-status", note: "P8a thin — focused crons own produce" },
    { "Cache-Control": "no-store" },
  );
}
