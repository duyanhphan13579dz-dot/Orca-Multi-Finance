import { ok } from "@/lib/envelope";
import { requireInternalSession } from "@/lib/internal-api-auth";
import { getProviderHealth } from "@/lib/health";
import { catalogSummary, SOURCE_CATALOG } from "@/lib/data-engine/catalog";
import { getLastSync, syncAllSources } from "@/lib/data-engine/source-sync";
import { PUBLIC_SOURCE_CATALOG } from "@/lib/providers/public-source-catalog";
import type { SourceDomain } from "@/lib/data-engine/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/system/connectivity[?force=1&timeout=2500]
 *
 * Connectivity self-test for every catalogued market / financial / crypto / fx /
 * commodity / news source:
 *  - reachability probe per source (real cheap GET, honours BIQUOTE/POLYGON/VNSTOCK env)
 *  - resolved fallback route per domain (healthy + fastest first)
 *  - provider health/circuit snapshot for the same ids
 *
 * Row status: ok | fail | circuit_open | not_configured.
 */
export async function GET(req: Request) {
  const unauthorized = await requireInternalSession();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  const timeoutParam = Number(url.searchParams.get("timeout") ?? 0);
  const timeoutMs = Number.isFinite(timeoutParam) && timeoutParam >= 500 ? Math.min(timeoutParam, 10_000) : 2_500;

  const started = Date.now();
  const report = await syncAllSources({ force, timeoutMs });
  const health = getProviderHealth();
  const healthById = new Map(health.map((h) => [h.provider, h]));

  const rows = report.probes.map((p) => {
    const h = healthById.get(p.id);
    const status: "ok" | "fail" | "circuit_open" | "not_configured" = !p.configured
      ? "not_configured"
      : p.circuitOpen
        ? "circuit_open"
        : p.ok
          ? "ok"
          : "fail";
    return {
      id: p.id,
      domain: p.domain,
      role: p.role,
      status,
      latencyMs: p.latencyMs,
      error: p.error,
      note: p.note ?? null,
      circuit: h?.circuit ?? null,
      recentSuccessRate:
        h && h.successCount + h.failureCount > 0
          ? Number((h.successCount / (h.successCount + h.failureCount)).toFixed(3))
          : null,
      avgLatencyMs: h?.avgLatencyMs ?? null,
      lastSuccessAt: h?.lastSuccessAt ?? null,
      lastError: h?.lastError ?? null,
    };
  });

  const byDomain: Record<string, { total: number; ok: number; fail: number; notConfigured: number }> = {};
  for (const r of rows) {
    const d = (byDomain[r.domain] ??= { total: 0, ok: 0, fail: 0, notConfigured: 0 });
    d.total += 1;
    if (r.status === "ok") d.ok += 1;
    else if (r.status === "not_configured") d.notConfigured += 1;
    else d.fail += 1;
  }

  const catalog = catalogSummary();
  const wiredIds = new Set(SOURCE_CATALOG.map((s) => s.id));

  return ok(
    {
      checkedAt: report.probedAt,
      durationMs: Math.round(Date.now() - started),
      probeBudgetMs: timeoutMs,
      summary: report.summary,
      byDomain,
      rows,
      /** domain → ordered source ids (healthy + fastest first) */
      routes: report.routes as Record<SourceDomain | string, string[]>,
      /** documented public sources that are not yet wired to a runtime adapter */
      candidates: PUBLIC_SOURCE_CATALOG.filter((c) => !c.providerId || !wiredIds.has(c.providerId)).map(
        (c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          access: c.access,
          cadence: c.cadence,
          apiKeyRequired: c.apiKeyRequired,
          url: c.url,
          notes: c.notes,
        }),
      ),
      catalogTotal: catalog.total,
      lastSync: getLastSync()?.probedAt ?? null,
      tips: [
        "?force=1 bỏ qua cache 20s và probe lại toàn bộ nguồn",
        "status=not_configured nghĩa là nguồn cần env (SSI/VNSTOCK/POLYGON/BIQUOTE) chưa được khai báo",
        "routes[*] là thứ tự ưu tiên đã xếp theo health + latency của lần sync gần nhất",
      ],
    },
    { source: "orca-connectivity" },
  );
}
