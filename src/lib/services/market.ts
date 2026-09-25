/**
 * Market snapshot service — VN session + lightweight envelope.
 * Minimal module so /api/v1/market/snapshot and stocks board can compile.
 */

import { getVnSession, sessionFreshnessHint, type VnSessionInfo } from "@/lib/vn/sessions";
import { buildMeta } from "@/lib/freshness";
import type { Meta } from "@/lib/types";

export type MarketSnapshot = {
  vnSession: VnSessionInfo;
  vnSessionHint: string;
  checkedAt: string;
};

export async function buildMarketSnapshot(): Promise<{
  snapshot: MarketSnapshot;
  meta: Meta;
}> {
  const vnSession = getVnSession();
  const checkedAt = new Date().toISOString();
  const snapshot: MarketSnapshot = {
    vnSession,
    vnSessionHint: sessionFreshnessHint(vnSession.state),
    checkedAt,
  };
  const meta = buildMeta({
    source: "vn-session",
    sourceTimestampMs: Date.now(),
    hasData: true,
    note: vnSession.labelVi,
  });
  return { snapshot, meta };
}
