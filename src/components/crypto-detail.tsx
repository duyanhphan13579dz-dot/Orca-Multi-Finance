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
        <div className="col-span-12">
          <OrcaChart
            symbol={data.symbol}
            assetType="crypto"
            defaultTimeframe={interval}
            height={440}
            title={`${data.baseAsset}/USDT`}
          />
        </div>

        <div className="col-span-12 flex flex-col gap-3 xl:col-span-4">
          <div className="min-h-0 flex-1">
            <SentimentPanel ticker={t} tech={tech} />
          </div>
          <div className="min-h-0 flex-1">
            <CandlePatternsPanel patterns={data.patterns} />
          </div>
          <div className="min-h-0 flex-1">
            <CryptoNewsPanel symbol={data.symbol} baseAsset={data.baseAsset} />
          </div>
        </div>

        <div className="col-span-12 xl:col-span-8">
          <CryptoTradeDesk symbol={data.symbol} />
        </div>

        <div className="col-span-12">
          <ScalpPanel symbol={data.symbol} />
        </div>

        <div className="col-span-12">
          <TechnicalPanel tech={tech} patterns={data.patterns} />
        </div>
      </div>
    </div>
  );
}

function SentimentPanel({ ticker, tech }: { ticker: CryptoMarketRow; tech: TechnicalSnapshot | null }) {
  const s = useMemo(() => computeSentiment(ticker, tech), [ticker, tech]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Brain className="size-4 text-accent-primary" /> Tam ly thi truong
        </span>
      }
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={s.tone}>
            <span className="font-bold">{s.label}</span>
          </Badge>
          <span className="num text-[18px] font-semibold text-text-primary">
            {s.score > 0 ? "+" : ""}
            {s.score}
          </span>
        </div>

        <div className="relative h-2 overflow-hidden rounded-full bg-background-secondary">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border-subtle" />
          <div
            className={`absolute inset-y-0 ${s.score >= 0 ? "left-1/2 bg-positive/70" : "right-1/2 bg-negative/70"}`}
            style={{ width: `${Math.min(50, Math.abs(s.score) / 2)}%` }}
          />
        </div>

        <ul className="space-y-1 text-[11.5px] leading-relaxed text-text-secondary">
          {s.factors.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className={f.w >= 0 ? "text-positive" : "text-negative"}>{f.w >= 0 ? "+" : "-"}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-text-muted">Diem tong hop tu bien dong 24h, RSI, trend SMA — khong phai khuyen nghi.</p>
      </div>
    </Panel>
  );
}

function computeSentiment(t: CryptoMarketRow, tech: TechnicalSnapshot | null) {
  let score = 0;
  const factors: { w: number; text: string }[] = [];

  const chg = t.changePercent ?? 0;
  if (chg > 3) {
    score += 28;
    factors.push({ w: 1, text: `Gia +${chg.toFixed(2)}% /24h — momentum tang manh` });
  } else if (chg > 0.5) {
    score += 14;
    factors.push({ w: 1, text: `Gia +${chg.toFixed(2)}% /24h — bias nhe tang` });
  } else if (chg < -3) {
    score -= 28;
    factors.push({ w: -1, text: `Gia ${chg.toFixed(2)}% /24h — ap luc ban ro` });
  } else if (chg < -0.5) {
    score -= 14;
    factors.push({ w: -1, text: `Gia ${chg.toFixed(2)}% /24h — bias nhe giam` });
  } else {
    factors.push({ w: 0, text: `Gia ${chg.toFixed(2)}% /24h — bien do hep` });
  }

  if (tech?.rsi14 != null) {
    if (tech.rsi14 >= 70) {
      score -= 18;
      factors.push({ w: -1, text: `RSI ${tech.rsi14.toFixed(0)} — vung qua mua` });
    } else if (tech.rsi14 <= 30) {
      score += 18;
      factors.push({ w: 1, text: `RSI ${tech.rsi14.toFixed(0)} — vung qua ban` });
    } else if (tech.rsi14 >= 55) {
      score += 8;
      factors.push({ w: 1, text: `RSI ${tech.rsi14.toFixed(0)} — nghieng mua` });
    } else if (tech.rsi14 <= 45) {
      score -= 8;
      factors.push({ w: -1, text: `RSI ${tech.rsi14.toFixed(0)} — nghieng ban` });
    } else {
      factors.push({ w: 0, text: `RSI ${tech.rsi14.toFixed(0)} — trung tinh` });
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
    const labelVi: Record<string, string> = {
      "strong-up": "xu huong tang manh",
      up: "xu huong tang",
      sideways: "di ngang",
      down: "xu huong giam",
      "strong-down": "xu huong giam manh",
    };
    factors.push({ w, text: `Trend: ${labelVi[tech.trend.label] ?? tech.trend.label} (score ${tech.trend.score})` });
  }

  if (tech?.sma.sma50 != null) {
    if (t.price >= tech.sma.sma50) {
      score += 8;
      factors.push({ w: 1, text: "Gia tren SMA50 — cau truc trung han ung ho" });
    } else {
      score -= 8;
      factors.push({ w: -1, text: "Gia duoi SMA50 — cau truc trung han yeu" });
    }
  }

  score = Math.max(-100, Math.min(100, Math.round(score)));
  let label = "TRUNG LAP";
  let tone: "up" | "down" | "neutral" = "neutral";
  if (score >= 35) {
    label = "LAC QUAN";
    tone = "up";
  } else if (score >= 12) {
    label = "HOI LAC QUAN";
    tone = "up";
  } else if (score <= -35) {
    label = "BI QUAN";
    tone = "down";
  } else if (score <= -12) {
    label = "HOI BI QUAN";
    tone = "down";
  }

  return { score, label, tone, factors: factors.slice(0, 5) };
}

function CandlePatternsPanel({ patterns }: { patterns: CandlePattern[] }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Layers className="size-4 text-accent-primary" /> Nhan dien mau hinh nen
        </span>
      }
    >
      {!patterns.length ? (
        <p className="text-[12px] leading-relaxed text-text-muted">
          Khong co mo hinh dang chu y trong 5 nen gan nhat — thi truong dang van dong theo cau truc thong thuong.
        </p>
      ) : (
        <div className="max-h-[200px] space-y-2 overflow-y-auto">
          {patterns.map((p) => (
            <div key={p.name} className="panel-inset space-y-1 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-medium text-text-primary">{p.nameVi}</span>
                <Badge tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}>
                  {p.type === "bullish" ? "Tang" : p.type === "bearish" ? "Giam" : "Trung lap"}
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
          <Newspaper className="size-4 text-accent-primary" /> Tin tuc
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      {isLoading && !data ? (
        <Loading rows={3} />
      ) : !articles.length ? (
        <p className="text-[12px] text-text-muted">Chua co tin crypto lien quan — nguon RSS tam trong.</p>
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
  if (mins < 60) return `${mins}p truoc`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h truoc`;
  return `${Math.round(h / 24)}d truoc`;
}

function HeadStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  );
}
