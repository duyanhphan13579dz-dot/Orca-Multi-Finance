"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge, Panel } from "@/components/ui";
import { Activity, Loader2, PlugZap, RefreshCw } from "lucide-react";

/**
 * Source connectivity self-test panel (ops) — calls
 * GET /api/v1/system/connectivity?force=1 and renders one row per catalogued source:
 * reachability, latency, circuit state and whether the source needs env config.
 */

type RowStatus = "ok" | "fail" | "circuit_open" | "not_configured";

interface ConnectivityRow {
  id: string;
  domain: string;
  role: string;
  status: RowStatus;
  latencyMs: number | null;
  error: string | null;
  note: string | null;
  circuit: string | null;
  recentSuccessRate: number | null;
  avgLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

interface ConnectivityPayload {
  checkedAt: string;
  durationMs: number;
  probeBudgetMs: number;
  summary: {
    total: number;
    ok: number;
    fail: number;
    openCircuits: number;
    skipped: number;
    catalogTotal: number;
    probed: number;
  };
  byDomain: Record<string, { total: number; ok: number; fail: number; notConfigured: number }>;
  rows: ConnectivityRow[];
  routes: Record<string, string[]>;
  candidates: { id: string; name: string; notes: string }[];
  catalogTotal: number;
}

const DOMAIN_LABEL: Record<string, string> = {
  market: "VN cổ phiếu — giá & OHLCV",
  financial: "BCTC / doanh nghiệp",
  official: "Nguồn chính thức (SSC…)",
  crypto: "Crypto",
  forex: "Forex",
  commodity: "Hàng hoá",
  news: "Tin tức",
  macro: "Vĩ mô",
  rates: "Lãi suất / phái sinh",
};

const STATUS_TONE: Record<RowStatus, "up" | "down" | "warn" | "neutral"> = {
  ok: "up",
  fail: "down",
  circuit_open: "warn",
  not_configured: "neutral",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: "kết nối ok",
  fail: "không phản hồi",
  circuit_open: "circuit mở",
  not_configured: "chưa cấu hình",
};

export function ConnectivityPanel() {
  const [payload, setPayload] = useState<ConnectivityPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/system/connectivity${force ? "?force=1" : ""}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: ConnectivityPayload; error?: { message?: string } }
        | null;
      if (res.status === 401) throw new Error("Cần đăng nhập để chạy kiểm tra kết nối nguồn.");
      if (!json?.success || !json.data) {
        throw new Error(json?.error?.message ?? `Không chạy được kiểm tra (HTTP ${res.status}).`);
      }
      setPayload(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi kiểm tra kết nối");
    } finally {
      setLoading(false);
    }
  }, []);

  const grouped = useMemo(() => {
    const out = new Map<string, ConnectivityRow[]>();
    for (const row of payload?.rows ?? []) {
      const list = out.get(row.domain) ?? [];
      list.push(row);
      out.set(row.domain, list);
    }
    return [...out.entries()];
  }, [payload]);

  return (
    <Panel
      pad={false}
      title={
        <span className="flex items-center gap-2">
          <PlugZap className="size-4 text-accent" /> Kiểm tra kết nối nguồn dữ liệu
        </span>
      }
      subtitle="Probe thật từng nguồn (catalog → adapter): market, BCTC, crypto, forex, hàng hoá, tin tức."
      right={
        <div className="flex items-center gap-2">
          {payload && (
            <span className="flex gap-1.5">
              <Badge tone="up">{payload.summary.ok} ok</Badge>
              {payload.summary.fail > 0 && <Badge tone="down">{payload.summary.fail} lỗi</Badge>}
              {payload.summary.skipped > 0 && <Badge>{payload.summary.skipped} chưa cấu hình</Badge>}
            </span>
          )}
          <button
            onClick={() => void run(true)}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {loading ? "Đang probe…" : "Chạy kiểm tra"}
          </button>
        </div>
      }
    >
      {!payload && !error && (
        <div className="flex flex-wrap items-center gap-2 p-4 text-[11px] text-ink-3">
          <Activity className="size-3.5" />
          Bấm “Chạy kiểm tra” để probe toàn bộ nguồn đã đăng ký ({`/api/v1/system/connectivity`}). Kết quả gồm
          độ trễ, circuit và thứ tự fallback theo domain.
        </div>
      )}

      {error && <div className="p-4 text-[11px] text-down">{error}</div>}

      {payload && (
        <>
          <div className="border-b border-line px-4 py-2 text-[11px] text-ink-3">
            {payload.summary.ok}/{payload.summary.probed} nguồn phản hồi · {payload.durationMs}ms ·{" "}
            {new Date(payload.checkedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
            {" · "}
            {payload.catalogTotal} nguồn trong catalog
          </div>
          <div className="divide-y divide-line/60">
            {grouped.map(([domain, rows]) => (
              <div key={domain} className="px-4 py-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[12px] font-semibold">{DOMAIN_LABEL[domain] ?? domain}</span>
                  <span className="num text-[10px] text-ink-3">
                    {payload.byDomain[domain]?.ok ?? 0}/{rows.length} ok
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                  {rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 text-[11px]">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          row.status === "ok"
                            ? "bg-up"
                            : row.status === "not_configured"
                              ? "bg-ink-3"
                              : row.status === "circuit_open"
                                ? "bg-warn"
                                : "bg-down"
                        }`}
                      />
                      <span className="num shrink-0 text-ink-2" title={row.note ?? undefined}>
                        {row.id}
                      </span>
                      <span className="truncate text-[10px] text-ink-3">{STATUS_LABEL[row.status]}</span>
                      {row.latencyMs != null && (
                        <span className="num ml-auto shrink-0 text-[10px] text-ink-3">{row.latencyMs}ms</span>
                      )}
                    </div>
                  ))}
                </div>
                {payload.routes[domain]?.length > 1 && (
                  <p className="mt-1.5 truncate text-[10px] text-ink-3">
                    Fallback: {payload.routes[domain].join(" → ")}
                  </p>
                )}
              </div>
            ))}
          </div>
          {payload.candidates.length > 0 && (
            <div className="border-t border-line px-4 py-2 text-[10px] text-ink-3">
              Nguồn công khai chưa nối adapter: {payload.candidates.map((c) => c.id).join(", ")}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
