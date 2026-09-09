"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { NewsArticle } from "@/lib/types";
import type { NewsSentimentResult } from "@/lib/services/news-sentiment";
import { Badge, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Brain, Newspaper } from "lucide-react";

const TABS: { key: string; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "market", label: "Thị trường" },
  { key: "corporate", label: "Doanh nghiệp" },
  { key: "macro", label: "Vĩ mô" },
  { key: "crypto", label: "Crypto" },
];

type NewsData = { articles: NewsArticle[]; errors: string[] };

export default function NewsPage() {
  const [tab, setTab] = useState("");
  const qs = tab ? `&category=${tab}` : "";
  const { data, meta, isLoading } = useApi<NewsData>(`/api/v1/news?limit=50${qs}`, {
    refreshInterval: 2 * 60_000,
  });
  const { data: sent, meta: sentMeta } = useApi<NewsSentimentResult>(
    `/api/v1/news/sentiment?limit=40${qs}`,
    { refreshInterval: 3 * 60_000 },
  );

  const byId = useMemo(() => {
    const m = new Map<string, { score: number; tone: string; label: string }>();
    for (const a of sent?.aggregate.articles ?? []) {
      m.set(a.id, { score: a.score, tone: a.tone, label: a.label });
    }
    return m;
  }, [sent]);

  const agg = sent?.aggregate;

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Newspaper className="size-5 text-accent" /> Luồng tin tức thời gian thực
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </h1>
          <p className="text-[12px] text-ink-3">
            Tổng hợp RSS đa nguồn — CafeF, VnExpress, VietnamBiz, CoinTelegraph — gắn mã/ngành và chấm sentiment từ
            tiêu đề/tóm tắt.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-2.5 py-1 text-[12px] ${tab === t.key ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      {agg && agg.articleCount > 0 && (
        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              Sentiment tin tức
              {sentMeta && <FreshnessDot status={sentMeta.freshness} ageMs={sentMeta.ageMs} />}
            </span>
          }
          right={
            <span className="flex items-center gap-1.5">
              <Badge tone={agg.tone}>{agg.label}</Badge>
              <span className="num text-[13px] font-semibold text-text-primary">
                {agg.score > 0 ? "+" : ""}
                {agg.score}
              </span>
            </span>
          }
        >
          <div className="space-y-3">
            <div className="relative h-2 overflow-hidden rounded-full bg-background-secondary">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border-subtle" />
              <div
                className={`absolute inset-y-0 ${agg.score >= 0 ? "left-1/2 bg-positive/70" : "right-1/2 bg-negative/70"}`}
                style={{ width: `${Math.min(50, Math.abs(agg.score) / 2)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-up/25 bg-up/5 px-2 py-2">
                <div className="num text-[16px] font-semibold text-up">{agg.distribution.bullish}</div>
                <div className="text-[10px] text-text-muted">Tích cực</div>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-elevated px-2 py-2">
                <div className="num text-[16px] font-semibold text-text-secondary">{agg.distribution.neutral}</div>
                <div className="text-[10px] text-text-muted">Trung lập</div>
              </div>
              <div className="rounded-lg border border-down/25 bg-down/5 px-2 py-2">
                <div className="num text-[16px] font-semibold text-down">{agg.distribution.bearish}</div>
                <div className="text-[10px] text-text-muted">Tiêu cực</div>
              </div>
            </div>

            {agg.byCategory.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {agg.byCategory.map((c) => (
                  <Badge key={c.category} tone={c.tone}>
                    {c.category}: {c.score > 0 ? "+" : ""}
                    {c.score} ({c.count})
                  </Badge>
                ))}
              </div>
            )}

            {sent?.llm?.narrative && (
              <div className="panel-inset space-y-1.5 p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
                  <Brain className="size-3.5 text-accent-primary" /> LLM tổng hợp
                  <Badge
                    tone={
                      sent.llm.stance === "confirm" ? "up" : sent.llm.stance === "diverge" ? "down" : "neutral"
                    }
                  >
                    {sent.llm.stance}
                  </Badge>
                </div>
                <p className="text-[12.5px] leading-relaxed text-text-primary">{sent.llm.narrative}</p>
                {sent.llm.themes?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {sent.llm.themes.map((t) => (
                      <Badge key={t} tone="accent">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-[10px] text-text-muted">
              Điểm lexicon có trọng số thời gian (tin mới hơn ảnh hưởng mạnh hơn) · {agg.articleCount} tin · không phải
              khuyến nghị đầu tư.
            </p>
          </div>
        </Panel>
      )}

      {isLoading && !data ? (
        <Loading rows={10} />
      ) : !data ? (
        <Unavailable title="Tất cả nguồn tin đều đang lỗi" meta={meta} />
      ) : (
        <Panel pad={false}>
          <ul className="divide-y divide-line/50">
            {data.articles.map((a) => {
              const s = byId.get(a.id);
              return (
                <li key={a.id} className="row-hover px-3.5 py-3">
                  <div className="flex items-start gap-3">
                    <div className="num mt-0.5 w-14 shrink-0 text-[11px] text-ink-3">
                      {new Date(a.publishedAt).toLocaleString("vi-VN", {
                        timeZone: "Asia/Ho_Chi_Minh",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <div className="text-[9px]">
                        {new Date(a.publishedAt).toLocaleDateString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13.5px] font-medium leading-snug text-ink hover:text-accent"
                      >
                        {a.title}
                      </a>
                      {a.summary && (
                        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-3">{a.summary}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge>{a.source}</Badge>
                        {s && (
                          <Badge tone={s.tone === "up" ? "up" : s.tone === "down" ? "down" : "neutral"}>
                            {s.label} {s.score > 0 ? "+" : ""}
                            {s.score}
                          </Badge>
                        )}
                        {a.relatedSector && <Badge tone="accent">{a.relatedSector}</Badge>}
                        {a.relatedSymbols.map((sym) => (
                          <Badge key={sym}>{sym.replace(/USDT$/, "")}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {data.errors.length > 0 && (
            <div className="border-t border-line px-3.5 py-2 text-[11px] text-warn/90">
              {data.errors.length} nguồn tạm lỗi — nội dung trên là phần thu thập được.
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
