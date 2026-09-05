"use client";

import { useApi } from "@/lib/hooks";
import type { ProviderStatus } from "@/lib/types";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Activity, Cpu, Database, RefreshCw, Server, Zap } from "lucide-react";

interface StreamState {
  state: "open" | "connecting" | "closed" | "blocked" | "disabled" | "retrying";
  connectedAt: number | null;
  lastMessageAt: number | null;
  messagesPerMin: number;
  reconnectAttempts: number;
  lastError: string | null;
}
interface RealtimeInfo {
  enabled: boolean;
  spot: StreamState;
  futures: StreamState;
  kline?: StreamState;
  klineStreams?: number;
  tickersTracked: number;
  marksTracked: number;
}
interface OpsData {
  providers: ProviderStatus[];
  cache: { entries: number; hits: number; staleServed: number; inflight: number; redisEnabled: boolean };
  realtime?: RealtimeInfo;
  serverTime: string;
  counts: { total: number; healthy: number; degraded: number; down: number; unknown: number };
}

const STATUS_TONE: Record<ProviderStatus["status"], "up" | "down" | "warn" | "neutral"> = {
  healthy: "up",
  degraded: "warn",
  down: "down",
  unknown: "neutral",
};

export default function SystemPage() {
  const { data, isLoading, mutate } = useApi<OpsData>("/api/v1/system/providers", { refreshInterval: 10_000 });
  if (isLoading && !data) return <Loading rows={10} />;
  const d = data;
  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="size-5 text-accent" /> Giám sát hệ thống & Data Providers
          </h1>
          {d && (
            <div className="flex gap-1.5">
              <Badge tone="up">{d.counts.healthy} healthy</Badge>
              {d.counts.degraded > 0 && <Badge tone="warn">{d.counts.degraded} degraded</Badge>}
              {d.counts.down > 0 && <Badge tone="down">{d.counts.down} down</Badge>}
              {d.counts.unknown > 0 && <Badge>{d.counts.unknown} chưa gọi</Badge>}
            </div>
          )}
          <button onClick={() => mutate()} className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink">
            <RefreshCw className="size-3" /> Làm mới
          </button>
        </div>
        {d && (
          <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">
            Server: {new Date(d.serverTime).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · Cơ chế: timeout → retry exponential backoff → circuit breaker (4 lỗi liên tiếp mở 60s) → cache STALE gần nhất → gắn nhãn trạng thái thay vì mock data.
          </div>
        )}
      </Panel>

      {d?.realtime && (
        <Panel
          pad={false}
          title={<span className="flex items-center gap-2"><Cpu className="size-4 text-warning" /> Realtime Ingestion Engine — Binance WebSocket (centralized)</span>}
        >
          <div className="grid grid-cols-1 gap-2 p-3.5 md:grid-cols-4">
            <WsCard label="Spot stream (!ticker@arr)" s={d.realtime.spot} extra={d.realtime.enabled ? `${d.realtime.tickersTracked} tickers tracked` : "disabled by env"} />
            <WsCard label="Futures stream (!markPrice@arr)" s={d.realtime.futures} extra={`${d.realtime.marksTracked} marks tracked`} />
            {d.realtime.kline && (
              <WsCard
                label="Kline streams (chart candles)"
                s={d.realtime.kline}
                extra={`${d.realtime.klineStreams ?? 0} subscriptions (lazy — chỉ khi có viewer)`}
              />
            )}
            <div className="panel-inset p-2.5 text-[11px] leading-relaxed text-text-muted">
              Một kết nối dùng chung cho toàn platform (không bao giờ per-user). Khi stream bị chặn theo vùng mạng, engine backoff thông minh và REST pipeline vẫn là nguồn sự thật — trạng thái luôn minh bạch tại đây. Dữ liệu WS khi LIVE sẽ override REST trong crypto engine.
            </div>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {d?.providers.map((p) => (
          <Panel key={p.provider} pad={false} className="hover-lift">
            <div className="p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <Server className="size-4 text-accent/80" /> {p.provider}
                </span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <Row k="Domain" v={p.domain} />
                <Row k="Circuit" v={p.circuit} tone={p.circuit === "open" ? "text-down" : p.circuit === "half-open" ? "text-warn" : "text-up"} />
                <Row k="Độ trễ gần nhất" v={p.lastLatencyMs != null ? `${Math.round(p.lastLatencyMs)}ms` : "—"} />
                <Row k="Độ trễ TB" v={p.avgLatencyMs != null ? `${p.avgLatencyMs}ms` : "—"} />
                <Row k="Thành công" v={String(p.successCount)} tone="text-up" />
                <Row k="Thất bại" v={String(p.failureCount)} tone={p.failureCount > 0 ? "text-down" : undefined} />
                <Row k="Lỗi liên tiếp" v={String(p.consecutiveFailures)} tone={p.consecutiveFailures > 0 ? "text-warn" : undefined} />
                <Row k="Thành công cuối" v={p.lastSuccessAt ? timeAgo(p.lastSuccessAt) : "—"} />
                <Row k="Lỗi cuối" v={p.lastFailureAt ? timeAgo(p.lastFailureAt) : "—"} />
              </div>
              {p.lastError && <p className="mt-2 truncate rounded bg-down/5 px-2 py-1 text-[10px] text-down/90" title={p.lastError}>{p.lastError}</p>}
              {p.recentEvents.length > 0 && (
                <div className="mt-2 max-h-20 space-y-0.5 overflow-y-auto border-t border-line/60 pt-1.5">
                  {p.recentEvents.slice(0, 5).map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] text-ink-3">
                      <span className={`size-1 rounded-full ${e.event === "success" ? "bg-up" : e.event === "circuit_open" ? "bg-warn" : "bg-down"}`} />
                      <span className="num">{timeAgo(e.at)}</span>
                      <span className="truncate">{e.event}{e.latencyMs != null ? ` · ${Math.round(e.latencyMs)}ms` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        ))}
      </div>

      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard icon={<Database className="size-4" />} label="Cache entries" value={String(d.cache.entries)} />
          <StatCard icon={<Zap className="size-4" />} label="Cache hits" value={String(d.cache.hits)} />
          <StatCard icon={<RefreshCw className="size-4" />} label="STALE phục vụ" value={String(d.cache.staleServed)} />
          <StatCard icon={<Cpu className="size-4" />} label="In-flight dedupe" value={String(d.cache.inflight)} />
          <StatCard icon={<Server className="size-4" />} label="Redis" value={d.cache.redisEnabled ? "enabled" : "memory mode"} />
        </div>
      )}
    </div>
  );
}

function WsCard({ label, s, extra }: { label: string; s: StreamState; extra: string }) {
  const tone = s.state === "open" ? "up" : s.state === "disabled" ? "neutral" : s.state === "connecting" || s.state === "retrying" ? "warn" : "down";
  return (
    <div className="panel-inset p-2.5">
      <div className="flex items-center justify-between">
        <span className="num text-[11px] text-text-secondary">{label}</span>
        <Badge tone={tone}>{s.state}</Badge>
      </div>
      <div className="num mt-1.5 grid grid-cols-3 gap-1 text-[11px] text-text-muted">
        <span>msg/min <b className="text-text-primary">{s.messagesPerMin}</b></span>
        <span>reconnect <b className="text-text-primary">{s.reconnectAttempts}</b></span>
        <span>last msg <b className="text-text-primary">{s.lastMessageAt ? timeAgo(new Date(s.lastMessageAt).toISOString()) : "—"}</b></span>
      </div>
      {s.lastError && <p className="mt-1 truncate text-[10px] text-negative/90" title={s.lastError}>{s.lastError}</p>}
      <p className="mt-1 text-[10px] text-text-muted">{extra}</p>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-3">{k}</span>
      <span className={`num ${tone ?? "text-ink-2"}`}>{v}</span>
    </div>
  );
}
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="panel flex items-center gap-2.5 p-3">
      <span className="grid size-8 place-items-center rounded-md bg-accent/10 text-accent">{icon}</span>
      <span>
        <span className="block text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
        <span className="num text-[14px] font-semibold">{value}</span>
      </span>
    </div>
  );
}
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.round(s / 60)}p trước`;
  if (s < 86400) return `${Math.round(s / 3600)}h trước`;
  return `${Math.round(s / 86400)}d trước`;
}

export { FreshnessDot };
