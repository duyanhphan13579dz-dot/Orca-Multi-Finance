import "server-only";
import { listFinancialProviders } from "./providers-registry";
import { getFinancialMonitorSnapshot } from "./monitor";

export interface SourceHealthRow {
  id: string;
  role: string;
  priority: number;
  configured: boolean;
  recentSuccessRate: number | null;
  avgLatencyMs: number | null;
  attempts: number;
  status: "healthy" | "degraded" | "down" | "not_configured";
}

export interface FinancialSourceHealthReport {
  checkedAt: string;
  sources: SourceHealthRow[];
  overall: "healthy" | "degraded" | "down";
  monitor: ReturnType<typeof getFinancialMonitorSnapshot>["metrics"];
}

/** Snapshot health of registered financial providers + live monitor counters. */
export function getFinancialSourceHealth(): FinancialSourceHealthReport {
  const providers = listFinancialProviders();
  const snap = getFinancialMonitorSnapshot(80);
  const rows: SourceHealthRow[] = providers.map((p) => {
    const configured = p.enabled();
    const by = snap.bySource[p.id];
    const attempts = by?.attempts ?? 0;
    const success = by?.success ?? 0;
    const rate = attempts ? success / attempts : null;
    let status: SourceHealthRow["status"] = "not_configured";
    if (!configured) status = "not_configured";
    else if (attempts === 0) status = "healthy"; // not yet probed this process
    else if (rate != null && rate >= 0.8) status = "healthy";
    else if (rate != null && rate >= 0.4) status = "degraded";
    else status = "down";
    return {
      id: p.id,
      role: p.role,
      priority: p.priority,
      configured,
      recentSuccessRate: rate != null ? Number(rate.toFixed(3)) : null,
      avgLatencyMs: by?.avgLatencyMs ?? null,
      attempts,
      status,
    };
  });

  const active = rows.filter((r) => r.configured);
  let overall: FinancialSourceHealthReport["overall"] = "healthy";
  if (!active.length || active.every((r) => r.status === "down")) overall = "down";
  else if (active.some((r) => r.status === "degraded" || r.status === "down")) overall = "degraded";

  return {
    checkedAt: new Date().toISOString(),
    sources: rows.sort((a, b) => a.priority - b.priority),
    overall,
    monitor: snap.metrics,
  };
}
