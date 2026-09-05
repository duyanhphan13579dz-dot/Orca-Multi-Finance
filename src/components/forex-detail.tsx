"use client";

import { useApi } from "@/lib/hooks";
import type { ForexDetail } from "@/lib/services/forex";
import { Badge, Chg, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { AddToWatchlist } from "@/components/watchlist-button";

export function ForexDetailPage({ pair }: { pair: string }) {
  const { data, meta, isLoading } = useApi<ForexDetail>(`/api/v1/forex/${pair}`, { refreshInterval: 120_000 });
  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) return <Unavailable title={`Không lấy được ${pair}`} meta={meta} />;

  const cur = data.current;
  const price = cur?.price ?? data.series[data.series.length - 1]?.close ?? null;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.base}/{data.quote}</h1>
              <Badge tone="accent">{pair}</Badge>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="forex" symbol={pair} />
            </div>
            {price != null && (
              <div className="num mt-1 flex items-baseline gap-3">
                <span className="text-[28px] font-semibold">{price >= 1000 ? price.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : price >= 100 ? price.toFixed(2) : price.toFixed(4)}</span>
                {cur && <Chg value={cur.changePercent} className="text-[14px]" />}
              </div>
            )}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      {/* unified chart engine — forex intraday/daily candles */}
      <OrcaChart symbol={pair} assetType="forex" defaultTimeframe="1h" height={400} title={`${data.base}/${data.quote}`} />

      <Panel pad={false} title="Ghi chú phương pháp">
        <p className="text-[11px] leading-relaxed text-ink-3">{data.referenceNote} Intraday candles từ public data provider được phê duyệt khi Biquote chưa cấu hình — cùng pipeline validation + normalization của Chart Data Engine.</p>
      </Panel>

      <TechnicalPanel tech={data.technical} patterns={[]} />
    </div>
  );
}
