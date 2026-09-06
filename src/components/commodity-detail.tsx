"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { OrcaChart } from "@/components/orca-chart";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import type { FreshnessStatus } from "@/lib/types";
import { AddToWatchlist } from "@/components/watchlist-button";
import { CalendarDays, Droplets, LineChart, Link2, Newspaper } from "lucide-react";

/**
 * COMMODITY DETAIL VIEW — shared by the landing route /commodities/:key and
 * the floating landing-page overlay on /commodities. Same visual identity
 * (panels/badges/num/freshness dot). Renders:
 * quote (price/change/prevClose/open/high/low/unit/source/freshness),
 * performance 1D/1W/1M/1Q/1Y, real chart (OHLC or CLOSE_ONLY), provenance,
 * impact matrix. Never fabricates — every number comes from a real provider.
 */

export interface CommodityDetailBody {
  id: string;
  symbol: string;
  name: string;
  nameVi: string;
  category: string;
  subcategory: string | null;
  subgroup?: string | null;
  market?: "VN" | "INTL";
  unit: string;
  currency: string;
  hasChart?: boolean;
  chartNote?: string | null;
  quote: {
    price: number;
    change: number | null;
    changePercent: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    previousClose: number | null;
    priceType?: string;
  };
  performance: {
    "1D": { change: number | null; changePercent: number | null; basis: string };
    "1W": { change: number | null; changePercent: number | null; basis: string };
    "1M": { change: number | null; changePercent: number | null; basis: string };
    "1Q": { change: number | null; changePercent: number | null; basis: string };
    "1Y": { change: number | null; changePercent: number | null; basis: string };
  } | null;
  relatedStocks: string[];
  sourceRecords: { source: string; price: number; timestamp: string | null; url?: string | null }[];
  source: string | null;
  freshness: string;
  marketState: "OPEN" | "CLOSED" | "UNKNOWN";
  freshnessNote: string | null;
  updatedAt: string | null;
  sourceTimestamp: string | null;
  sourceUrl: string | null;
  /** intelligence profile */
  correlation?: {
    r: number | null;
    beta: number | null;
    observations: number;
    window: string;
    status: "OK" | "INSUFFICIENT_DATA";
    note: string;
  } | null;
  latestNews?: NewsItem[];
  catalysts?: NewsItem[];
  newsNote?: string | null;
}

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt: string;
}

const DATE_RANGES: { label: string; tf: string; limit: number }[] = [
  { label: "1D", tf: "1h", limit: 96 },
  { label: "1W", tf: "4h", limit: 168 },
  { label: "1M", tf: "1d", limit: 32 },
  { label: "3M", tf: "1d", limit: 95 },
  { label: "1Y", tf: "1d", limit: 250 },
];

interface ImpactRow {
  commodity: string;
  stock: string;
  sector: string | null;
  relationshipType: string;
  direction: "POSITIVE" | "NEGATIVE" | "MIXED" | "CONDITIONAL";
  impactStrength: "HIGH" | "MEDIUM" | "LOW";
  transmissionChannel: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
  basis: "economic-exposure" | "related-source";
}

const DIRECTION_TONE: Record<ImpactRow["direction"], "up" | "down" | "neutral" | "warn"> = {
  POSITIVE: "up",
  NEGATIVE: "down",
  MIXED: "warn",
  CONDITIONAL: "neutral",
};

export default function CommodityDetailView({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const key = symbol.toUpperCase();
  const [range, setRange] = useState(DATE_RANGES[1]);
  const { data, meta, isLoading, error } = useApi<CommodityDetailBody>(`/api/v1/commodities/${key}`, { refreshInterval: 3_000 });

  if (isLoading) return <Loading rows={8} />;
  if (error && !data) return <Unavailable title="Không tải được hàng hóa này" note={error.message} meta={meta} />;
  if (!data) {
    return (
      <Unavailable
        title={`Không có dữ liệu cho ${key}`}
        note="Nguồn công khai đáng tin cậy chưa khả dụng — hệ thống không mock giá."
        meta={meta}
      />
    );
  }

  const q = data.quote;
  const dgt = q.price >= 1000 ? 0 : 2;
  const perfRows = data.performance
    ? (Object.entries(data.performance) as [string, { change: number | null; changePercent: number | null; basis: string }][])
    : [];
  const vnTz = { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } as const;

  return (
    <div className="space-y-3">
      {/* quote hero (same panel style) */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <Droplets className="size-5 text-accent-primary" /> {data.nameVi}
              </h1>
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                {data.category}
                {data.subcategory ? ` · ${data.subcategory}` : ""}
              </span>
              <FreshnessDot status={data.freshness as FreshnessStatus} ageMs={meta?.ageMs ?? null} />
              {data.marketState === "CLOSED" && <Badge tone="warn">MARKET CLOSED</Badge>}
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {data.symbol} · {data.unit} · {data.market === "VN" ? "Thị trường Việt Nam" : "Thị trường quốc tế"}
              {data.subgroup ? ` · ${data.subgroup}` : ""} · <span className="text-text-secondary">{data.source ?? "—"}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="num text-[28px] font-semibold tracking-tight">
                {fmtNum(q.price, dgt)} <span className="text-[12px] font-normal text-text-muted">{data.currency}</span>
              </span>
              <Chg value={q.changePercent} className="text-[14px]" />
              {q.change != null && (
                <span className="num text-[11px] text-text-muted">
                  {q.change >= 0 ? "+" : ""}
                  {fmtNum(q.change, dgt)}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
              {q.previousClose != null && (
                <span>
                  Đóng cửa trước: <b className="num text-text-secondary">{fmtNum(q.previousClose, dgt)}</b>
                </span>
              )}
              {q.open != null && (
                <span>
                  Mở cửa: <b className="num text-text-secondary">{fmtNum(q.open, dgt)}</b>
                </span>
              )}
              {q.high != null && (
                <span>
                  Cao: <b className="num text-text-secondary">{fmtNum(q.high, dgt)}</b>
                </span>
              )}
              {q.low != null && (
                <span>
                  Thấp: <b className="num text-text-secondary">{fmtNum(q.low, dgt)}</b>
                </span>
              )}
              {q.priceType === "CLOSE_ONLY" && <Badge tone="warn">CLOSE-ONLY</Badge>}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10.5px] text-text-muted">
              {data.freshnessNote && <span>{data.freshnessNote}</span>}
              {data.updatedAt && <span>· Cập nhật: {new Date(data.updatedAt).toLocaleString("vi-VN", vnTz)}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AddToWatchlist assetType="commodity" symbol={data.symbol} />
            {data.sourceUrl && (
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[10.5px] text-text-muted hover:text-text-primary"
              >
                <Link2 className="size-3" /> Nguồn
              </a>
            )}
          </div>
        </div>
      </div>

      {/* performance strip */}
      {data.performance && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {perfRows.map(([w, p]) => (
            <div key={w} className="panel p-2.5">
              <div className="text-[10px] text-text-muted">{w}</div>
              <Chg value={p.changePercent} className="num mt-1 text-[15px] font-semibold" arrow={false} />
              <div className="mt-0.5 text-[9.5px] text-text-muted">
                {p.basis === "historical" ? "tính từ lịch sử thật" : p.basis === "provider" ? "nguồn công bố" : "không đủ dữ liệu"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* chart — real OHLC only (rendered only when a genuine source exists) */}
      {data.hasChart === false ? (
        <div className="panel p-4 text-[11px] leading-relaxed text-text-muted">
          <span className="text-text-secondary">Biểu đồ:</span> chưa có nguồn OHLC công khai đáng tin cậy cho {data.nameVi} —
          hệ thống không dựng chart giả. Giá và biến động vẫn lấy từ nguồn công bố ở trên.
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
            <LineChart className="size-4 text-accent-primary" />
            <span className="text-[13px] font-semibold">Biểu đồ {data.nameVi}</span>
            {data.chartNote && <span className="text-[10px] text-text-muted">{data.chartNote}</span>}
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-elevated p-1">
              <CalendarDays className="ml-1 size-3.5 text-text-muted" />
              {DATE_RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    range.label === r.label ? "bg-accent-primary/15 text-accent-primary" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-1.5">
            <OrcaChart
              key={`${data.symbol}-${range.tf}-${range.limit}`}
              symbol={data.symbol}
              assetType="commodity"
              defaultTimeframe={range.tf}
              height={compact ? 300 : 360}
              title={data.symbol}
            />
          </div>
        </div>
      )}

      {/* provenance */}
      <Panel title="Nguồn dữ liệu" right={meta ? <MetaLine meta={meta} /> : undefined}>
        <div className="space-y-1.5">
          {data.sourceRecords.map((s) => (
            <div key={s.source} className="flex items-center justify-between text-[11px]">
              <span className="text-text-secondary">{s.source}</span>
              <span className="num text-text-muted">
                {fmtNum(s.price, dgt)}
                {s.timestamp && <> · {new Date(s.timestamp).toLocaleString("vi-VN", vnTz)}</>}
              </span>
            </div>
          ))}
          {data.sourceTimestamp && (
            <div className="text-[10px] text-text-muted">Thời điểm nguồn: {new Date(data.sourceTimestamp).toLocaleString("vi-VN")} · Freshness: {data.freshness}</div>
          )}
        </div>
      </Panel>

      {/* correlation / sensitivity — historical statistics only */}
      {data.correlation && (
        <Panel title="Tương quan & Độ nhạy" right={data.correlation.status === "OK" ? <Badge tone="accent">HISTORICAL</Badge> : <Badge tone="warn">INSUFFICIENT</Badge>}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11.5px]">
            {data.correlation.status === "OK" && data.correlation.r != null ? (
              <>
                <span>
                  Tương quan với VNINDEX: <b className="num text-text-secondary">{data.correlation.r.toFixed(2)}</b>
                </span>
                <span>
                  Độ nhạy (β): <b className="num text-text-secondary">{data.correlation.beta?.toFixed(2) ?? "—"}</b>
                  <span className="text-[9.5px] text-text-muted"> · 1% VNINDEX ↔ β% hàng hóa</span>
                </span>
              </>
            ) : (
              <span className="text-[11px] text-text-muted">{data.correlation.note}</span>
            )}
            <span className="text-[10px] text-text-muted">{data.correlation.observations} ngày khớp · {data.correlation.note}</span>
          </div>
        </Panel>
      )}

      {/* latest news & candidate catalysts — news-driven only */}
      {(data.latestNews?.length ?? 0) > 0 && (
        <Panel title="Tin mới & Catalyst" right={<span className="text-[10px] text-text-muted">{data.newsNote ?? ""}</span>}>
          <div className="space-y-2">
            {(data.catalysts?.length ? data.catalysts : data.latestNews!).map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-elevated p-2">
                <Newspaper className="mt-0.5 size-3.5 shrink-0 text-accent-primary" />
                <div className="min-w-0">
                  <a href={a.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[11.5px] leading-snug text-text-primary hover:text-accent-primary">
                    {a.title}
                  </a>
                  <div className="mt-0.5 text-[9.5px] text-text-muted">
                    {a.source} · {new Date(a.publishedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* impact */}
      <ImpactSection symbol={key} />
    </div>
  );
}

function ImpactSection({ symbol }: { symbol: string }) {
  const { data, isLoading } = useApi<{ rows: ImpactRow[]; note: string }>(`/api/v1/commodities/${symbol}/impact`, {
    refreshInterval: 30 * 60_000,
  });
  if (isLoading) return <div className="panel p-4 text-[11px] text-text-muted">Đang tải tác động ngành…</div>;
  if (!data || !data.rows.length) return null;
  return (
    <Panel title={`Tác động — cổ phiếu liên quan (${data.rows.length})`}>
      <p className="mb-2 text-[10.5px] leading-relaxed text-text-muted">{data.note}</p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {data.rows.map((r) => (
          <div key={`${r.stock}-${r.basis}`} className="rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold">{r.stock}</span>
              <div className="flex items-center gap-1">
                <Badge tone={DIRECTION_TONE[r.direction]}>{r.direction}</Badge>
                {r.impactStrength === "HIGH" && <Badge tone="warn">HIGH</Badge>}
                {r.impactStrength === "MEDIUM" && <Badge tone="accent">MED</Badge>}
              </div>
            </div>
            {r.sector && <div className="mt-0.5 text-[10px] text-text-muted">{r.sector}</div>}
            <div className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-text-muted">
              <div>
                <span className="text-text-secondary">Quan hệ:</span> {r.relationshipType} · <span className="text-text-secondary">Tự tin:</span> {r.confidence}
              </div>
              <div>{r.transmissionChannel}</div>
              <div className="italic">Evidence: {r.evidence}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
