"use client";

import { useApi } from "@/lib/hooks";
import {
  Panel,
  Badge,
  Chg,
  Loading,
  ErrorNote,
  Unavailable,
  FreshnessDot,
  fmtNum,
  fmtCompact,
} from "@/components/ui";
import { TrendingUp, Calendar, Info } from "lucide-react";

type ForecastRow = {
  label: string;
  horizon: "quarter" | "year";
  year: number;
  quarter: number | null;
  revenue: number | null;
  netIncome: number | null;
  netMargin: number | null;
  eps: number | null;
  fairValue: number | null;
  upsidePct: number | null;
  methods: {
    forwardPe: number | null;
    peg: number | null;
    residualIncome: number | null;
    blended: number | null;
  };
};

type ForecastPayload = {
  symbol: string;
  asOf: string;
  currentPrice: number | null;
  assumptions: {
    revenueGrowthYoy: number;
    netMargin: number;
    peTarget: number;
    costOfEquity: number;
    terminalGrowth: number;
    sharesOutstanding: number | null;
    method: string;
  };
  historical: {
    periodsUsed: number;
    revenueCagr: number | null;
    niCagr: number | null;
    avgNetMargin: number | null;
    lastRevenue: number | null;
    lastNetIncome: number | null;
    lastEquity: number | null;
    lastEpsTtm: number | null;
  };
  quarterly: ForecastRow[];
  yearly: ForecastRow[];
  notes: string[];
  confidence: "high" | "medium" | "low";
};

function pct(x: number | null | undefined, d = 1) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(d)}%`;
}

function moneyVnd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return fmtCompact(n);
}

function priceFmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return fmtNum(n, n >= 1000 ? 0 : 2);
}

export function ForecastPanel({
  symbol,
  compact = false,
}: {
  symbol: string;
  compact?: boolean;
}) {
  const { data, meta, isLoading, error } = useApi<ForecastPayload>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/forecast` : null,
    { refreshInterval: 180_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Dự báo BCTC & định giá cuối kỳ">
        <Loading rows={5} />
      </Panel>
    );
  }

  if (error && !data) {
    return (
      <Panel title="Dự báo BCTC & định giá cuối kỳ">
        <ErrorNote message={String(error)} />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Dự báo BCTC & định giá cuối kỳ">
        <Unavailable
          title="Chưa dựng được dự báo"
          note={`Cần chuỗi BCTC lịch sử cho ${symbol}.`}
        />
      </Panel>
    );
  }

  const a = data.assumptions;
  const h = data.historical;
  const confTone =
    data.confidence === "high" ? "up" : data.confidence === "medium" ? "warn" : "neutral";

  return (
    <div className={compact ? "space-y-3" : "page-stack"}>
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            <TrendingUp className="size-4 text-accent-primary" />
            Dự báo BCTC & định giá cuối kỳ
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </span>
        }
        subtitle="Historical CAGR + mean-reversion · Forward P/E · PEG · Residual Income"
        right={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={confTone}>Độ tin cậy {data.confidence}</Badge>
            {data.currentPrice != null && (
              <Badge tone="neutral">Giá {priceFmt(data.currentPrice)}</Badge>
            )}
          </span>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Assump label="Tăng trưởng DT/năm" value={pct(a.revenueGrowthYoy)} />
          <Assump label="Biên LNST" value={pct(a.netMargin)} />
          <Assump label="PE mục tiêu" value={`${a.peTarget.toFixed(1)}x`} />
          <Assump label="r (cost of equity)" value={pct(a.costOfEquity)} />
          <Assump label="CAGR DT lịch sử" value={pct(h.revenueCagr)} />
          <Assump label="EPS TTM" value={priceFmt(h.lastEpsTtm)} />
        </div>

        <SectionTitle icon={<Calendar className="size-3.5" />} title="Dự phóng theo quý (4 quý tới)" />
        {data.quarterly.length ? (
          <ForecastTable rows={data.quarterly} compact={compact} />
        ) : (
          <p className="mb-3 text-[12px] text-text-muted">Chưa đủ dữ liệu quý để dự phóng.</p>
        )}

        <SectionTitle icon={<Calendar className="size-3.5" />} title="Dự phóng theo năm (3 năm tới)" />
        {data.yearly.length ? (
          <ForecastTable rows={data.yearly} compact={compact} />
        ) : (
          <p className="mb-3 text-[12px] text-text-muted">Chưa đủ dữ liệu năm để dự phóng.</p>
        )}

        {data.notes.length > 0 && (
          <div className="mt-3 rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
              <Info className="size-3.5" />
              Phương pháp & lưu ý
            </div>
            <ul className="space-y-0.5 text-[11px] leading-relaxed text-text-muted">
              {data.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Assump({ label, value }: { label: string; value: string }) {
  return (
    <div className="stock-stat">
      <div className="stock-stat-label">{label}</div>
      <div className="stock-stat-value num">{value}</div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-1.5 mt-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
      {icon}
      {title}
    </div>
  );
}

function ForecastTable({ rows, compact }: { rows: ForecastRow[]; compact?: boolean }) {
  return (
    <div className="mb-3 overflow-x-auto rounded-lg border border-border-subtle">
      <table className="stock-table w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-border-subtle bg-surface-elevated/50 text-left">
            <th className="px-2.5 py-2">Kỳ</th>
            <th className="px-2.5 py-2 text-right">Doanh thu</th>
            <th className="px-2.5 py-2 text-right">LNST</th>
            <th className="px-2.5 py-2 text-right">Biên</th>
            <th className="px-2.5 py-2 text-right">EPS</th>
            <th className="px-2.5 py-2 text-right">FV cuối kỳ</th>
            <th className="px-2.5 py-2 text-right">Upside</th>
            {!compact && <th className="px-2.5 py-2 text-right">P/E fwd</th>}
            {!compact && <th className="px-2.5 py-2 text-right">PEG</th>}
            {!compact && <th className="px-2.5 py-2 text-right">RI</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border-subtle/70 last:border-0">
              <td className="px-2.5 py-2 font-medium text-text-primary">{r.label}</td>
              <td className="num px-2.5 py-2 text-right">{moneyVnd(r.revenue)}</td>
              <td className="num px-2.5 py-2 text-right">{moneyVnd(r.netIncome)}</td>
              <td className="num px-2.5 py-2 text-right">{pct(r.netMargin)}</td>
              <td className="num px-2.5 py-2 text-right">{priceFmt(r.eps)}</td>
              <td className="num px-2.5 py-2 text-right font-semibold text-accent-primary">
                {priceFmt(r.fairValue)}
              </td>
              <td className="px-2.5 py-2 text-right">
                <Chg value={r.upsidePct} className="text-[12px]" />
              </td>
              {!compact && (
                <td className="num px-2.5 py-2 text-right text-text-muted">
                  {priceFmt(r.methods.forwardPe)}
                </td>
              )}
              {!compact && (
                <td className="num px-2.5 py-2 text-right text-text-muted">
                  {priceFmt(r.methods.peg)}
                </td>
              )}
              {!compact && (
                <td className="num px-2.5 py-2 text-right text-text-muted">
                  {priceFmt(r.methods.residualIncome)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
