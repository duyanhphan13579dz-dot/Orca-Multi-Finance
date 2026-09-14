import "server-only";
import { listFinancialProviders } from "./providers-registry";
import { getFinancialMonitorSnapshot } from "./monitor";
import { vnProviderLayout } from "./index";
import { ssiFcConfigured } from "../providers/ssi-fcdata";

export interface MarketSourceHealthRow {
  provider: "ssi-fcdata" | "vndirect";
  configured: boolean;
  role: "primary" | "fallback";
  status: "healthy" | "degraded" | "down" | "not_configured";
}

/** Đổi primary/fallback cho market data. Mặc định: vndirect primary, ssi-fcdata fallback nếu có cấu hình. */
// Không dùng hàm này — VNDIRECT luôn primary, SSI chỉ fallback.
// Nếu cần runtime-switch provider, thêm endpoint riêng trong src/app/api/v1/system/*
export function setMarketProviderLayout(_layout: { primary: "vndirect" | "ssi-fcdata"; fallback: "vndirect" | "ssi-fcdata" | null }): void {
  throw new Error("setMarketProviderLayout không còn hỗ trợ — primary luôn là VNDIRECT");
}

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

/**
 * Snapshot health of registered financial providers + live monitor counters.
 * VNDIRECT là primary luôn; SSI là fallback khi đã cấu hình.
 */
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

export interface MarketSourceHealth {
  layout: ReturnType<typeof vnProviderLayout>["market"];
  rows: MarketSourceHealthRow[];
}

export function getMarketSourceHealth(): MarketSourceHealth {
  const layout = vnProviderLayout().market;
  // VNDIRECT luôn primary, SSI chỉ fallback khi có cấu hình.
  const ssiConfigured = layout.fallback === "ssi-fcdata";
  return {
    layout,
    rows: [
      {
        provider: "ssi-fcdata",
        configured: ssiConfigured,
        role: "fallback",
        status: ssiConfigured ? "healthy" : "not_configured",
      },
      {
        provider: "vndirect",
        configured: true,
        role: "primary",
        status: "healthy",
      },
    ],
  };
}
