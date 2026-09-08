"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, CryptoMarketRow, NewsArticle, TechnicalSnapshot } from "@/lib/types";

/** Client-local shape — never import from server-only services into client components. */
interface CryptoDetail {
  symbol: string;
  baseAsset: string;
  ticker: CryptoMarketRow;
  klines: unknown[];
  interval: string;
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  funding: { fundingRate: number; markPrice?: number; nextFundingTime?: number } | null;
  openInterest: { openInterest: number; time: number } | null;
  fundingStatus: "ok" | "unavailable";
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

import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { ScalpPanel } from "@/components/scalp-panel";
import { CryptoTradeDesk } from "@/components/crypto-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { useSettings } from "@/lib/settings";
import { Brain, Layers, Newspaper, ExternalLink } from "lucide-react";

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

export function CryptoDetailPage({ symbol }: { symbol: string }) {
  const { settings } = useSettings();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>(
    (INTERVALS as readonly string[]).includes(settings.dashboard.defaultTimeframe)
      ? (settings.dashboard.defaultTimeframe as (typeof INTERVALS)[number])
      : "1h",
  );
  const { data, meta, isLoading } = useApi<CryptoDetail>(`/api/v1/crypto/${encodeURIComponent(symbol)}?interval=${interval}`, {
    refreshInterval: 20_000,
  });

  if (isLoading && !data) return <Loading rows={10} />;
  if (!data)
    return (
      <Unavailable
        title={`Không lấy được dữ liệu ${symbol}`}
        note="Binance không phản hồi hoặc ký hiệu không tồn tại. Kiểm tra /system."
        meta={meta}
      />
    );

  const t = data.ticker;
  const tech = data.technical;
  const digits = priceDigits(t.price);

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.baseAsset}/USDT</h1>
              <Badge tone="accent">{data.symbol}</Badge>
              <Badge tone="neutral">Binance Spot</Badge>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="crypto" symbol={data.symbol} />
            </div>
            <div className="num mt-1 flex items-baseline gap-3">
              <span className="text-[28px] font-semibold">{fmtNum(t.price, digits)}</span>
              <Chg value={t.changePercent} className="text-[14px]" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <HeadStat label="Cao 24h" value={fmtNum(t.high ?? t.price, digits)} />
            <HeadStat label="Thấp 24h" value={fmtNum(t.low ?? t.price, digits)} />
            <HeadStat label="Vol 24h" value={`$${fmtCompact(t.quoteVolume ?? 0)}`} />
            <HeadStat label="Giao dịch" value={fmtCompact(t.trades24h ?? 0)} />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2">
          <div className="seg">
            {INTERVALS.map((x) => (
              <button key={x} type="button" data-active={interval === x} onClick={() => setInterval(x)}>
                {x}
              </button>
            ))}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 space-y-3 xl:col-span-8">
          <OrcaChart
            symbol={data.symbol}
            assetType="crypto"
            defaultTimeframe={interval}
            height={420}
            title={`${data.baseAsset}/USDT`}
          />
          <CryptoTradeDesk symbol={data.symbol} />
        </div>

        <div className="col-span-12 flex flex-col gap-3 xl:col-span-4">
          <SentimentPanel symbol={data.symbol} ticker={t} tech={tech} />
          <CandlePatternsPanel patterns={data.patterns} />
          <CryptoNewsPanel symbol={data.symbol} baseAsset={data.baseAsset} />
        </div>

        <div className="col-span-12 lg:col-span-6">
          <ScalpPanel symbol={data.symbol} />
        </div>
        <div className="col-span-12 lg:col-span-6">
          <TechnicalPanel tech={tech} patterns={data.patterns} />
        </div>
      </div>
    </div>
  );
}

function SentimentPanel({ symbol, ticker, tech }: { symbol: string; ticker: CryptoMarketRow; tech: TechnicalSnapshot | null }) {
  const fallback = useMemo(() => computeLocalSentiment(ticker, tech, "crypto"), [ticker, tech]);
  const { data, meta, isLoading } = useApi<SentimentApi>(
    `/api/v1/sentiment?assetType=crypto&symbol=${encodeURIComponent(symbol)}`,
    { refreshInterval: 90_000 },
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
        <p className="text-[10px] text-text-muted">Điểm quant từ %24h, RSI, trend, SMA — không phải khuyến nghị.</p>
      </div>
    </Panel>
  );
}

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

function CandlePatternsPanel({ patterns }: { patterns: CandlePattern[] }) {
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
          Không có mô hình đáng chú ý trong 5 nến gần nhất — thị trường đang vận động theo cấu trúc thông thường.
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
}

function CryptoNewsPanel({ symbol, baseAsset }: { symbol: string; baseAsset: string }) {
  const { data, meta, isLoading } = useApi<NewsPayload>(`/api/v1/news?category=crypto&limit=12`, {
    refreshInterval: 120_000,
  });

  const articles = useMemo(() => {
    const list = data?.articles ?? [];
    const base = baseAsset.toUpperCase();
    const sym = symbol.toUpperCase();
    const related = list.filter(
      (a) =>
        a.relatedSymbols?.some((s) => s.toUpperCase().includes(base) || s.toUpperCase() === sym) ||
        a.title.toUpperCase().includes(base) ||
        (a.summary ?? "").toUpperCase().includes(base),
    );
    return (related.length ? related : list).slice(0, 5);
  }, [data, symbol, baseAsset]);

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
        <p className="text-[12px] text-text-muted">Chưa có tin crypto liên quan — nguồn RSS tạm trống.</p>
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
}

function formatAge(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}p trước`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h trước`;
  return `${Math.round(h / 24)}d trước`;
}

function HeadStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  );
}
