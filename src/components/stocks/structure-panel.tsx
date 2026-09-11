"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { StructureAnalysis } from "@/lib/engines/wyckoff-elliott";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { GitBranch, Layers } from "lucide-react";

type Data = StructureAnalysis & { symbol: string };

function biasTone(b: string): "up" | "down" | "neutral" {
  if (b === "bullish") return "up";
  if (b === "bearish") return "down";
  return "neutral";
}

export const StockStructurePanel = memo(function StockStructurePanel({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<Data>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/structure` : null,
    { refreshInterval: 120_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Wyckoff · Elliott">
        <Loading rows={3} />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Wyckoff · Elliott">
        <p className="text-[12px] text-text-muted">Chưa đủ chuỗi giá để đọc cấu trúc.</p>
      </Panel>
    );
  }

  const { wyckoff: w, elliott: e } = data;

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Layers className="size-4 text-accent-primary" /> Wyckoff · Elliott
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-text-secondary">{data.summary}</p>

        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Wyckoff</span>
              <Badge tone={biasTone(w.bias)}>{w.confidence}%</Badge>
            </div>
            <div className="text-[13px] font-medium text-text-primary">{w.phaseVi}</div>
            <div className="mt-1 text-[11px] text-text-muted">
              Volume: {w.volumeTrend}
              {w.range && (
                <span className="num">
                  {" "}
                  · range {w.range.low.toLocaleString()} – {w.range.high.toLocaleString()}
                </span>
              )}
            </div>
            {w.events.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {w.events.map((ev, i) => (
                  <li key={i} className="text-[11px] text-text-secondary">
                    ▸ {ev}
                  </li>
                ))}
              </ul>
            )}
            {w.notes.map((n, i) => (
              <p key={i} className="mt-1 text-[10.5px] text-text-muted">
                {n}
              </p>
            ))}
          </div>

          <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <GitBranch className="size-3" /> Elliott
              </span>
              <Badge tone={biasTone(e.bias)}>{e.confidence}%</Badge>
            </div>
            <div className="text-[13px] font-medium text-text-primary">{e.patternVi}</div>
            <div className="mt-1 text-[11px] text-text-muted">Degree: {e.degree}</div>
            {e.waves.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {e.waves.map((wv, i) => (
                  <span
                    key={i}
                    className="num rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-text-secondary"
                  >
                    {wv.label}:{wv.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1.5 grid grid-cols-2 gap-1 text-[10.5px]">
              <div>
                <span className="text-text-muted">Invalidation </span>
                <span className="num text-text-secondary">
                  {e.invalidation != null
                    ? e.invalidation.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Target </span>
                <span className="num text-text-secondary">
                  {e.nextTarget != null
                    ? e.nextTarget.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : "—"}
                </span>
              </div>
            </div>
            {e.notes.map((n, i) => (
              <p key={i} className="mt-1 text-[10.5px] text-text-muted">
                {n}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
});
