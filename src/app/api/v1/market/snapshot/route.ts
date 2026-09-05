import { ok, fail } from "@/lib/envelope";
import { buildMarketSnapshot } from "@/lib/services/market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { snapshot, meta } = await buildMarketSnapshot();
    return ok(snapshot, meta);
  } catch (e) {
    return fail("SNAPSHOT_FAILED", e instanceof Error ? e.message : "unknown", 502);
  }
}
