import { env } from "@/lib/env";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { ok } from "@/lib/envelope";
import { getProviderHealth } from "@/lib/health";
import { cacheStats, redisStatus } from "@/lib/cache";
import { llmConfigured as isLlmConfigured } from "@/lib/ai/gateway";

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
  return ok(
    {
      app: { name: "ORCA Financial", version, environment: env.nodeEnv, nodeEnv: env.nodeEnv },
      runtime: { uptimeSec: Math.round((Date.now() - startedAt) / 1000), serverTime: new Date().toISOString() },
      database: { configured: dbConfigured, connected: dbOk, latencyMs: dbLatencyMs },
      redis,
      dataEngine: {
        providersTotal: providers.length,
        providersHealthy: healthy,
        providersDown: down,
        cache: cacheStats(),
      },
      features: {
        vnstockConfigured: Boolean(env.vnstockApiKey),
        biquoteConfigured: Boolean(env.biquoteApiKey),
        simplizeConfigured: Boolean(env.simplizeApiKey),
        llmConfigured: isLlmConfigured(),
        msnCommodityMap: Boolean(env.msnCommodityMapRaw),
      },
    },
    { source: "orca-ops" },
  );
}
