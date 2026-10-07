"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Info,
  Layers3,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";

type Meta = { freshness?: string; partial?: boolean; note?: string; source?: string };

type ContractRow = {
  symbol: string;
  daysToExpiry?: number | null;
  quote?: {
    last?: number | null;
    changePercent?: number | null;
    volume?: number | null;
    openInterest?: number | null;
  } | null;
  basis?: { basis?: number | null } | null;
};

type Flow = { symbol: string; kind: string; titleVi?: string; confidence?: number };

type RegimeData = {
  regime: {
    kind: string;
    titleVi: string;
    description: string;
    tone: string;
    confidence: number;
  };
  flowKind: string | null;
  curveShape: string | null;
  frontBasis: number | null;
  frontSymbol: string | null;
};

type CurveData = {
  points: Array<{ symbol: string; last: number | null }>;
  spreads: Array<{ near: string; far: string; spread: number; shape: string }>;
  note: string;
};

type Alert = { id: string; severity: string; titleVi: string; detail: string };

function fmt(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        <Info className="size-4 text-text-muted" aria-label="Thông tin" />
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function DerivativesDashboard() {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [flow, setFlow] = useState<Flow[]>([]);
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [curve, setCurve] = useState<CurveData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [snapRes, regimeRes, curveRes, alertsRes] = await Promise.all([
        fetch("/api/v1/derivatives/snapshot?core=1").then((r) => r.json()),
        fetch("/api/v1/derivatives/regime?underlying=VN30").then((r) => r.json()),
        fetch("/api/v1/derivatives/curve?underlying=VN30").then((r) => r.json()),
        fetch("/api/v1/derivatives/alerts?underlying=VN30").then((r) => r.json()),
      ]);
      setContracts(snapRes?.data?.contracts ?? []);
      setFlow(snapRes?.data?.flow ?? []);
      setMeta(snapRes?.meta ?? null);
      setRegime(regimeRes?.data ?? null);
      setCurve(curveRes?.data ?? null);
      setAlerts(alertsRes?.data?.alerts ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const tone =
    regime?.regime.tone === "positive"
      ? "text-emerald-400"
      : regime?.regime.tone === "negative"
        ? "text-rose-400"
        : regime?.regime.tone === "warning"
          ? "text-amber-400"
          : "text-text-muted";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Phái sinh VN</h1>
          <p className="text-sm text-text-muted">
            Contract Master · Flow · Curve · Regime ·{" "}
            {meta?.freshness ?? (loading ? "…" : "—")}
            {meta?.partial ? " · partial" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {err}
        </div>
      )}

      {meta?.note && (
        <p className="text-xs text-text-muted flex items-center gap-1">
          <Clock3 className="size-3" /> {meta.note}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Regime" subtitle={regime?.regime.titleVi ?? "—"} className="lg:col-span-1">
          <div className={`text-2xl font-semibold ${tone}`}>{regime?.regime.kind ?? "insufficient"}</div>
          <p className="mt-1 text-sm text-text-muted">{regime?.regime.description ?? "Chưa đủ dữ liệu"}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">
            {regime?.frontSymbol && <span>Front: {regime.frontSymbol}</span>}
            {regime?.frontBasis != null && <span>Basis: {fmt(regime.frontBasis, 1)}</span>}
            {regime?.curveShape && <span>Curve: {regime.curveShape}</span>}
            {regime?.flowKind && <span>Flow: {regime.flowKind}</span>}
          </div>
        </Panel>

        <Panel title="Alerts" subtitle="Basis / regime" className="lg:col-span-2">
          {alerts.length === 0 ? (
            <p className="text-sm text-text-muted">Không có cảnh báo (hoặc thiếu quote).</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
                  <ShieldAlert
                    className={`mt-0.5 size-4 shrink-0 ${
                      a.severity === "critical"
                        ? "text-rose-400"
                        : a.severity === "warning"
                          ? "text-amber-400"
                          : "text-sky-400"
                    }`}
                  />
                  <div>
                    <div className="font-medium">{a.titleVi}</div>
                    <div className="text-text-muted text-xs">{a.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Hợp đồng VN30" subtitle="Quote live hoặc N/A">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border/50">
                <th className="py-2 pr-2">Symbol</th>
                <th className="py-2 pr-2">Last</th>
                <th className="py-2 pr-2">Chg%</th>
                <th className="py-2 pr-2">Basis</th>
                <th className="py-2 pr-2">OI</th>
                <th className="py-2 pr-2">Vol</th>
                <th className="py-2">DTE</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-text-muted">
                    {loading ? "Đang tải…" : "Chưa có contract / quote"}
                  </td>
                </tr>
              )}
              {contracts.map((c) => {
                const chg = c.quote?.changePercent;
                const up = chg != null && chg >= 0;
                return (
                  <tr key={c.symbol} className="border-b border-border/30">
                    <td className="py-2 pr-2 font-medium">{c.symbol}</td>
                    <td className="py-2 pr-2">{fmt(c.quote?.last ?? null, 1)}</td>
                    <td className="py-2 pr-2">
                      <span
                        className={`inline-flex items-center gap-0.5 ${
                          chg == null ? "text-text-muted" : up ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {chg != null && (up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}
                        {chg == null ? "N/A" : `${up ? "+" : ""}${chg.toFixed(2)}%`}
                      </span>
                    </td>
                    <td className="py-2 pr-2">{fmt(c.basis?.basis ?? null, 1)}</td>
                    <td className="py-2 pr-2">{fmt(c.quote?.openInterest ?? null, 0)}</td>
                    <td className="py-2 pr-2">{fmt(c.quote?.volume ?? null, 0)}</td>
                    <td className="py-2">{c.daysToExpiry ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Term structure" subtitle={curve?.note ?? "—"}>
          <div className="flex flex-wrap gap-3">
            {(curve?.points ?? []).map((p) => (
              <div key={p.symbol} className="rounded-md border border-border/50 px-3 py-2 text-center min-w-[5.5rem]">
                <div className="text-xs text-text-muted">{p.symbol}</div>
                <div className="text-lg font-semibold">{fmt(p.last, 1)}</div>
              </div>
            ))}
            {(curve?.points?.length ?? 0) === 0 && (
              <p className="text-sm text-text-muted">Curve insufficient</p>
            )}
          </div>
          {(curve?.spreads?.length ?? 0) > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-text-muted">
              {curve!.spreads.map((s) => (
                <li key={`${s.near}-${s.far}`}>
                  {s.near}−{s.far}: {s.spread} ({s.shape})
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Flow" subtitle="Δprice × ΔOI">
          {flow.length === 0 ? (
            <p className="text-sm text-text-muted">Chưa có flow (cần 2 snapshot hoặc OI).</p>
          ) : (
            <ul className="space-y-2">
              {flow.map((f) => (
                <li
                  key={f.symbol}
                  className="flex items-center justify-between rounded-md border border-border/40 px-2 py-1.5 text-sm"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <TrendingUp className="size-3.5 text-text-muted" />
                    <span className="font-medium">{f.symbol}</span>
                    <span className="text-text-muted">{f.titleVi ?? f.kind}</span>
                  </span>
                  <span className="text-xs text-text-muted">
                    {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="text-xs text-text-muted flex items-center gap-1">
        <Layers3 className="size-3" />
        Nguồn: /api/v1/derivatives/* · không bịa giá khi thiếu feed
      </p>
    </div>
  );
}
