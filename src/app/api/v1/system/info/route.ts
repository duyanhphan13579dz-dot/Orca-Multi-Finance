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
    /* default */
  }
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  const { databaseConfigured } = await import("@/db");
  const dbConfigured = databaseConfigured();
  try {
    const t0 = performance.now();
    const { db } = await import("@/db");
    await db.execute(sql`select 1`);
    dbLatencyMs = Math.round(performance.now() - t0);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const redis = await redisStatus();
  const providers = getProviderHealth();
  const healthy = providers.filter((p) => p.status === "healthy").length;
  const down = providers.filter((p) => p.status === "down").length;

  ensureHeartbeatStarted();
  // Non-blocking network latency: use cache if warm, else kick a background probe
  let network = getLastNetworkLatency();
  if (!network) {
    void probeNetworkLatency({ timeoutMs: 4_000 }).catch(() => null);
  }
  const heartbeat = processHeartbeat.stats();

  return ok(
    {
      app: { name: "ORCA Financial", version, environment: process.env.NODE_ENV ?? "development", nodeEnv: process.env.NODE_ENV },
      runtime: { uptimeSec: Math.round((Date.now() - startedAt) / 1000), serverTime: new Date().toISOString() },
      database: { configured: dbConfigured, connected: dbOk, latencyMs: dbLatencyMs },
      redis,
      heartbeat,
      networkLatency: network
        ? {
            summary: network.summary,
            probedAt: network.probedAt,
            hosts: network.results.map((r) => ({
              id: r.id,
              ok: r.ok,
              latencyMs: r.latencyMs,
              error: r.error,
            })),
          }
        : null,
      dataEngine: {
        providersTotal: providers.length,
        providersHealthy: healthy,
        providersDown: down,
        cache: cacheStats(),
      },
      features: {
        vnstockConfigured: Boolean(process.env.VNSTOCK_API_KEY?.trim()),
        biquoteConfigured: Boolean(process.env.BIQUOTE_API_KEY?.trim()),
        simplizeConfigured: Boolean(process.env.SIMPLIZE_API_KEY?.trim()),
        llmConfigured: llmConfigured(),
        msnCommodityMap: Boolean(process.env.MSN_COMMODITY_MAP?.trim()),
      },
    },
    { source: "orca-ops" },
  );
}
