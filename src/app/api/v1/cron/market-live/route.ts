import { ok, unavailable } from "@/lib/envelope";
import { getVnMarketBoard, getVnIndices, getVnQuotes } from "@/lib/services/stocks";
import { LIQUID_BOARD } from "@/lib/providers/public-vn-feed";
import { ensureSessionPollerStarted } from "@/lib/realtime/session-poller";
import { ensureHeartbeatStarted } from "@/lib/realtime/heartbeat";
import { ensureVndirectWsStarted } from "@/lib/realtime/vndirect-ws";
import { ensureSsiWsStarted } from "@/lib/realtime/ssi-ws";
import { getVnSession } from "@/lib/vn/sessions";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/**
 * High-frequency VN market warm — call every 1–2 min from cronjob.org during session (docs/CRONJOB_ORG.md).
 * GET /api/v1/cron/market-live?secret=...
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;

  const t0 = Date.now();
  const session = getVnSession();
  ensureHeartbeatStarted();
  const poller = ensureSessionPollerStarted();
  // WS stays off by default on Cloudflare Workers (ws-policy). Only starts when
  // VNDIRECT_WS_DISABLED=false / SSI_WS_DISABLED=false is set explicitly.
  try {
    ensureVndirectWsStarted();
    ensureSsiWsStarted();
  } catch {
    /* optional on serverless */
  }

  const [board, indices, liquid] = await Promise.all([
    getVnMarketBoard().catch(() => null),
    getVnIndices().catch(() => null),
    getVnQuotes(LIQUID_BOARD.slice(0, 60)).catch(() => null),
  ]);

  const quotes = board?.quotes?.length ?? liquid?.quotes?.length ?? 0;
  const idxs = board?.indices?.length ?? indices?.items?.length ?? 0;
  if (!quotes && !idxs) {
    return unavailable("vn-market-live", "Không refresh được bảng giá / chỉ số.");
  }

  return ok({
    ok: true,
    session: session.state,
    trading: session.trading,
    quotes,
    indices: idxs,
    liquidQuotes: liquid?.quotes?.length ?? 0,
    source: board?.meta?.source ?? liquid?.meta?.source ?? indices?.meta?.source ?? "unknown",
    durationMs: Date.now() - t0,
    poller,
    recommendedCronSec: session.trading ? 15 : session.open ? 30 : 120,
  });
}
