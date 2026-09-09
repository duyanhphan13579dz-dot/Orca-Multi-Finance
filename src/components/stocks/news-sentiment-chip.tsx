"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { NewsSentimentResult } from "@/lib/services/news-sentiment";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Newspaper } from "lucide-react";

/** Compact news-sentiment panel filtered by stock ticker. */
export const StockNewsSentiment = memo(function StockNewsSentiment({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<NewsSentimentResult>(
    symbol
      ? `/api/v1/news/sentiment?symbol=${encodeURIComponent(symbol)}&limit=25&llm=0`
      : null,
    { refreshInterval: 180_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Sentiment tin tức">
        <Loading rows={2} />
      </Panel>
    );
  }

  const agg = data?.aggregate;
  if (!agg || agg.articleCount === 0) {
    return (
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Newspaper className="size-4 text-accent-primary" /> Sentiment tin tức
          </span>
        }
      >
        <p className="text-[12px] text-text-muted">
          Chưa gắn được tin liên quan mã <b>{symbol}</b> trong luồng RSS gần nhất.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-accent-primary" /> Sentiment tin · {symbol}
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <span className="flex items-center gap-1.5">
          <Badge tone={agg.tone}>{agg.label}</Badge>
          <span className="num text-[13px] font-semibold">
            {agg.score > 0 ? "+" : ""}
            {agg.score}
          </span>
        </span>
      }
    >
      <div className="space-y-2">
        <div className="flex gap-2 text-[11px]">
          <span className="rounded-md bg-up/10 px-2 py-1 text-up">{agg.distribution.bullish} tích cực</span>
          <span className="rounded-md bg-surface-elevated px-2 py-1 text-text-muted">
            {agg.distribution.neutral} trung lập
          </span>
          <span className="rounded-md bg-down/10 px-2 py-1 text-down">{agg.distribution.bearish} tiêu cực</span>
        </div>
        {agg.topBullish[0] && (
          <p className="line-clamp-2 text-[11.5px] text-text-secondary">
            <span className="text-up">↑ </span>
            {agg.topBullish[0].title}
          </p>
        )}
        {agg.topBearish[0] && (
          <p className="line-clamp-2 text-[11.5px] text-text-secondary">
            <span className="text-down">↓ </span>
            {agg.topBearish[0].title}
          </p>
        )}
        <p className="text-[10px] text-text-muted">{agg.articleCount} tin gắn mã · lexicon có trọng số thời gian</p>
      </div>
    </Panel>
  );
});
