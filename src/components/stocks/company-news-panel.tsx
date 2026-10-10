"use client";

import { memo } from "react";
import { ExternalLink, Newspaper } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { StockNewsResult } from "@/lib/services/stock-news";
import { Loading, Panel, EmptyState } from "@/components/ui";

const fmt = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
    : "—";
};

/** Tin doanh nghiệp theo mã — VNDirect DStock (tin-tuc-ma) + RSS bổ sung. */
export const CompanyNewsPanel = memo(function CompanyNewsPanel({ symbol }: { symbol: string }) {
  const { data, isLoading } = useApi<StockNewsResult>(symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/news?limit=15` : null, {
    refreshInterval: 180_000,
  });
  const title = (
    <span className="flex items-center gap-2">
      <Newspaper className="size-4 text-accent-primary" /> Tin doanh nghiệp {symbol}
    </span>
  );
  if (isLoading && !data) {
    return (
      <Panel title={title}>
        <Loading rows={3} />
      </Panel>
    );
  }
  const items = data?.articles ?? [];
  if (!items.length) {
    return (
      <Panel title={title}>
        <EmptyState
          title={`Chưa có tin tức cho ${symbol}`}
          description="Chưa có tin tức niêm yết mới nhất hoặc thông cáo từ DStock VNDirect cho mã này."
        />
      </Panel>
    );
  }
  return (
    <Panel title={title}>
      <ul className="divide-y divide-border-subtle">
        {items.map((a) => (
          <li key={a.id} className="py-2">
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2 text-[13px] leading-snug text-text-primary hover:text-accent-primary">
              <span className="min-w-0 flex-1">{a.title}</span>
              <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-50 group-hover:opacity-100" />
            </a>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {a.source} · {fmt(a.publishedAt)}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
});
