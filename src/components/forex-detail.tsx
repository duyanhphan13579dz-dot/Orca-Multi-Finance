"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, ForexRow, NewsArticle, OhlcvBar, TechnicalSnapshot } from "@/lib/types";

interface ForexDetail {
  pair: string;
  base: string;
  quote: string;
  current: ForexRow | null;
  series: OhlcvBar[];
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  referenceNote: string;
}

interface NewsPayload {
  articles: NewsArticle[];
  errors: string[];
}

interface SentimentApi {
  assetType: "crypto" | "forex";
  symbol: string;
  quant: { score: number; label: string; tone: "up" | "down" | "neutral"; factors: { w: number; text: string }[] };
  llm: { narrative: string; stance: "confirm" | "diverge" | "neutral"; risks: string[]; model: string; latencyMs: number } | null;
  llmStatus: "ok" | "unavailable" | "skipped" | "failed";
}

import { Badge, Chg, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { ForexScalpPanel } from "@/components/forex-scalp-panel";
import { AddToWatchlist } from "@/components/watchlist-button";
import { Brain, Layers, Newspaper, ExternalLink } from "lucide-react";

export function ForexDetailPage({ pair }: { pair: string }) {
  const { data, meta, isLoading } = useApi<ForexDetail>(`/api/v1/forex/${pair}`, { refreshInterval: 120_000 });
  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) return <Unavailable title={`Không lấy được ${pair}`} meta={meta} />;

  const cur = data.current;
  const price = cur?.price ?? data.series[data.series.length - 1]?.close ?? null;
  const tech = data.technical;
  const patterns = data.patterns ?? [];

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">
                {data.base}/{data.quote}
              </h1>
              <Badge tone="accent">{pair}</Badge>
              {cur?.group && <Badge tone="neutral">{cur.group}</Badge>}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="forex" symbol={pair} />
            </div>
            {price != null && (
              <div className="num mt-1 flex items-baseline gap-3">
                <span className="text-[28px] font-semibold">
                  {price >= 1000
                    ? price.toLocaleString("vi-VN", { maximumFractionDigits: 0 })
                    : price >= 100
                      ? price.toFixed(2)
                      : price.toFixed(4)}
                </span>
                {cur && <Chg value={cur.changePercent} className="text-[14px]" />}
              </div>
            )}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        {/* Signal panel first — confidence + leverage slider + Entry/SL/TP */}
        <div className="col-span-12 xl:col-span-4 order-1 xl:order-2">
          <div className="flex flex-col gap-3">
            <ForexScalpPanel pair={pair} />
            <SentimentPanel pair={pair} current={cur} tech={tech} />
          </div>
        </div>

        <div className="col-span-12 xl:col-span-8 order-2 xl:order-1 space-y-3">
          <OrcaChart
            symbol={pair}
            assetType="forex"
            defaultTimeframe="15m"
            height={400}
            title={`${data.base}/${data.quote}`}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CandlePatternsPanel patterns={patterns} />
            <ForexNewsPanel pair={pair} base={data.base} quote={data.quote} />
          </div>
        </div>

        <div className="col-span-12">
          <Panel pad={false} title="Ghi chú phương pháp">
            <p className="px-4 pb-3 text-[11px] leading-relaxed text-ink-3">
              {data.referenceNote} Scalping M15→M5→M1 dùng nến public (Yahoo) khi Biquote chưa có intraday; filter
              session/spread bắt buộc theo đặc tả Forex.
            </p>
          </Panel>
        </div>

        <div className="col-span-12">
          <TechnicalPanel tech={tech} patterns={patterns} />
        </div>
      </div>
    </div>
  );
}
