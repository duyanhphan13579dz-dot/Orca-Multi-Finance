"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Chg, fmtCompact, Loading, Panel, Unavailable } from "@/components/ui";
import { AiFinancialPanel } from "@/components/stocks/ai-financial-panel";

/* ───────────────── helpers ───────────────── */

const GROWTH_VI: Record<string, string> = {
  revenue: "Doanh thu",
  netRevenue: "Doanh thu thuần",
  grossProfit: "Lợi nhuận gộp",
  operatingProfit: "LN thuần từ HĐKD",
  netIncome: "Lợi nhuận sau thuế",
  operatingCashFlow: "LC tiền từ HĐKD",
  freeCashFlow: "Dòng tiền tự do (FCF)",
  totalAssets: "Tổng tài sản",
  equity: "Vốn chủ sở hữu",
  totalLiabilities: "Tổng nợ phải trả",
};

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function periodLabel(r: Record<string, unknown>): string {
  if (typeof r.period === "string" && r.period) return r.period;
  if (r.year != null && r.quarter != null) return `${r.year}-Q${r.quarter}`;
  if (r.year != null) return String(r.year);
  return "—";
}

function healthLabel(score: number | null | undefined): string {
  if (score == null) return "Chưa đủ dữ liệu";
  if (score >= 80) return "Xuất sắc";
  if (score >= 65) return "Mạnh";
  if (score >= 50) return "Ổn định";
  if (score >= 35) return "Yếu";
  return "Rủi ro cao";
}

function statusVi(s: string | undefined): string {
  switch (s) {
    case "VERIFIED":
      return "Đã xác thực";
    case "LATEST_AVAILABLE":
      return "Kỳ gần nhất hiện có";
    case "STALE":
      return "Bản lưu gần nhất";
    case "SOURCE_UNAVAILABLE":
      return "Nguồn không khả dụng";
    default:
      return s ?? "—";
  }
}

function div(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function ratiosFromSnapshot(detail: VnStockDetail) {
  const income = detail.financials.income?.[0] as Record<string, unknown> | undefined;
  const balance = detail.financials.balance?.[0] as Record<string, unknown> | undefined;
  const cashflow = detail.financials.cashflow?.[0] as Record<string, unknown> | undefined;

  const rev = n(income?.netRevenue) ?? n(income?.revenue);
  const gp = n(income?.grossProfit);
  const op = n(income?.operatingProfit) ?? n(income?.ebit);
  const ni = n(income?.netIncome) ?? n(income?.netProfit) ?? n(income?.netIncomeParent);
  const assets = n(balance?.totalAssets);
  const equity = n(balance?.equity);
  const ca = n(balance?.currentAssets);
  const cl = n(balance?.currentLiabilities);
  const cash = n(balance?.cash);
  const inv = n(balance?.inventory);
  const recv = n(balance?.receivables);
  const tl = n(balance?.totalLiabilities);
  const std = n(balance?.shortTermDebt);
  const ltd = n(balance?.longTermDebt);
  const debt = std != null || ltd != null ? (std ?? 0) + (ltd ?? 0) : null;
  const ocf = n(cashflow?.operatingCashFlow);
  const fcf = n(cashflow?.freeCashFlow);
  const interest = n(income?.interestExpense);

  return {
    grossMargin: div(gp, rev),
    operatingMargin: div(op, rev),
    netMargin: div(ni, rev),
    roe: div(ni, equity),
    roa: div(ni, assets),
    currentRatio: div(ca, cl),
    quickRatio: ca != null && cl != null ? (ca - (inv ?? 0)) / cl : null,
    cashRatio: div(cash, cl),
    debtToEquity: div(debt ?? tl, equity),
    debtToAssets: div(tl ?? debt, assets),
    interestCoverage: div(op, interest),
    ocfToNi: div(ocf, ni),
    fcfMargin: div(fcf, rev),
    assetTurnover: div(rev, assets),
    receivableDays: recv != null && rev ? (recv * 365) / rev : null,
    inventoryDays: inv != null && rev ? (inv * 365) / rev : null,
    cash,
    currentAssets: ca,
    longTermAssets: n(balance?.longTermAssets) ?? (assets != null && ca != null ? assets - ca : null),
    totalAssets: assets,
    currentLiabilities: cl,
    totalLiabilities: tl,
    equity,
    netRevenue: rev,
    grossProfit: gp,
    operatingProfit: op,
    netIncome: ni,
    operatingCashFlow: ocf,
    freeCashFlow: fcf,
  };
}

function seriesFrom(
  rows: Record<string, unknown>[] | null | undefined,
  keys: string[],
): { period: string; values: Record<string, number | null> }[] {
  if (!rows?.length) return [];
  return [...rows]
    .slice(0, 8)
    .map((r) => {
      const values: Record<string, number | null> = {};
      for (const k of keys) {
        for (const candidate of k.split("|")) {
          const v = n(r[candidate]);
          if (v != null) {
            values[k] = v;
            break;
          }
        }
        if (values[k] === undefined) values[k] = null;
      }
      return { period: periodLabel(r), values };
    })
    .reverse();
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtX(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(2)}x`;
}

function ScoreGauge({ score, label }: { score: number | null; label: string }) {
  const s = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = score == null ? 0 : (s / 100) * c;
  const color = score == null ? "#64748b" : score >= 65 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  return (
    <div className="flex flex-col items-center">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="10" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 55 55)"
        />
        <text x="55" y="52" textAnchor="middle" className="fill-ink-2" fontSize="22" fontWeight="600">
          {score != null ? Math.round(score) : "—"}
        </text>
        <text x="55" y="70" textAnchor="middle" className="fill-ink-3" fontSize="10">
          {label}
        </text>
      </svg>
    </div>
  );
}

function RadarScores({ scores }: { scores: { key: string; label: string; value: number | null }[] }) {
  const cx = 100;
  const cy = 100;
  const R = 70;
  const nPts = scores.length;
  if (nPts < 3) return null;
  const pt = (i: number, ratio: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / nPts;
    return [cx + R * ratio * Math.cos(ang), cy + R * ratio * Math.sin(ang)] as const;
  };
  const grid = [0.25, 0.5, 0.75, 1].map((ratio) => {
    const pts = scores.map((_, i) => pt(i, ratio).join(",")).join(" ");
    return <polygon key={ratio} points={pts} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="1" />;
  });
  const dataPts = scores.map((s, i) => {
    const v = s.value != null ? Math.max(0, Math.min(100, s.value)) / 100 : 0;
    return pt(i, v);
  });
  const poly = dataPts.map((p) => p.join(",")).join(" ");
  return (
    <svg width="220" height="220" viewBox="0 0 200 200" className="mx-auto">
      {grid}
      {scores.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(148,163,184,0.25)" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="rgba(56,189,248,0.25)" stroke="rgb(56,189,248)" strokeWidth="2" />
      {scores.map((s, i) => {
        const [x, y] = pt(i, 1.18);
        return (
          <text key={s.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ink-3" fontSize="9">
            {s.label}
          </text>
        );
      })}
    </svg>
  );
}

function BarChart({
  series,
  seriesKeys,
  colors,
  height = 160,
}: {
  series: { period: string; values: Record<string, number | null> }[];
  seriesKeys: { key: string; label: string }[];
  colors: string[];
  height?: number;
}) {
  if (!series.length) return <p className="py-6 text-center text-[11px] text-ink-3">Chưa có chuỗi số liệu BCTC.</p>;
  const allVals = series.flatMap((s) => seriesKeys.map((k) => s.values[k.key])).filter((v): v is number => v != null);
  const maxAbs = Math.max(...allVals.map((v) => Math.abs(v)), 1);
  const w = Math.max(280, series.length * 48);
  const padL = 8;
  const padB = 28;
  const padT = 12;
  const chartH = height - padB - padT;
  const groupW = (w - padL * 2) / series.length;
  const barW = Math.min(14, (groupW * 0.7) / seriesKeys.length);
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} className="min-w-full">
        <line x1={padL} y1={padT + chartH / 2} x2={w - padL} y2={padT + chartH / 2} stroke="rgba(148,163,184,0.25)" />
        {series.map((s, i) => {
          const gx = padL + i * groupW + groupW / 2;
          return (
            <g key={s.period}>
              {seriesKeys.map((sk, j) => {
                const v = s.values[sk.key];
                if (v == null) return null;
                const h = (Math.abs(v) / maxAbs) * (chartH / 2 - 4);
                const x = gx - (seriesKeys.length * barW) / 2 + j * barW;
                const y = v >= 0 ? padT + chartH / 2 - h : padT + chartH / 2;
                return (
                  <rect key={sk.key} x={x} y={y} width={barW - 1} height={Math.max(h, 1)} fill={colors[j % colors.length]} rx={2}>
                    <title>
                      {sk.label} · {s.period}: {fmtCompact(v)}
                    </title>
                  </rect>
                );
              })}
              <text x={gx} y={height - 8} textAnchor="middle" className="fill-ink-3" fontSize="9">
                {s.period.replace(/^20/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-ink-3">
        {seriesKeys.map((sk, j) => (
          <span key={sk.key} className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm" style={{ background: colors[j % colors.length] }} />
            {sk.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function LineChart({
  series,
  seriesKeys,
  colors,
  height = 150,
  asPercent = false,
}: {
  series: { period: string; values: Record<string, number | null> }[];
  seriesKeys: { key: string; label: string }[];
  colors: string[];
  height?: number;
  asPercent?: boolean;
}) {
  if (!series.length) return <p className="py-6 text-center text-[11px] text-ink-3">Chưa có chuỗi số liệu.</p>;
  const w = Math.max(280, series.length * 56);
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const chartH = height - pad.t - pad.b;
  const chartW = w - pad.l - pad.r;
  const allVals = series.flatMap((s) => seriesKeys.map((k) => s.values[k.key])).filter((v): v is number => v != null);
  if (!allVals.length) return <p className="py-6 text-center text-[11px] text-ink-3">Chưa đủ điểm dữ liệu.</p>;
  const minV = Math.min(...allVals, 0);
  const maxV = Math.max(...allVals, 0);
  const span = maxV - minV || 1;
  const xAt = (i: number) => pad.l + (series.length === 1 ? chartW / 2 : (i / (series.length - 1)) * chartW);
  const yAt = (v: number) => pad.t + chartH - ((v - minV) / span) * chartH;
  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} className="min-w-full">
        <line x1={pad.l} y1={yAt(0)} x2={w - pad.r} y2={yAt(0)} stroke="rgba(148,163,184,0.25)" strokeDasharray="4 3" />
        {seriesKeys.map((sk, j) => {
          const pts: string[] = [];
          series.forEach((s, i) => {
            const v = s.values[sk.key];
            if (v == null) return;
            pts.push(`${xAt(i)},${yAt(v)}`);
          });
          if (pts.length < 2) return null;
          return (
            <polyline
              key={sk.key}
              points={pts.join(" ")}
              fill="none"
              stroke={colors[j % colors.length]}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {series.map((s, i) => (
          <text key={s.period} x={xAt(i)} y={height - 8} textAnchor="middle" className="fill-ink-3" fontSize="9">
            {s.period.replace(/^20/, "")}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-ink-3">
        {seriesKeys.map((sk, j) => (
          <span key={sk.key} className="inline-flex items-center gap-1">
            <span className="inline-block size-2 rounded-full" style={{ background: colors[j % colors.length] }} />
            {sk.label}
            {asPercent ? " (%)" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function PieChart({ slices }: { slices: { label: string; value: number | null; color: string }[] }) {
  const valid = slices.filter((s) => s.value != null && s.value > 0) as { label: string; value: number; color: string }[];
  const total = valid.reduce((a, s) => a + s.value, 0);
  if (!total) return <p className="py-6 text-center text-[11px] text-ink-3">Chưa có cơ cấu từ BCTC.</p>;
  const R = 56;
  const cx = 70;
  const cy = 70;
  let angle = -Math.PI / 2;
  const paths: { d: string; color: string; label: string; pct: number }[] = [];
  for (const s of valid) {
    const sweep = (s.value / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle);
    const y1 = cy + R * Math.sin(angle);
    angle += sweep;
    const x2 = cx + R * Math.cos(angle);
    const y2 = cy + R * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    paths.push({
      d: `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`,
      color: s.color,
      label: s.label,
      pct: (s.value / total) * 100,
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {paths.map((p) => (
          <path key={p.label} d={p.d} fill={p.color}>
            <title>
              {p.label}: {p.pct.toFixed(1)}%
            </title>
          </path>
        ))}
      </svg>
      <ul className="space-y-1 text-[11px]">
        {paths.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-ink-3">{p.label}</span>
            <span className="num font-medium text-ink-2">{p.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StockFundamentalsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 300_000,
  });

  const derived = useMemo(() => (data ? ratiosFromSnapshot(data) : null), [data]);
  const incomeSeries = useMemo(
    () =>
      seriesFrom(data?.financials.income as Record<string, unknown>[] | null, [
        "netRevenue|revenue",
        "grossProfit",
        "netIncome|netProfit",
      ]),
    [data],
  );
  const marginSeries = useMemo(() => {
    const rows = data?.financials.income as Record<string, unknown>[] | null;
    if (!rows?.length) return [];
    return [...rows]
      .slice(0, 8)
      .map((r) => {
        const rev = n(r.netRevenue) ?? n(r.revenue);
        const gp = n(r.grossProfit);
        const op = n(r.operatingProfit) ?? n(r.ebit);
        const ni = n(r.netIncome) ?? n(r.netProfit);
        return {
          period: periodLabel(r),
          values: {
            grossMargin: div(gp, rev),
            operatingMargin: div(op, rev),
            netMargin: div(ni, rev),
          },
        };
      })
      .reverse();
  }, [data]);
  const cfSeries = useMemo(
    () =>
      seriesFrom(data?.financials.cashflow as Record<string, unknown>[] | null, [
        "operatingCashFlow",
        "investingCashFlow",
        "financingCashFlow",
      ]),
    [data],
  );

  if (!symbol || (isLoading && !res)) return <Loading rows={10} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được phân tích cơ bản ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn BCTC đang gián đoạn."}
      />
    );
  }

  const h = data.financialHealth;
  const fm = data.financialMeta;
  const growth = data.financialGrowth;
  const overall = h?.scores?.overall ?? null;
  const pillarScores = [
    { key: "profit", label: "Sinh lời", value: h?.scores?.profitability ?? null },
    { key: "liq", label: "Thanh khoản", value: h?.scores?.liquidity ?? null },
    { key: "lev", label: "Đòn bẩy", value: h?.scores?.leverage ?? null },
    { key: "cf", label: "Dòng tiền", value: h?.scores?.cashflow ?? null },
    { key: "eff", label: "Hiệu quả", value: h?.scores?.efficiency ?? null },
  ];
  const r = derived;
  const g = h?.groups;
  const pick = (fromSnap: number | null | undefined, fromHealth: number | null | undefined) =>
    fromSnap != null ? fromSnap : fromHealth ?? null;

  return (
    <div className="space-y-3">
      <Panel title="Sức khỏe tài chính (tự động từ BCTC)">
        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <ScoreGauge score={overall} label={healthLabel(overall)} />
            <RadarScores scores={pillarScores} />
          </div>
          <div>
            <div className="grid gap-2 text-[12px] sm:grid-cols-2">
              <div>
                <div className="text-[10px] uppercase text-ink-3">Kỳ / Phạm vi</div>
                <div className="font-medium text-ink-2">
                  {fm?.latestPeriod ?? "—"}
                  {fm?.statementScope === "consolidated"
                    ? " · Hợp nhất"
                    : fm?.statementScope === "standalone"
                      ? " · Riêng"
                      : ""}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-ink-3">Nguồn snapshot</div>
                <div className="font-medium text-ink-2">{fm?.primarySource ?? "vndirect-fs"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-ink-3">Trạng thái</div>
                <div className="font-medium text-ink-2">{statusVi(fm?.freshnessStatus)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-ink-3">Ngành</div>
                <div className="font-medium text-ink-2">
                  {h?.industry ? `${h.industry.labelVi} (${h.industry.id})` : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {pillarScores.map((p) => (
                <div key={p.key} className="rounded-md border border-line/40 px-1.5 py-1 text-center">
                  <div className="text-[9px] text-ink-3">{p.label}</div>
                  <div className="text-[13px] font-semibold text-ink-2">
                    {p.value != null ? Math.round(p.value) : "—"}
                  </div>
                </div>
              ))}
            </div>
            {h?.riskFlags && h.riskFlags.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-warn/90">
                {h.riskFlags.slice(0, 4).map((f, i) => (
                  <li key={i}>• {f}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <AiFinancialPanel symbol={symbol} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Cơ cấu tài sản (kỳ mới nhất)">
          <PieChart
            slices={[
              { label: "Tiền & TĐT", value: r?.cash ?? null, color: "#38bdf8" },
              {
                label: "TS ngắn hạn khác",
                value:
                  r?.currentAssets != null && r.cash != null
                    ? Math.max(0, r.currentAssets - r.cash)
                    : r?.currentAssets ?? null,
                color: "#818cf8",
              },
              { label: "TS dài hạn", value: r?.longTermAssets ?? null, color: "#a78bfa" },
            ]}
          />
        </Panel>
        <Panel title="Cơ cấu nguồn vốn (kỳ mới nhất)">
          <PieChart
            slices={[
              { label: "Nợ phải trả", value: r?.totalLiabilities ?? null, color: "#f87171" },
              { label: "Vốn chủ sở hữu", value: r?.equity ?? null, color: "#34d399" },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Kết quả kinh doanh theo kỳ (cột)">
        <BarChart
          series={incomeSeries}
          seriesKeys={[
            { key: "netRevenue|revenue", label: "Doanh thu thuần" },
            { key: "grossProfit", label: "LN gộp" },
            { key: "netIncome|netProfit", label: "LN sau thuế" },
          ]}
          colors={["#38bdf8", "#a78bfa", "#34d399"]}
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Biên lợi nhuận theo kỳ (đường)">
          <LineChart
            series={marginSeries}
            seriesKeys={[
              { key: "grossMargin", label: "Biên gộp" },
              { key: "operatingMargin", label: "Biên HĐKD" },
              { key: "netMargin", label: "Biên ròng" },
            ]}
            colors={["#38bdf8", "#fbbf24", "#34d399"]}
            asPercent
          />
        </Panel>
        <Panel title="Lưu chuyển tiền tệ theo kỳ (cột)">
          <BarChart
            series={cfSeries}
            seriesKeys={[
              { key: "operatingCashFlow", label: "HĐKD" },
              { key: "investingCashFlow", label: "Đầu tư" },
              { key: "financingCashFlow", label: "Tài chính" },
            ]}
            colors={["#34d399", "#fbbf24", "#f87171"]}
          />
        </Panel>
      </div>

      <Panel title="Chỉ số tài chính (tính từ snapshot BCTC)">
        <div className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Biên LN gộp", fmtPct(pick(r?.grossMargin, g?.profitability?.grossMargin))],
              ["Biên LN HĐKD", fmtPct(pick(r?.operatingMargin, g?.profitability?.operatingMargin))],
              ["Biên LN ròng", fmtPct(pick(r?.netMargin, g?.profitability?.netMargin))],
              ["ROE", fmtPct(pick(r?.roe, g?.profitability?.roe))],
              ["ROA", fmtPct(pick(r?.roa, g?.profitability?.roa))],
              ["Thanh toán hiện hành", fmtX(pick(r?.currentRatio, g?.liquidity?.currentRatio))],
              ["Thanh toán nhanh", fmtX(pick(r?.quickRatio, g?.liquidity?.quickRatio))],
              ["Nợ / Vốn chủ", fmtX(pick(r?.debtToEquity, g?.leverage?.debtToEquity))],
              ["Nợ / Tổng TS", fmtX(pick(r?.debtToAssets, g?.leverage?.debtToAssets))],
              ["OCF / LNST", fmtX(pick(r?.ocfToNi, g?.cashflow?.ocfToNi))],
              ["Vòng quay TS", fmtX(pick(r?.assetTurnover, g?.efficiency?.assetTurnover))],
              [
                "Số ngày phải thu",
                pick(r?.receivableDays, g?.efficiency?.daysReceivable) != null
                  ? Math.round(pick(r?.receivableDays, g?.efficiency?.daysReceivable)!).toString()
                  : "—",
              ],
            ] as const
          ).map(([label, val]) => (
            <div key={label} className="flex items-center justify-between rounded-md border border-line/40 px-2.5 py-1.5">
              <span className="text-ink-3">{label}</span>
              <span className="num font-medium text-ink-2">{val}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-ink-3">
          Số liệu lấy trực tiếp từ snapshot trang Báo cáo tài chính (income / balance / cashflow).
        </p>
      </Panel>

      {growth && (growth.yoy.length > 0 || growth.qoq.length > 0) && (
        <Panel title="Tăng trưởng (YoY / QoQ từ BCTC)">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">
                YoY
                {growth.latestPeriod && growth.priorYearPeriod
                  ? ` · ${growth.latestPeriod} vs ${growth.priorYearPeriod}`
                  : ""}
              </div>
              <ul className="space-y-1 text-[12px]">
                {growth.yoy.map((c) => (
                  <li key={c.metric} className="flex justify-between gap-2">
                    <span className="text-ink-3">{GROWTH_VI[c.metric] ?? c.metric}</span>
                    <Chg value={c.changePct} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">
                QoQ
                {growth.latestPeriod && growth.priorQuarterPeriod
                  ? ` · ${growth.latestPeriod} vs ${growth.priorQuarterPeriod}`
                  : ""}
              </div>
              <ul className="space-y-1 text-[12px]">
                {growth.qoq.map((c) => (
                  <li key={c.metric} className="flex justify-between gap-2">
                    <span className="text-ink-3">{GROWTH_VI[c.metric] ?? c.metric}</span>
                    <Chg value={c.changePct} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Nguồn đối chiếu (VNDIRECT DStock)">
        <ul className="space-y-1.5 text-[12px]">
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Bảng cân đối kế toán — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kết quả kinh doanh — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lưu chuyển tiền tệ — {symbol}
            </a>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
