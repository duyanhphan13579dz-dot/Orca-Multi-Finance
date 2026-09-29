"use client";

import { useState } from "react";
import { useSettings, DASHBOARD_WIDGETS } from "@/lib/settings";
import { Badge, formatAge } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { ProviderStatus } from "@/lib/types";
import { Row, Section, Seg, Switch } from "@/components/settings-panels-extra";
import { ArrowDown, ArrowUp, CheckCircle2, LogIn, ShieldCheck, XCircle } from "lucide-react";

export { SystemTab } from "@/components/settings-system-tab";

export function DashboardTab() {
  const { settings, update } = useSettings();
  const d = settings.dashboard;
  const widgets = [...d.widgets].sort((a, b) => a.order - b.order);
  const setWidgets = (w: typeof d.widgets) => update({ dashboard: { ...d, widgets: w } });
  const move = (id: string, dir: -1 | 1) => {
    const arr = widgets.map((x) => ({ ...x }));
    const i = arr.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setWidgets(arr.map((x, idx) => ({ ...x, order: idx })));
  };
  return (
    <Section title="Bo cuc Dashboard" desc="An/hien va sap xep widget.">
      <ul className="space-y-1">
        {widgets.map((w, idx) => {
          const meta = DASHBOARD_WIDGETS.find((x) => x.id === w.id);
          return (
            <li key={w.id} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(w.id, -1)} disabled={idx === 0} className="text-text-muted disabled:opacity-30" aria-label="Up"><ArrowUp className="size-3" /></button>
                <button type="button" onClick={() => move(w.id, 1)} disabled={idx === widgets.length - 1} className="text-text-muted disabled:opacity-30" aria-label="Down"><ArrowDown className="size-3" /></button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-text-primary">{meta?.label ?? w.id}</div>
                <div className="text-[10.5px] text-text-muted">{meta?.hint}</div>
              </div>
              <Switch on={w.visible} onChange={(v) => setWidgets(widgets.map((x) => (x.id === w.id ? { ...x, visible: v } : x)))} label={`Hien ${meta?.label}`} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function NotificationsTab() {
  const { settings, update } = useSettings();
  const n = settings.notifications;
  return (
    <Section title="Thong bao" desc="Luu persistent — ap dung chuong header, monitor alert va webhook.">
      <Row label="Tin thi truong moi" hint="Badge chuong khi co tin <30 phut">
        <Switch on={n.marketNews} onChange={(v) => update({ notifications: { ...n, marketNews: v } })} label="Tin thi truong" />
      </Row>
      <Row label="Canh bao gia (alerts)" hint="Bat monitor poll gia + push + webhook">
        <Switch on={n.priceAlerts} onChange={(v) => update({ notifications: { ...n, priceAlerts: v } })} label="Canh bao gia" />
      </Row>
      <Row label="Ban tin moi san sang" hint="Nhac mo /reports khi den gio brief">
        <Switch on={n.reportReady} onChange={(v) => update({ notifications: { ...n, reportReady: v } })} label="Ban tin" />
      </Row>
      <Row label="Digest buoi sang" hint="Goi y tom tat dau phien 7:00-10:00 VN">
        <Switch on={n.digestMorning} onChange={(v) => update({ notifications: { ...n, digestMorning: v } })} label="Digest" />
      </Row>
    </Section>
  );
}

export function DataRealtimeTab() {
  const { settings, update } = useSettings();
  const r = settings.realtime;
  const { data } = useApi<{ providers: ProviderStatus[] }>("/api/v1/system/providers", { refreshInterval: 10_000 });
  return (
    <>
      <Section title="Provider" desc="Tu Data Engine.">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border-subtle text-left text-[10px] uppercase text-text-muted">
              <th className="pb-1.5">Provider</th>
              <th className="pb-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.providers ?? []).map((p) => (
              <tr key={p.provider} className="border-b border-border-subtle/50">
                <td className="py-1.5">{p.provider}</td>
                <td className="py-1.5"><Badge tone={p.status === "healthy" ? "up" : "neutral"}>{p.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Realtime" desc="Polling.">
        <Row label="Live updates"><Switch on={r.liveUpdates} onChange={(v) => update({ realtime: { ...r, liveUpdates: v } })} label="Live" /></Row>
        <Row label="Low Data Mode"><Switch on={r.lowDataMode} onChange={(v) => update({ realtime: { ...r, lowDataMode: v } })} label="Low data" /></Row>
      </Section>
    </>
  );
}

export function AiTab() {
  const { settings, update } = useSettings();
  const a = settings.ai;
  return (
    <Section title="AI" desc="ORCA Agent.">
      <Row label="Do sau">
        <Seg value={a.depth} onChange={(v) => update({ ai: { ...a, depth: v } })}
          options={[{ value: "concise", label: "Ngan" }, { value: "standard", label: "Chuan" }, { value: "deep", label: "Sau" }]} />
      </Row>
    </Section>
  );
}

export function SecurityTab() {
  const { data: me } = useApi<{ user: { email: string } }>("/api/v1/auth/me");
  if (!me?.user) {
    return (
      <Section title="Bao mat" desc="Dang nhap de quan ly.">
        <a href="/login" className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white">Dang nhap</a>
      </Section>
    );
  }
  return (
    <Section title="Bao mat" desc="Da dang nhap.">
      <p className="text-[12px] text-text-secondary">{me.user.email}</p>
    </Section>
  );
}
