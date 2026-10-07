"use client";

import { Badge } from "@/components/ui";
import type { AgentDomain } from "@/lib/services/agent-router";

const LABELS: Record<Exclude<AgentDomain, "general">, string> = {
  market: "Thị trường",
  industry: "Ngành",
  stock: "Cổ phiếu",
  commodity: "Hàng hóa",
};

export function AgentDomainHeader({ domain, title, entity, updatedAt }: { domain: Exclude<AgentDomain, "general">; title?: string; entity?: string; updatedAt?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2">
      <Badge tone="accent">{(title ?? LABELS[domain]).toUpperCase()}</Badge>
      {entity ? <span className="text-[11px] text-ink-2">{entity}</span> : null}
      {updatedAt ? <span className="text-[10px] text-ink-3">Cập nhật {new Date(updatedAt).toLocaleString("vi-VN")}</span> : null}
    </div>
  );
}
