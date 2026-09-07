"use client";

import { memo, useMemo } from "react";
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
  const { data, meta, isLoading } = useApi<ForexDetail>(`/api/v1/forex/${pair}`, { refreshInterval: 180_000 });
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

const SentimentPanel = memo(function SentimentPanel({
  pair,
  current,
  tech,
}: {
  pair: string;
  current: ForexRow | null;
  tech: TechnicalSnapshot | null;
}) {
  const fallback = useMemo(
    () => computeLocalSentiment({ changePercent: current?.changePercent, price: current?.price }, tech, "forex"),
    [current, tech],
  );
  const { data, meta, isLoading } = useApi<SentimentApi>(
    `/api/v1/sentiment?assetType=forex&symbol=${encodeURIComponent(pair)}`,
    { refreshInterval: 180_000 },
  );

  const quant = data?.quant ?? fallback;
  const llm = data?.llm ?? null;
  const llmStatus = data?.llmStatus ?? "skipped";

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Brain className="size-4 text-accent-primary" /> Tâm lý thị trường
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={quant.tone}>
            <span className="font-bold">{quant.label}</span>
          </Badge>
          <span className="num text-[18px] font-semibold text-text-primary">
            {quant.score > 0 ? "+" : ""}
            {quant.score}
          </span>
        </div>

        <div className="relative h-2 overflow-hidden rounded-full bg-background-secondary">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border-subtle" />
          <div
            className={`absolute inset-y-0 ${quant.score >= 0 ? "left-1/2 bg-positive/70" : "right-1/2 bg-negative/70"}`}
            style={{ width: `${Math.min(50, Math.abs(quant.score) / 2)}%` }}
          />
        </div>

        <ul className="space-y-1 text-[11.5px] leading-relaxed text-text-secondary">
          {quant.factors.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className={f.w >= 0 ? "text-positive" : "text-negative"}>{f.w >= 0 ? "+" : "-"}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>

        {isLoading && !data && <p className="text-[11px] text-text-muted">Đang tải diễn giải LLM…</p>}
        {llm?.narrative && (
          <div className="panel-inset space-y-1.5 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
              <span>AI insight</span>
              <Badge tone={llm.stance === "confirm" ? "up" : llm.stance === "diverge" ? "down" : "neutral"}>
                {llm.stance === "confirm" ? "Khớp quant" : llm.stance === "diverge" ? "Lệch quant" : "Trung lập"}
              </Badge>
            </div>
            <p className="text-[12px] leading-relaxed text-text-primary">{llm.narrative}</p>
            {llm.risks?.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-text-muted">
                {llm.risks.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!llm && llmStatus === "skipped" && (
          <p className="text-[10px] text-text-muted">LLM chưa bật (AI_PROVIDER_KEY) — chỉ điểm quant.</p>
        )}
        {!llm && (llmStatus === "unavailable" || llmStatus === "failed") && (
          <p className="text-[10px] text-text-muted">LLM tạm không phản hồi — giữ điểm quant.</p>
        )}
        <p className="text-[10px] text-text-muted">Điểm quant từ % ngày, RSI, trend SMA — không phải khuyến nghị.</p>
      </div>
    </Panel>
  );
});

function computeLocalSentiment(
  t: { changePercent?: number | null; price?: number },
  tech: TechnicalSnapshot | null,
  mode: "crypto" | "forex",
) {
  let score = 0;
  const factors: { w: number; text: string }[] = [];
  const chg = t.changePercent ?? null;
  const hi = mode === "crypto" ? 3 : 0.4;
  const mid = mode === "crypto" ? 0.5 : 0.08;
  if (chg != null) {
    if (chg > hi) {
      score += 28;
      factors.push({ w: 1, text: `Biến động +${chg.toFixed(2)}% — momentum tăng` });
    } else if (chg > mid) {
      score += 14;
      factors.push({ w: 1, text: `Biến động +${chg.toFixed(2)}% — bias nhẹ tăng` });
    } else if (chg < -hi) {
      score -= 28;
      factors.push({ w: -1, text: `Biến động ${chg.toFixed(2)}% — áp lực bán` });
    } else if (chg < -mid) {
      score -= 14;
      factors.push({ w: -1, text: `Biến động ${chg.toFixed(2)}% — bias nhẹ giảm` });
    } else factors.push({ w: 0, text: `Biến động ${chg.toFixed(2)}% — biên độ hẹp` });
  }
  if (tech?.rsi14 != null) {
    if (tech.rsi14 >= 70) {
      score -= 18;
      factors.push({ w: -1, text: `RSI ${tech.rsi14.toFixed(0)} — quá mua` });
    } else if (tech.rsi14 <= 30) {
      score += 18;
      factors.push({ w: 1, text: `RSI ${tech.rsi14.toFixed(0)} — quá bán` });
    } else if (tech.rsi14 >= 55) {
      score += 8;
      factors.push({ w: 1, text: `RSI ${tech.rsi14.toFixed(0)} — nghiêng mua` });
    } else if (tech.rsi14 <= 45) {
      score -= 8;
      factors.push({ w: -1, text: `RSI ${tech.rsi14.toFixed(0)} — nghiêng bán` });
    }
  }
  if (tech?.trend) {
    const map: Record<string, number> = { "strong-up": 22, up: 12, sideways: 0, down: -12, "strong-down": -22 };
    const w = map[tech.trend.label] ?? 0;
    score += w;
    factors.push({ w, text: `Trend: ${tech.trend.label} (${tech.trend.score})` });
  }
  score = Math.max(-100, Math.min(100, Math.round(score)));
  let label = "TRUNG LẬP";
  let tone: "up" | "down" | "neutral" = "neutral";
  if (score >= 35) {
    label = "LẠC QUAN";
    tone = "up";
  } else if (score >= 12) {
    label = "HƠI LẠC QUAN";
    tone = "up";
  } else if (score <= -35) {
    label = "BI QUAN";
    tone = "down";
  } else if (score <= -12) {
    label = "HƠI BI QUAN";
    tone = "down";
  }
  return { score, label, tone, factors: factors.slice(0, 5) };
}

const CandlePatternsPanel = memo(function CandlePatternsPanel({ patterns }: { patterns: CandlePattern[] }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Layers className="size-4 text-accent-primary" /> Nhận diện mẫu hình nến
        </span>
      }
    >
      {!patterns.length ? (
        <p className="text-[12px] leading-relaxed text-text-muted">
          Không có mô hình đáng chú ý trên nến intraday gần nhất — thị trường đang vận động theo cấu trúc thông thường.
        </p>
      ) : (
        <div className="max-h-[200px] space-y-2 overflow-y-auto">
          {patterns.map((p) => (
            <div key={p.name} className="panel-inset space-y-1 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-medium text-text-primary">{p.nameVi}</span>
                <Badge tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}>
                  {p.type === "bullish" ? "Tăng" : p.type === "bearish" ? "Giảm" : "Trung lập"}
                </Badge>
                <Badge tone="neutral">{p.reliability}</Badge>
              </div>
              <p className="text-[11px] leading-relaxed text-text-secondary">{p.description}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
});

const ForexNewsPanel = memo(function ForexNewsPanel({
  pair,
  base,
  quote,
}: {
  pair: string;
  base: string;
  quote: string;
}) {
  const { data, meta, isLoading } = useApi<NewsPayload>(`/api/v1/news?category=forex&limit=12`, {
    refreshInterval: 300_000,
  });

  const articles = useMemo(() => {
    const list = data?.articles ?? [];
    const keys = [pair, base, quote, `${base}/${quote}`, `${base}${quote}`].map((s) => s.toUpperCase());
    const related = list.filter((a) => {
      const title = a.title.toUpperCase();
      const summary = (a.summary ?? "").toUpperCase();
      const syms = (a.relatedSymbols ?? []).map((s) => s.toUpperCase());
      return keys.some((k) => title.includes(k) || summary.includes(k) || syms.some((s) => s.includes(k)));
    });
    return (related.length ? related : list).slice(0, 5);
  }, [data, pair, base, quote]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-accent-primary" /> Tin tức
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      {isLoading && !data ? (
        <Loading rows={3} />
      ) : !articles.length ? (
        <p className="text-[12px] text-text-muted">Chưa có tin forex liên quan — nguồn RSS tạm trống.</p>
      ) : (
        <ul className="max-h-[200px] space-y-2 overflow-y-auto">
          {articles.map((a) => (
            <li key={a.id || a.url} className="border-b border-border-subtle/60 pb-2 last:border-0 last:pb-0">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-1.5 text-[12px] font-medium leading-snug text-text-primary hover:text-accent-primary"
              >
                <span className="line-clamp-2 flex-1">{a.title}</span>
                <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-40 group-hover:opacity-80" />
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                <span>{a.source}</span>
                <span>·</span>
                <span>{formatAge(a.publishedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
});

function formatAge(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}p trước`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h trước`;
  return `${Math.round(h / 24)}d trước`;
}
