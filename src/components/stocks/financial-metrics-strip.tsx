"use client";

import { Badge, Panel } from "@/components/ui";
import type { RatioEngineResult } from "@/lib/financial/ratio-engine";

/** Compact per-symbol financial indicators from multi-source ratio-engine. */
export function FinancialMetricsStrip({
  ratios,
  ratioMap,
  sources,
  qualityScore,
}: {
  ratios?: RatioEngineResult | null;
  ratioMap?: Record<string, number | null> | null;
  sources?: { quote?: string[]; financials?: string | null } | null;
  qualityScore?: number | null;
}) {
  const map = ratioMap ?? {};
  const cells: { key: string; label: string; format: "x" | "pct" | "num" }[] = [
    { key: "pe", label: "P/E", format: "x" },
    { key: "pb", label: "P/B", format: "x" },
    { key: "roe", label: "ROE", format: "pct" },
    { key: "roa", label: "ROA", format: "pct" },
    { key: "debtEquity", label: "Nợ/VCSH", format: "x" },
    { key: "currentRatio", label: "Current", format: "x" },
    { key: "netMargin", label: "Biên LN", format: "pct" },
    { key: "evEbitda", label: "EV/EBITDA", format: "x" },
  ];

  const hasAny =
    cells.some((c) => map[c.key] != null) ||
    (ratios?.flat?.some((r) => r.value != null) ?? false);
  if (!hasAny) {
    return (
      <Panel title="Chỉ số tài chính" right={<Badge tone="neutral">Chưa đủ BCTC</Badge>}>
        <p className="text-[11px] text-text-muted">
          Đang chờ báo cáo tài chính / giá multi-source để tính chỉ số định giá.
        </p>
      </Panel>
    );
  }

  function fmt(key: string, format: "x" | "pct" | "num"): string {
    const v = map[key];
    if (v == null || !Number.isFinite(v)) {
      const fromFlat = ratios?.flat.find((r) => r.key === key)?.value;
      if (fromFlat == null || !Number.isFinite(fromFlat)) return "—";
      return formatVal(fromFlat, format);
    }
    return formatVal(v, format);
  }

  const srcLabel = [...(sources?.quote ?? []), sources?.financials].filter(Boolean).join(" · ");

  return (
    <Panel
      title="Chỉ số tài chính (đa nguồn)"
      right={
        <span className="flex items-center gap-1.5">
          {qualityScore != null && (
            <Badge tone={qualityScore >= 60 ? "up" : qualityScore >= 35 ? "neutral" : "down"}>
              Fill {qualityScore}%
            </Badge>
          )}
          {srcLabel && <span className="text-[9px] text-text-muted">{srcLabel}</span>}
        </span>
      }
    >
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {cells.map((c) => (
          <div
            key={c.key}
            className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1.5 text-center"
          >
            <div className="text-[8.5px] uppercase tracking-wider text-text-muted">{c.label}</div>
            <div className="num mt-0.5 text-[12px] font-semibold text-text-primary">{fmt(c.key, c.format)}</div>
          </div>
        ))}
      </div>
      {ratios?.period && (
        <p className="mt-1.5 text-[9.5px] text-text-muted">Kỳ BCTC: {ratios.period}</p>
      )}
    </Panel>
  );
}

function formatVal(v: number, format: "x" | "pct" | "num"): string {
  if (format === "pct") return `${(v * 100).toFixed(Math.abs(v) >= 0.1 ? 1 : 2)}%`;
  if (format === "x") return `${v.toFixed(v >= 10 ? 1 : 2)}x`;
  return v.toFixed(2);
}
