"use client";

/**
 * CRYPTO QUANT TERMINAL — dense layout (no wasted vertical whitespace).
 * Chart rail matches right stack height; bottom cockpit equal-height columns.
 */
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, CryptoMarketRow, NewsArticle, TechnicalSnapshot } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { ScalpPanel } from "@/components/scalp-panel";
import { CryptoTradeDesk } from "@/components/crypto-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { useSettings } from "@/lib/settings";
import { Brain, Layers, Newspaper, ExternalLink } from "lucide-react";

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

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

/** Make a Panel fill its grid cell and scroll body if content overflows. */
const FILL =
  "h-full !flex !flex-col min-h-0 [&_.panel-header]:shrink-0 [&_.panel-body]:!flex-1 [&_.panel-body]:!min-h-0 [&_.panel-body]:!overflow-y-auto [&_.panel-body]:!py-2 [&_.panel-body]:!px-2.5";

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
  const chg = t.changePercent ?? 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Ticker — single dense row */}
      <div className="rounded-md border border-border-subtle bg-surface-primary px-2.5 py-1.5 md:px-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex size-6 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-[11px] font-bold text-accent">
              {data.baseAsset.slice(0, 1)}
            </div>
            <h1 className="text-[13px] font-semibold text-text-primary">{data.baseAsset}/USDT</h1>
            <Badge tone="accent">SPOT</Badge>
            <span className="hidden text-[10px] text-text-muted sm:inline">Binance</span>
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            <AddToWatchlist assetType="crypto" symbol={data.symbol} />
          </div>

          <div className="num flex items-baseline gap-1.5">
            <span className="text-[16px] font-semibold text-text-primary">{fmtNum(t.price, digits)}</span>
            <Chg value={chg} className="text-[11px]" />
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <HeadStat label="Cao" value={fmtNum(t.high ?? t.price, digits)} />
            <HeadStat label="Thấp" value={fmtNum(t.low ?? t.price, digits)} />
            <HeadStat label="Vol" value={`$${fmtCompact(t.quoteVolume ?? 0)}`} />
            <HeadStat label="GD" value={fmtCompact(t.trades24h ?? 0)} />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="seg">
              {INTERVALS.map((x) => (
                <button key={x} type="button" data-active={interval === x} onClick={() => setInterval(x)}>
                  {x}
                </button>
              ))}
            </div>
            <MetaLine meta={meta} />
          </div>
        </div>
      </div>

      {/* Chart + right rail — equal row height */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12 xl:items-stretch">
        <div className="min-h-0 xl:col-span-8">
          <OrcaChart
            symbol={data.symbol}
            assetType="crypto"
            defaultTimeframe={interval}
            height={400}
            title={`${data.baseAsset}/USDT`}
          />
        </div>

        <div className="flex min-h-0 flex-col gap-2 xl:col-span-4 xl:h-full">
          <div className="min-h-0 flex-1 [&>section]:h-full">
            <ScalpPanel symbol={data.symbol} />
          </div>
          <div className="shrink-0">
            <SentimentPanelCompact symbol={data.symbol} ticker={t} tech={tech} />
          </div>
        </div>
      </div>

      {/* Bottom cockpit — three equal columns */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12 xl:items-stretch">
        <div className="min-h-0 xl:col-span-4 xl:min-h-[320px]">
          <div className="h-full [&>section]:h-full">
            <CryptoTradeDesk symbol={data.symbol} />
          </div>
        </div>
        <div className="min-h-0 xl:col-span-4 xl:min-h-[320px]">
          <div className="h-full [&>section]:h-full">
            <TechnicalPanel tech={tech} patterns={data.patterns} />
          </div>
        </div>
        <div className="min-h-0 md:col-span-2 xl:col-span-4 xl:min-h-[320px]">
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="min-h-0 flex-[1.4] [&>section]:h-full">
              <CryptoNewsPanel symbol={data.symbol} baseAsset={data.baseAsset} className={FILL} />
            </div>
            <div className="min-h-0 flex-1 [&>section]:h-full">
              <CandlePatternsPanel patterns={data.patterns} className={FILL} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SentimentPanelCompact({
  symbol,
  ticker,
  tech,
}: {
  symbol: string;
  ticker: CryptoMarketRow;
  tech: TechnicalSnapshot | null;
}) {
  const fallback = useMemo(() => computeLocalSentiment(ticker, tech, "crypto"), [ticker, tech]);
  const { data, meta, isLoading } = useApi<SentimentApi>(
    `/api/v1/sentiment?assetType=crypto&symbol=${encodeURIComponent(symbol)}`,
    { refreshInterval: 90_000 },
  );

  const quant = data?.quant ?? fallback;
  const llm = data?.llm ?? null;

  return (
    <Panel
      className="[&_.panel-body]:!py-2 [&_.panel-body]:!px-2.5"
      title={
        <span className="flex items-center gap-1.5">
          <Brain className="size-3.5 text-accent" /> Tâm lý
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <Badge tone={quant.tone}>
          {quant.label} {quant.score > 0 ? "+" : ""}
          {quant.score}
        </Badge>
      }
    >
      <div className="space-y-1.5">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-background-secondary">
          <div className="absolute inset-0 bg-gradient-to-r from-negative/50 via-warning/40 to-positive/50 opacity-70" />
          <div
            className="absolute top-0 bottom-0 w-1 rounded-full bg-text-primary"
            style={{ left: `${Math.max(2, Math.min(98, 50 + quant.score / 2))}%`, transform: "translateX(-50%)" }}
          />
        </div>
        <ul className="space-y-0.5 text-[10.5px] leading-snug text-text-secondary">
          {quant.factors.slice(0, 3).map((f, i) => (
            <li key={i} className="flex items-start gap-1">
              <span className={f.w > 0 ? "text-positive" : f.w < 0 ? "text-negative" : "text-text-muted"}>•</span>
              <span className="line-clamp-1">{f.text}</span>
            </li>
          ))}
        </ul>
        {isLoading && !data && <p className="text-[10px] text-text-muted">Đang tải…</p>}
        {llm?.narrative && <p className="line-clamp-2 text-[10.5px] leading-snug text-text-muted">{llm.narrative}</p>}
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
    } else {
      factors.push({ w: 0, text: `RSI ${tech.rsi14.toFixed(0)} — cân bằng` });
    }
  }
  if (tech?.trend) {
    const map: Record<string, number> = {
      "strong-up": 22,
      up: 12,
      sideways: 0,
      down: -12,
      "strong-down": -22,
    };
    const w = map[tech.trend.label] ?? 0;
    score += w;
    factors.push({ w, text: `Trend: ${tech.trend.label}` });
  }
  if (tech?.sma?.sma50 != null && t.price != null && t.price > 0) {
    if (t.price < (tech.sma?.sma50 ?? 0)) {
      score -= 10;
      factors.push({ w: -1, text: "Giá dưới SMA50" });
    } else {
      score += 8;
      factors.push({ w: 1, text: "Giá trên SMA50" });
    }
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

function CandlePatternsPanel({ patterns, className }: { patterns: CandlePattern[]; className?: string }) {
  return (
    <Panel
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          <Layers className="size-3.5 text-accent" /> Mẫu hình nến
        </span>
      }
    >
      {!patterns.length ? (
        <p className="text-[11px] text-text-muted">Không có mô hình đáng chú ý gần đây.</p>
      ) : (
        <div className="space-y-1">
          {patterns.map((p) => (
            <div key={p.name} className="rounded border border-border-subtle/70 bg-background-secondary/40 px-2 py-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] font-medium text-text-primary">{p.nameVi}</span>
                <Badge tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}>
                  {p.type === "bullish" ? "Tăng" : p.type === "bearish" ? "Giảm" : "—"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CryptoNewsPanel({
  symbol,
  baseAsset,
  className,
}: {
  symbol: string;
  baseAsset: string;
  className?: string;
}) {
  const { data, meta, isLoading } = useApi<NewsPayload>(`/api/v1/news?limit=20&category=crypto`, {
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
    return (related.length ? related : list).slice(0, 8);
  }, [data, symbol, baseAsset]);

  return (
    <Panel
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          <Newspaper className="size-3.5 text-accent" /> News Flow
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      {isLoading && !data ? (
        <Loading rows={2} />
      ) : !articles.length ? (
        <p className="text-[11px] text-text-muted">Chưa có tin liên quan.</p>
      ) : (
        <ul className="space-y-1">
          {articles.map((a) => (
            <li key={a.id || a.url} className="rounded border border-border-subtle/60 bg-background-secondary/25 px-2 py-1 hover:bg-surface-elevated/50">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-1 text-[11px] font-medium leading-snug text-text-primary hover:text-accent"
              >
                <span className="line-clamp-2 flex-1">{a.title}</span>
                <ExternalLink className="mt-0.5 size-2.5 shrink-0 opacity-40 group-hover:opacity-80" />
              </a>
              <div className="mt-0.5 flex gap-1 text-[9.5px] text-text-muted">
                <span className="text-accent/80">{a.source}</span>
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
  if (mins < 60) return `${mins}p`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function HeadStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="num text-[11.5px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
