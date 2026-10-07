"use client";

import { useApi } from "@/lib/hooks";
import { Badge, Panel } from "@/components/ui";
import { Section } from "@/components/settings-panels-extra";
import { AlertTriangle, Database, Server } from "lucide-react";

export function SystemTab() {
  const { data, isLoading } = useApi<Record<string, unknown>>("/api/v1/system/info", {
    refreshInterval: 15_000,
  });
  if (isLoading && !data) {
    return (
      <Panel>
        <p className="text-[12px] text-text-muted">Dang tai thong tin he thong...</p>
      </Panel>
    );
  }
  const features = (data?.features ?? {}) as Record<string, boolean>;
  return (
    <Section title="He thong" desc="Trang thai runtime server — khong lo secret.">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-surface-elevated p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-muted">
            <Server className="size-3.5" /> Runtime
          </div>
          <pre className="overflow-x-auto text-[11px] text-text-secondary">
            {JSON.stringify(data?.runtime ?? data?.app ?? {}, null, 2)}
          </pre>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-elevated p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-muted">
            <Database className="size-3.5" /> Database / Redis
          </div>
          <pre className="overflow-x-auto text-[11px] text-text-secondary">
            {JSON.stringify({ database: data?.database, redis: data?.redis }, null, 2)}
          </pre>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(features).map(([k, v]) => (
          <Badge key={k} tone={v ? "up" : "neutral"}>
            {k}: {v ? "on" : "off"}
          </Badge>
        ))}
      </div>
      {features.llmConfigured === false ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-[12px] text-text-secondary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            LLM chua cau hinh — set OPENROUTER_API_KEY tren Vercel roi redeploy.
          </span>
        </div>
      ) : null}
    </Section>
  );
}
