"use client";

import { useApi } from "@/lib/hooks";
import type { MetalDetail } from "@/lib/services/metals";
import { Badge, Chg, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { AddToWatchlist } from "@/components/watchlist-button";

function fmtMetal(v: number): string {
  return v >= 1000 ? v.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : v.toFixed(2);
}

const PERF_LABELS = [
  { key: "d1", label: "1D" },
  { key: "w1", label: "1W" },
  { key: "m1", label: "1M" },
  { key: "q1", label: "1Q" },
  { key: "y1", label: "1Y" },
] as const;

export function MetalsDetailPage({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<MetalDetail>(`/api/v1/metals/${symbol}`, { refreshInterval: 120_000 });
  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) return <Unavailable title={`Không lấy được ${symbol}`} meta={meta} />;

  const cur = data.current;
  const price = cur?.price ?? data.daily[data.daily.length - 1]?.close ?? null;
  const perf = data.performance;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.name}</h1>
              <Badge tone="accent">{data.symbol}</Badge>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="metal" symbol={data.symbol} />
            </div>
            {price != null && (
              <div className="num mt-1 flex items-baseline gap-3">
                <span className="text-[28px] font-semibold">{fmtMetal(price)}</span>
                <span className="text-[11px] text-ink-3">{data.unit}</span>
                {cur && <Chg value={cur.changePercent} className="text-[14px]" />}
              </div>
            )}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      {/* unified chart engine — metals 1m/5m/15m/1H/4H/1D/1W/1M */}
      <OrcaChart symbol={data.symbol} assetType="metal" defaultTimeframe="1h" height={400} title={`${data.symbol} · ${data.unit}`} />

      <Panel pad={false} title="Hiệu suất">
        <div className="grid grid-cols-5 divide-x divide-line/50">
          {PERF_LABELS.map((p) => (
            <div key={p.key} className="px-2 py-2.5 text-center">
              <div className="text-[10px] uppercase text-ink-3">{p.label}</div>
              {perf?.[p.key] != null ? (
                <div className={`num text-[13px] font-semibold ${(perf[p.key] ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                  {(perf[p.key] ?? 0) >= 0 ? "+" : ""}
                  {(perf[p.key] ?? 0).toFixed(2)}%
                </div>
              ) : (
                <div className="text-[11px] text-ink-3">—</div>
              )}
            </div>
          ))}
        </div>
        <p className="border-t border-line/50 px-3.5 py-2 text-[11px] leading-relaxed text-ink-3">{data.performanceNote ?? data.referenceNote}</p>
      </Panel>

      <Panel pad={false} title="Ghi chú phương pháp">
        <p className="text-[11px] leading-relaxed text-ink-3">{data.referenceNote} Giá BBO từ Swissquote public feed; cùng pipeline validation + normalization của Chart Data Engine.</p>
      </Panel>

      <TechnicalPanel tech={data.technical} patterns={[]} />
    </div>
  );
}
