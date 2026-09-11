"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { StructureAnalysis } from "@/lib/services/stock-structure";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Layers, Waves } from "lucide-react";

export const StructurePanel = memo(function StructurePanel({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<StructureAnalysis>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/structure` : null,
    { refreshInterval: 180_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Cấu trúc giá">
        <Loading rows={3} />
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel title="Cấu trúc giá">
        <p className="text-[12px] text-text-muted">Chưa đủ dữ liệu cấu trúc.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Layers className="size-4 text-accent-primary" />
          Cấu trúc giá
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      <div className="space-y-3">
        {data.waves?.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
              <Waves className="size-3.5" /> Nhịp sóng ước lượng
            </div>
            <ul className="space-y-1.5">
              {data.waves.map((w, i) => (
                <li key={i} className="rounded-md border border-border-subtle bg-surface-elevated/40 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{w.label}</Badge>
                    {w.direction && (
                      <span className="text-[11px] text-text-muted">{w.direction}</span>
                    )}
                  </div>
                  {w.notes?.map((n, j) => (
                    <p key={j} className="mt-1 text-[11px] leading-snug text-text-secondary">
                      {n}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.events?.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-ink-2">Sự kiện cấu trúc</div>
            <ul className="space-y-1.5">
              {data.events.map((e, i) => (
                <li key={i} className="rounded-md border border-border-subtle px-2.5 py-2">
                  <div className="text-[12px] font-medium text-text-primary">{e.title}</div>
                  {e.notes?.map((n, j) => (
                    <p key={j} className="mt-0.5 text-[11px] text-text-muted">
                      {n}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!data.waves?.length && !data.events?.length && (
          <p className="text-[12px] text-text-muted">Chưa nhận diện được cấu trúc đáng chú ý.</p>
        )}
      </div>
    </Panel>
  );
});
