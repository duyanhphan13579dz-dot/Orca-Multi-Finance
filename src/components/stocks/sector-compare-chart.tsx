"use client";

import { memo, useMemo } from "react";

export type SectorColLite = {
  name: string;
  avgPct: number | null;
  imbalance: number | null;
  buyVol: number;
  sellVol: number;
};

function pctLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p > 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

/** Compact sector % bars — secondary to bang-dien board. */
export const SectorCompareChart = memo(function SectorCompareChart({
  cols,
}: {
  cols: SectorColLite[];
}) {
  const ranked = useMemo(() => {
    return [...cols]
      .filter((c) => c.avgPct != null && Number.isFinite(c.avgPct))
      .sort((a, b) => (b.avgPct ?? 0) - (a.avgPct ?? 0))
      .slice(0, 12);
  }, [cols]);

  if (ranked.length < 2) return null;

  const maxAbs = Math.max(0.35, ...ranked.map((c) => Math.abs(c.avgPct ?? 0)));

  return (
    <div className="rounded-lg border border-border-subtle/80 bg-surface-elevated/30 px-2.5 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            So sánh ngành
          </span>
          <span className="text-[10px] text-text-muted/75">% TB phiên</span>
        </div>
        <div className="flex items-center gap-2.5 text-[9px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-2.5 rounded-sm bg-up/80" /> Tăng
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-2.5 rounded-sm bg-down/80" /> Giảm
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1 w-2.5 rounded-sm bg-amber-400/70" /> Imb
          </span>
        </div>
      </div>

      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {ranked.map((c) => {
          const pct = c.avgPct ?? 0;
          const up = pct >= 0;
          const width = Math.min(100, (Math.abs(pct) / maxAbs) * 100);
          const imb = c.imbalance;
          const imbWidth =
            imb != null && Number.isFinite(imb) ? Math.min(100, Math.abs(imb) * 100) : 0;
          const imbUp = (imb ?? 0) >= 0;
          return (
            <div
              key={c.name}
              className="grid grid-cols-[5.5rem_1fr_2.75rem] items-center gap-1.5 sm:grid-cols-[6.25rem_1fr_2.9rem]"
            >
              <span className="truncate text-[11px] text-text-secondary" title={c.name}>
                {c.name}
              </span>
              <div className="relative h-3 overflow-hidden rounded-sm bg-surface-base/70">
                <div
                  className={`absolute inset-y-0 left-0 rounded-sm ${
                    up ? "bg-up/65" : "bg-down/65"
                  }`}
                  style={{ width: `${width}%` }}
                />
                {imb != null ? (
                  <div
                    className={`absolute bottom-0 left-0 h-0.5 rounded-sm ${
                      imbUp ? "bg-amber-300/85" : "bg-amber-500/65"
                    }`}
                    style={{ width: `${imbWidth}%` }}
                    title={`Imbalance ${imb > 0 ? "+" : ""}${(imb * 100).toFixed(0)}%`}
                  />
                ) : null}
              </div>
              <span
                className={`num text-right text-[11px] font-semibold tabular-nums ${
                  up ? "text-up" : "text-down"
                }`}
              >
                {pctLabel(c.avgPct)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
