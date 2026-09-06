import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { ok } from "@/lib/envelope";
import { getProviderHealth } from "@/lib/health";
import { cacheStats, redisStatus } from "@/lib/cache";

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
      app: { name: "ORCA Financial", version, environment: process.env.NODE_ENV ?? "development", nodeEnv: process.env.NODE_ENV },
      runtime: { uptimeSec: Math.round((Date.now() - startedAt) / 1000), serverTime: new Date().toISOString() },
      database: { connected: dbOk, latencyMs: dbLatencyMs },
      redis,
      dataEngine: {
        providersTotal: providers.length,
        providersHealthy: healthy,
        providersDown: down,
        cache: cacheStats(),
      },
      features: {
        vndirectConfigured: true, // VNDirect finfo public keyless
        biquoteConfigured: Boolean(process.env.BIQUOTE_API_KEY?.trim()),
        simplizeConfigured: Boolean(process.env.SIMPLIZE_API_KEY?.trim()),
        llmConfigured: Boolean(process.env.AI_PROVIDER_KEY?.trim()) || process.env.AI_LLM_ENABLED === "true",
        /** MSN Finance đã bỏ khỏi flow hàng hóa (directive 2026-09-06) — chỉ nguồn VietnamBiz Data */
        commodityQuotesSource: "VietnamBiz Data (WiFeed)" as const,
        commodityQuoteProviders: ["vietnambiz-data"] as const,
      },
    },
    { source: "orca-ops" },
  );
}
