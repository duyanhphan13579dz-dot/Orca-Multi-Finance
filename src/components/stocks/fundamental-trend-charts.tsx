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
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${abs.toLocaleString("vi-VN", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Bar chart ngang theo kỳ — tiền (VND) */
function MoneyBars({
  points,
  keys,
  colors,
  labels,
  height = 180,
}: {
  points: { period: string; values: (number | null)[] }[];
  keys: string[];
  colors: string[];
  labels: string[];
  height?: number;
}) {
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const p of points) {
      for (const v of p.values) {
        if (v != null && Number.isFinite(v)) m = Math.max(m, Math.abs(v));
      }
    }
    return m || 1;
  }, [points]);

  if (!points.length) {
    return <p className="text-[12px] text-text-muted">Chưa đủ chuỗi kỳ BCTC để vẽ biểu đồ.</p>;
  }

  const n = points.length;
  const groupW = 100 / n;
  const barW = groupW / (keys.length + 0.6);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
        {labels.map((lb, i) => (
          <span key={lb} className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: colors[i] }} />
            {lb}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }}>
        {/* zero line */}
        <line
          x1={0}
          x2={100}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={0.3}
        />
        {points.map((p, pi) =>
          p.values.map((v, vi) => {
            if (v == null || !Number.isFinite(v)) return null;
            const h = (Math.abs(v) / maxAbs) * (height / 2 - 8);
            const x = pi * groupW + (vi + 0.3) * barW;
            const y = v >= 0 ? height / 2 - h : height / 2;
            return (
              <rect
                key={`${pi}-${vi}`}
                x={x}
                y={y}
                width={Math.max(barW * 0.85, 0.8)}
                height={Math.max(h, 0.4)}
                fill={colors[vi]}
                opacity={0.9}
                rx={0.4}
              >
                <title>
                  {p.period} · {labels[vi]}: {fmtCompact(v)}
                </title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="flex justify-between gap-1 overflow-x-auto text-[9px] text-text-muted">
        {points.map((p) => (
          <span key={p.period} className="min-w-0 flex-1 truncate text-center">
            {p.period}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Line chart cho tỷ lệ % */
function PctLines({
  points,
  series,
  height = 160,
}: {
  points: { period: string; values: (number | null)[] }[];
  series: { label: string; color: string }[];
  height?: number;
}) {
  const { min, max } = useMemo(() => {
    let lo = 0;
    let hi = 0.01;
    for (const p of points) {
      for (const v of p.values) {
        if (v != null && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (lo === hi) hi = lo + 0.01;
    const pad = (hi - lo) * 0.1;
    return { min: lo - pad, max: hi + pad };
  }, [points]);

  if (!points.length) {
    return <p className="text-[12px] text-text-muted">Chưa đủ dữ liệu tỷ lệ.</p>;
  }

  const w = 100;
  const h = height;
  const yScale = (v: number) => h - ((v - min) / (max - min)) * (h - 12) - 6;
  const xScale = (i: number) => (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * (w - 4) + 2);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
        <line
          x1={0}
          x2={w}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={0.3}
        />
        {series.map((s, si) => {
          const pts = points
            .map((p, i) => {
              const v = p.values[si];
              if (v == null || !Number.isFinite(v)) return null;
              return `${xScale(i).toFixed(2)},${yScale(v).toFixed(2)}`;
            })
            .filter(Boolean);
          if (pts.length < 2) return null;
          return (
            <polyline
              key={s.label}
              fill="none"
              stroke={s.color}
              strokeWidth={1.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={pts.join(" ")}
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
                r={1.2}
                fill={s.color}
              >
                <title>
                  {p.period} · {s.label}: {pct(v)}
                </title>
              </circle>
            );
          }),
        )}
      </svg>
      <div className="flex justify-between gap-1 text-[9px] text-text-muted">
        {points.map((p) => (
          <span key={p.period} className="min-w-0 flex-1 truncate text-center">
            {p.period}
          </span>
        ))}
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

  const incomeBars = useMemo(
    () =>
      income.map((p) => ({
        period: p.period,
        values: [p.revenue, p.netIncome] as (number | null)[],
      })),
    [income],
  );

  const marginLines = useMemo(
    () =>
      income.map((p) => ({
        period: p.period,
        values: [p.grossMargin ?? null, p.netMargin ?? null] as (number | null)[],
      })),
    [income],
  );

  const returnLines = useMemo(
    () =>
      roe.map((p) => ({
        period: p.period,
        values: [p.roe, p.roa] as (number | null)[],
      })),
    [roe],
  );

  const cfBars = useMemo(
    () =>
      cashflow.map((p) => ({
        period: p.period,
        values: [p.operatingCashFlow, p.freeCashFlow] as (number | null)[],
      })),
    [cashflow],
  );

  const tabs: { key: ChartTab; label: string }[] = [
    { key: "income", label: "DT & LN" },
    { key: "margins", label: "Biên LN" },
    { key: "returns", label: "ROE / ROA" },
    { key: "cashflow", label: "Dòng tiền" },
  ];

  const hasAny = income.length > 0 || roe.length > 0 || cashflow.length > 0;
  if (!hasAny) return null;

  return (
    <Panel
      title="Xu hướng BCTC"
      right={
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
      }
    >
      {tab === "income" && (
        <MoneyBars
          points={incomeBars}
          keys={["rev", "ni"]}
          labels={["Doanh thu thuần", "LN sau thuế"]}
          colors={["#38bdf8", "#a78bfa"]}
        />
      )}
      {tab === "margins" && (
        <PctLines
          points={marginLines}
          series={[
            { label: "Biên gộp", color: "#34d399" },
            { label: "Biên ròng", color: "#f472b6" },
          ]}
        />
      )}
      {tab === "returns" && (
        <PctLines
          points={returnLines}
          series={[
            { label: "ROE", color: "#fbbf24" },
            { label: "ROA", color: "#60a5fa" },
          ]}
        />
      )}
      {tab === "cashflow" && (
        <MoneyBars
          points={cfBars}
          keys={["ocf", "fcf"]}
          labels={["CFO", "FCF"]}
          colors={["#2dd4bf", "#fb923c"]}
        />
      )}
      <p className="mt-2 text-[10px] text-text-muted">
        Chuỗi theo kỳ BCTC (mới → cũ đã đảo). Hover cột/điểm để xem giá trị.
      </p>
    </Panel>
  );
}
