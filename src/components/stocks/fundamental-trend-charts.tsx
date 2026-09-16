"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui";

export type IncomePoint = {
  period: string;
  revenue: number | null;
  netIncome: number | null;
  grossProfit?: number | null;
  grossMargin?: number | null;
  netMargin?: number | null;
  roe?: number | null;
};

export type RoePoint = {
  period: string;
  roe: number | null;
  roa: number | null;
};

export type CashPoint = {
  period: string;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  investingCashFlow?: number | null;
  financingCashFlow?: number | null;
  capex?: number | null;
};

function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${abs.toLocaleString("vi-VN", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function isQuarter(period: string): boolean {
  return /-Q[1-4]$/i.test(period) || /Q[1-4]$/i.test(period);
}

function isYear(period: string): boolean {
  return /^\d{4}$/.test(period.trim());
}

function sortPeriods(a: string, b: string): number {
  const parse = (p: string) => {
    const y = Number(p.slice(0, 4));
    const qm = p.match(/Q([1-4])/i);
    const q = qm ? Number(qm[1]) : isYear(p) ? 5 : 0;
    return y * 10 + q;
  };
  return parse(a) - parse(b);
}

type Grain = "quarter" | "year" | "all";

function filterByGrain<T extends { period: string }>(rows: T[], grain: Grain): T[] {
  const sorted = [...rows].sort((a, b) => sortPeriods(a.period, b.period));
  if (grain === "quarter") {
    const q = sorted.filter((r) => isQuarter(r.period));
    return q.length >= 2 ? q : sorted;
  }
  if (grain === "year") {
    const y = sorted.filter((r) => isYear(r.period));
    return y.length >= 1 ? y : sorted;
  }
  const quarters = sorted.filter((r) => isQuarter(r.period));
  if (quarters.length >= 4) return quarters;
  return sorted;
}

/** Độ rộng mỗi nhóm kỳ (px) — sát nhau, không trải full màn */
function periodColWidth(seriesCount: number, periodCount: number): number {
  const bar = seriesCount >= 3 ? 10 : 12;
  const gap = 2;
  const inner = seriesCount * bar + (seriesCount - 1) * gap + 8;
  // Khi nhiều kỳ vẫn giữ compact; khi ít kỳ không phình ra
  const base = Math.max(inner, 36);
  if (periodCount <= 4) return Math.max(base, 44);
  if (periodCount <= 8) return Math.max(base, 40);
  return base;
}

function GroupedBarChart({
  points,
  series,
  format = "money",
  chartHeight = 260,
}: {
  points: { period: string; values: (number | null)[] }[];
  series: { label: string; color: string }[];
  format?: "money" | "pct";
  chartHeight?: number;
}) {
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const p of points) {
      for (const v of p.values) {
        if (v != null && Number.isFinite(v)) m = Math.max(m, Math.abs(v));
      }
    }
    return m > 0 ? m : 1;
  }, [points]);

  if (!points.length) {
    return (
      <p className="py-8 text-center text-[12px] text-text-muted">
        Chưa đủ chuỗi kỳ BCTC để vẽ biểu đồ.
      </p>
    );
  }

  const fmt = (v: number | null) => (format === "pct" ? pct(v) : fmtCompact(v));
  const half = chartHeight / 2;
  const colW = periodColWidth(series.length, points.length);
  const barW = series.length >= 3 ? 10 : 12;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative overflow-x-auto pb-1">
        <div className="inline-flex min-w-full flex-col">
          <div className="flex items-start gap-0">
            {/* Trục Y */}
            <div
              className="sticky left-0 z-[1] flex w-11 shrink-0 flex-col justify-between bg-surface-elevated/80 pr-1 text-right text-[10px] text-text-muted/80 backdrop-blur-sm"
              style={{ height: chartHeight }}
            >
              <span>{format === "pct" ? pct(maxAbs) : fmtCompact(maxAbs)}</span>
              <span>0</span>
              <span>{format === "pct" ? pct(-maxAbs) : fmtCompact(-maxAbs)}</span>
            </div>

            {/* Cụm cột — sát nhau */}
            <div className="flex items-stretch" style={{ height: chartHeight }}>
              {points.map((p) => (
                <div
                  key={p.period}
                  className="group relative flex shrink-0 flex-col items-center"
                  style={{ width: colW }}
                  title={p.period}
                >
                  <div className="relative flex h-full w-full items-end justify-center gap-[2px]">
                    <div
                      className="pointer-events-none absolute inset-x-0 border-t border-border-subtle/50"
                      style={{ top: half }}
                    />
                    {p.values.map((v, vi) => {
                      if (v == null || !Number.isFinite(v)) {
                        return (
                          <div
                            key={vi}
                            className="opacity-15"
                            style={{ width: barW, height: 2, marginTop: half }}
                          />
                        );
                      }
                      const hPx = Math.max((Math.abs(v) / maxAbs) * (half - 4), 3);
                      const positive = v >= 0;
                      return (
                        <div
                          key={vi}
                          className="relative flex flex-col items-center"
                          style={{
                            width: barW,
                            height: chartHeight,
                            justifyContent: positive ? "flex-end" : "flex-start",
                            paddingBottom: positive ? half : undefined,
                            paddingTop: positive ? undefined : half,
                          }}
                        >
                          <div
                            className="w-full transition-opacity"
                            style={{
                              height: hPx,
                              background: series[vi]?.color ?? "#64748b",
                              borderRadius: positive ? "2px 2px 1px 1px" : "1px 1px 2px 2px",
                              opacity: 0.95,
                            }}
                            title={`${p.period} · ${series[vi]?.label}: ${fmt(v)}`}
                          />
                          <span
                            className={`pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-text-primary shadow-md group-hover:block ${
                              positive ? "bottom-[calc(50%+6px)]" : "top-[calc(50%+6px)]"
                            }`}
                          >
                            {fmt(v)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Nhãn kỳ sát dưới từng cột */}
          <div className="mt-1 flex">
            <div className="w-11 shrink-0" />
            <div className="flex">
              {points.map((p) => (
                <div
                  key={p.period}
                  className="shrink-0 truncate text-center text-[10px] font-medium text-text-muted"
                  style={{ width: colW }}
                  title={p.period}
                >
                  {p.period.replace(/^20/, "'")}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle/60">
        <table className="w-full min-w-[320px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-border-subtle text-[10px] uppercase tracking-wide text-text-muted">
              <th className="px-2 py-1.5 font-medium">Kỳ</th>
              {series.map((s) => (
                <th key={s.label} className="px-2 py-1.5 font-medium">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.period} className="border-b border-border-subtle/40 last:border-0">
                <td className="px-2 py-1 font-medium text-text-primary">{p.period}</td>
                {p.values.map((v, i) => (
                  <td key={i} className="num px-2 py-1 text-text-secondary">
                    {fmt(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinePctChart({
  points,
  series,
  chartHeight = 240,
}: {
  points: { period: string; values: (number | null)[] }[];
  series: { label: string; color: string }[];
  chartHeight?: number;
}) {
  const { min, max } = useMemo(() => {
    let lo = 0;
    let hi = 0.05;
    for (const p of points) {
      for (const v of p.values) {
        if (v != null && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (lo === hi) hi = lo + 0.05;
    const pad = (hi - lo) * 0.12;
    return { min: lo - pad, max: hi + pad };
  }, [points]);

  if (!points.length) {
    return (
      <p className="py-8 text-center text-[12px] text-text-muted">Chưa đủ dữ liệu tỷ lệ.</p>
    );
  }

  const n = points.length;
  // Nén trục X: điểm sát nhau hơn (padding 2% mỗi bên thay vì trải đều quá rộng khi ít điểm)
  const padX = n <= 3 ? 18 : n <= 6 ? 10 : 6;
  const w = 100;
  const h = 100;
  const plotW = w - padX * 2;
  const yScale = (v: number) => h - ((v - min) / (max - min)) * (h - 8) - 4;
  const xScale = (i: number) => (n <= 1 ? w / 2 : padX + (i / (n - 1)) * plotW);

  // Chiều rộng vùng plot theo số kỳ — không full width khi ít điểm
  const plotPx = Math.min(100, Math.max(28, n * 42));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full" style={{ minWidth: `${Math.max(plotPx, n * 40)}px` }}>
          <div className="relative flex" style={{ height: chartHeight }}>
            <div className="flex w-11 shrink-0 flex-col justify-between text-right text-[10px] text-text-muted/80">
              <span>{pct(max)}</span>
              <span>{pct(0)}</span>
              <span>{pct(min)}</span>
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} className="h-full flex-1" preserveAspectRatio="none">
              <line
                x1={0}
                x2={w}
                y1={yScale(0)}
                y2={yScale(0)}
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
              {series.map((s, si) => {
                const segs: string[] = [];
                points.forEach((p, i) => {
                  const v = p.values[si];
                  if (v == null || !Number.isFinite(v)) return;
                  segs.push(`${xScale(i).toFixed(2)},${yScale(v).toFixed(2)}`);
                });
                if (segs.length < 2) return null;
                return (
                  <polyline
                    key={s.label}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={segs.join(" ")}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {series.map((s, si) =>
                points.map((p, i) => {
                  const v = p.values[si];
                  if (v == null || !Number.isFinite(v)) return null;
                  return (
                    <circle
                      key={`${si}-${i}`}
                      cx={xScale(i)}
                      cy={yScale(v)}
                      r={2.2}
                      fill={s.color}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        {p.period} · {s.label}: {pct(v)}
                      </title>
                    </circle>
                  );
                }),
              )}
            </svg>
          </div>
          <div className="ml-11 flex">
            {points.map((p) => (
              <span
                key={p.period}
                className="shrink-0 truncate text-center text-[10px] font-medium text-text-muted"
                style={{ width: `${100 / n}%`, minWidth: 36 }}
                title={p.period}
              >
                {p.period.replace(/^20/, "'")}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle/60">
        <table className="w-full min-w-[280px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-border-subtle text-[10px] uppercase text-text-muted">
              <th className="px-2 py-1.5 font-medium">Kỳ</th>
              {series.map((s) => (
                <th key={s.label} className="px-2 py-1.5 font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.period} className="border-b border-border-subtle/40 last:border-0">
                <td className="px-2 py-1 font-medium text-text-primary">{p.period}</td>
                {p.values.map((v, i) => (
                  <td key={i} className="num px-2 py-1 text-text-secondary">
                    {pct(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ChartTab = "income" | "margins" | "returns" | "cashflow";

export function FundamentalTrendCharts({
  income,
  roe,
  cashflow,
}: {
  income: IncomePoint[];
  roe: RoePoint[];
  cashflow: CashPoint[];
}) {
  const [tab, setTab] = useState<ChartTab>("income");
  const [grain, setGrain] = useState<Grain>("quarter");

  const incomeF = useMemo(() => filterByGrain(income, grain), [income, grain]);
  const roeF = useMemo(() => filterByGrain(roe, grain), [roe, grain]);
  const cfF = useMemo(() => filterByGrain(cashflow, grain), [cashflow, grain]);

  const incomeBars = useMemo(
    () =>
      incomeF.map((p) => ({
        period: p.period,
        values: [p.revenue, p.netIncome] as (number | null)[],
      })),
    [incomeF],
  );

  const marginLines = useMemo(
    () =>
      incomeF.map((p) => ({
        period: p.period,
        values: [p.grossMargin ?? null, p.netMargin ?? null] as (number | null)[],
      })),
    [incomeF],
  );

  const returnLines = useMemo(
    () =>
      roeF.map((p) => ({
        period: p.period,
        values: [p.roe, p.roa] as (number | null)[],
      })),
    [roeF],
  );

  const cfBars = useMemo(
    () =>
      cfF.map((p) => ({
        period: p.period,
        values: [p.operatingCashFlow, p.freeCashFlow, p.investingCashFlow ?? null] as (
          | number
          | null
        )[],
      })),
    [cfF],
  );

  const tabs: { key: ChartTab; label: string }[] = [
    { key: "income", label: "DT & LN" },
    { key: "margins", label: "Biên LN" },
    { key: "returns", label: "ROE / ROA" },
    { key: "cashflow", label: "Dòng tiền" },
  ];

  const grains: { key: Grain; label: string }[] = [
    { key: "quarter", label: "Theo quý" },
    { key: "year", label: "Theo năm" },
    { key: "all", label: "Tất cả" },
  ];

  const hasAny = income.length > 0 || roe.length > 0 || cashflow.length > 0;
  if (!hasAny) return null;

  return (
    <Panel
      title="Xu hướng BCTC"
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-border-subtle p-0.5">
            {grains.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGrain(g.key)}
                className={`rounded px-2 py-0.5 text-[10px] sm:text-[11px] ${
                  grain === g.key
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-md border px-2 py-0.5 text-[11px] ${
                  tab === t.key
                    ? "border-accent-primary/50 bg-accent-primary/15 text-accent-primary"
                    : "border-border-subtle text-text-muted hover:text-text-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {tab === "income" && (
        <GroupedBarChart
          points={incomeBars}
          series={[
            { label: "Doanh thu thuần", color: "#38bdf8" },
            { label: "LN sau thuế", color: "#a78bfa" },
          ]}
          format="money"
          chartHeight={280}
        />
      )}
      {tab === "margins" && (
        <LinePctChart
          points={marginLines}
          series={[
            { label: "Biên gộp", color: "#34d399" },
            { label: "Biên ròng", color: "#f472b6" },
          ]}
          chartHeight={260}
        />
      )}
      {tab === "returns" && (
        <LinePctChart
          points={returnLines}
          series={[
            { label: "ROE", color: "#fbbf24" },
            { label: "ROA", color: "#60a5fa" },
          ]}
          chartHeight={260}
        />
      )}
      {tab === "cashflow" && (
        <GroupedBarChart
          points={cfBars}
          series={[
            { label: "CFO", color: "#2dd4bf" },
            { label: "FCF", color: "#fb923c" },
            { label: "CFI", color: "#94a3b8" },
          ]}
          format="money"
          chartHeight={280}
        />
      )}
    </Panel>
  );
}
