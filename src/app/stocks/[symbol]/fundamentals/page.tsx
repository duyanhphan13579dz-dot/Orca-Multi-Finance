"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Chg, Loading, Panel, Unavailable } from "@/components/ui";
import { AiFinancialPanel } from "@/components/stocks/ai-financial-panel";
import { ValuationPanel } from "@/components/stocks/valuation-panel";
import {
  buildSnapshotMetrics,
  formatMetric,
  type Band,
  type MetricCell,
} from "@/lib/financial/fundamental-metrics";

type TabKey = "operating" | "investment" | "health" | "cashflow" | "valuation";

const TABS: { key: TabKey; label: string }[] = [
  { key: "operating", label: "1. Hiệu suất KD" },
  { key: "investment", label: "2. Hiệu suất ĐT" },
  { key: "health", label: "3. Sức khỏe TC" },
  { key: "cashflow", label: "4. Dòng tiền" },
  { key: "valuation", label: "5. Định giá" },
];

function bandClass(b?: Band): string {
  if (b === "safe") return "border-up/40 bg-up/10 text-up";
  if (b === "ok") return "border-warn/40 bg-warn/10 text-warn";
  if (b === "risk") return "border-down/40 bg-down/10 text-down";
  return "border-line/40 text-ink-3";
}

function MetricGrid({ items }: { items: MetricCell[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((m) => (
        <div key={m.key} className={`rounded-lg border px-3 py-2 ${bandClass(m.band)}`}>
          <div className="text-[10px] uppercase tracking-wide opacity-80">{m.labelVi}</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="num text-[15px] font-semibold text-ink-2">{formatMetric(m)}</span>
            {m.delta != null && <Chg value={m.delta} className="text-[11px]" />}
          </div>
          {m.bandLabel && m.band && m.band !== "na" && (
            <div className="mt-0.5 text-[10px] font-medium">{m.bandLabel}</div>
          )}
          {m.note && <div className="mt-0.5 text-[10px] text-ink-3">{m.note}</div>}
        </div>
      ))}
    </div>
  );
}

export default function StockFundamentalsPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const [symbol, setSymbol] = useState("");
  const [tab, setTab] = useState<TabKey>("operating");

  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(
    symbol ? `/api/v1/stocks/${symbol}` : null,
    { refreshInterval: 60_000 },
  );

  const metrics = useMemo(() => {
    if (!data) return null;
    const closes = (data.bars ?? [])
      .map((b) => b.close)
      .filter((c): c is number => typeof c === "number");
    return buildSnapshotMetrics({
      income: (data.financials?.income ?? []) as Record<string, unknown>[],
      balance: (data.financials?.balance ?? []) as Record<string, unknown>[],
      cashflow: (data.financials?.cashflow ?? []) as Record<string, unknown>[],
      price: data.quote?.price ?? null,
      closes,
      shares: data.financialHealth?.anchors?.shares ?? null,
      growthYoy: (data.financialGrowth?.yoy ?? []).map((g) => ({
        metric: g.metric,
        changePct: g.changePct,
      })),
      growthQoq: (data.financialGrowth?.qoq ?? []).map((g) => ({
        metric: g.metric,
        changePct: g.changePct,
      })),
    });
  }, [data]);

  if (!symbol || (isLoading && !res)) {
    return <Loading rows={6} />;
  }

  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được fundamentals ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn dữ liệu đang gián đoạn."}
      />
    );
  }

  const empty: MetricCell[] = [];
  const operating = metrics?.operating ?? empty;
  const investment = metrics?.investment ?? empty;
  const health = [
    ...(metrics?.debtPillars ?? empty),
    ...(metrics?.healthExtra ?? empty),
  ];
  const cashflow = metrics?.cashflow ?? empty;
  const valuation = metrics?.valuation ?? empty;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-line pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              tab === t.key
                ? "bg-accent/15 text-accent"
                : "text-ink-3 hover:bg-bg-2 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "operating" && (
        <Panel title="Hiệu suất kinh doanh">
          <MetricGrid items={operating} />
        </Panel>
      )}

      {tab === "investment" && (
        <Panel title="Hiệu suất đầu tư & sinh lời">
          <MetricGrid items={investment} />
        </Panel>
      )}

      {tab === "health" && (
        <Panel title="Sức khỏe tài chính">
          <MetricGrid items={health} />
        </Panel>
      )}

      {tab === "cashflow" && (
        <Panel title="Dòng tiền">
          <MetricGrid items={cashflow} />
        </Panel>
      )}

      {tab === "valuation" && (
        <div className="space-y-3">
          <Panel title="Định giá nhanh (multiples)">
            <MetricGrid items={valuation} />
          </Panel>
          <ValuationPanel symbol={symbol} showAnalyst={false} />
        </div>
      )}

      <AiFinancialPanel symbol={symbol} />

      <Panel title="Nguồn báo cáo tài chính">
        <ul className="space-y-1.5 text-[12px] text-ink-2">
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-tai-chinh/${symbol}`}
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
