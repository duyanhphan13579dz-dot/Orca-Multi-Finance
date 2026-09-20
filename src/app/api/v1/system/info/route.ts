import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { ok } from "@/lib/envelope";
import { getProviderHealth } from "@/lib/health";
import { getLastNetworkLatency, probeNetworkLatency } from "@/lib/network-latency";
import { ensureHeartbeatStarted, processHeartbeat } from "@/lib/realtime/heartbeat";
import { cacheStats, redisStatus } from "@/lib/cache";
import { llmConfigured } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startedAt = Date.now();

/** Non-sensitive system information for Settings › System. */
export async function GET() {
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: string; name?: string };
    version = pkg.version ?? version;
  } catch {
    /* ignore */
  }

  // Best-effort DB ping
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await sql`select 1`;
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  // Provider health snapshot
  const health = getProviderHealth();

  // Network latency (cached probe)
  let network = getLastNetworkLatency();
  if (!network) {
    try {
      network = await probeNetworkLatency();
    } catch {
      network = null;
    }
  }

  // Heartbeat
  ensureHeartbeatStarted();
  const heartbeat = processHeartbeat();

  const redis = redisStatus();
  const cache = cacheStats();

  return ok(
    {
      version,
      uptimeMs: Date.now() - startedAt,
      nodeEnv: process.env.NODE_ENV ?? "development",
      runtime: "nodejs",
      database: { ok: dbOk, latencyMs: dbLatencyMs },
      redis,
      cache,
      network,
      heartbeat,
      providers: health,
      flags: {
        ssiConfigured: Boolean(
          process.env.SSI_FC_CONSUMER_ID?.trim() || process.env.SSI_API_KEY?.trim(),
        ),
        vnstockConfigured: Boolean(process.env.VNSTOCK_API_KEY?.trim()),
        biquoteConfigured: Boolean(process.env.BIQUOTE_API_KEY?.trim()),
        simplizeConfigured: Boolean(process.env.SIMPLIZE_API_KEY?.trim()),
        llmConfigured: llmConfigured(),
        msnCommodityMap: Boolean(process.env.MSN_COMMODITY_MAP?.trim()),
      },
    },
    { source: "orca-system-info" },
  );
}
