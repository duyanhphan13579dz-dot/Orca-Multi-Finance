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

/** Horizontal bar chart: sector avg % ranked, imbalance as secondary bar. */
export const SectorCompareChart = memo(function SectorCompareChart({
  cols,
}: {
  cols: SectorColLite[];
}) {
  const ranked = useMemo(() => {
    return [...cols]
      .filter((c) => c.avgPct != null && Number.isFinite(c.avgPct))
      .sort((a, b) => (b.avgPct ?? 0) - (a.avgPct ?? 0));
  }, [cols]);

  if (ranked.length < 2) return null;

  const maxAbs = Math.max(0.5, ...ranked.map((c) => Math.abs(c.avgPct ?? 0)));

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated/50 px-3 py-3 shadow-sm">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            So sánh ngành
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted/90">
            % trung bình phiên · thanh phụ = order imbalance (proxy KL)
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-up/80" /> Tăng
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-down/80" /> Giảm
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-sm bg-amber-400/70" /> Imbalance
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
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
              className="group grid grid-cols-[7.5rem_1fr_3.25rem] items-center gap-2 sm:grid-cols-[9rem_1fr_3.5rem]"
            >
              <span className="truncate text-[12px] font-medium text-text-primary" title={c.name}>
                {c.name}
              </span>
              <div className="relative h-6 overflow-hidden rounded-md bg-surface-base/80">
                <div
                  className={`absolute inset-y-0 left-0 rounded-md transition-[width] duration-300 ${
                    up ? "bg-up/70" : "bg-down/70"
                  }`}
                  style={{ width: `${width}%` }}
                />
                {imb != null ? (
                  <div
                    className={`absolute bottom-0 left-0 h-1 rounded-sm ${
                      imbUp ? "bg-amber-300/90" : "bg-amber-500/70"
                    }`}
                    style={{ width: `${imbWidth}%` }}
                    title={`Imbalance ${imb > 0 ? "+" : ""}${(imb * 100).toFixed(0)}%`}
                  />
                ) : null}
              </div>
              <span
                className={`num text-right text-[12px] font-bold tabular-nums ${
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
