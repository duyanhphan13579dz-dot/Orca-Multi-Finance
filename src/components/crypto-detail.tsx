"use client";

/**
 * CRYPTO QUANT TERMINAL — Dense cockpit matching Forex institutional layout.
 * Layout (XL): sticky ticker · 3+6+3 stage · 7+5 structure | sentiment+news
 * Colors: system tokens. Order-flow from OHLCV CLV (no mock book).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, CryptoMarketRow, NewsArticle, OhlcvBar, TechnicalSnapshot } from "@/lib/types";
import {
  Badge,
  Chg,
  fmtCompact,
  fmtNum,
  FreshnessDot,
  Loading,
  MetaLine,
  Panel,
  priceDigits,
  Unavailable,
} from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { ScalpPanel } from "@/components/scalp-panel";
import { CryptoTradeDesk } from "@/components/crypto-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { useSettings } from "@/lib/settings";
import { ArrowLeft, Brain, ExternalLink, Newspaper, Percent } from "lucide-react";
import {
  deriveOrderFlow,
  OrderFlowPanel,
  LiquidityZonesPanel,
  KeyZonesCompact,
} from "@/components/forex-order-flow";
import {
  MarketStructurePanel,
  type StructureTab,
} from "@/components/forex-market-structure";

interface CryptoDetail {
  symbol: string;
  baseAsset: string;
  ticker: CryptoMarketRow;
  klines: OhlcvBar[];
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
  llm: {
    narrative: string;
    stance: "confirm" | "diverge" | "neutral";
    risks: string[];
    model: string;
    latencyMs: number;
  } | null;
  llmStatus: "ok" | "unavailable" | "skipped" | "failed";
}

const INTERVALS = ["5m", "15m", "1h", "4h", "1d", "1w"] as const;
const QUICK_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"] as const;

type MobileTab = "chart" | "desk" | "scalp" | "structure" | "news";

function FILL({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function toBars(klines: OhlcvBar[] | unknown[]): OhlcvBar[] {
  if (!Array.isArray(klines) || !klines.length) return [];
  const first = klines[0] as Record<string, unknown>;
  if (first && typeof first === "object" && "close" in first) return klines as OhlcvBar[];
  return (klines as unknown[]).map((row) => {
    const r = row as (number | string)[];
    return {
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5] ?? 0),
    };
  });
}

export function CryptoDetailPage({ symbol }: { symbol: string }) {
  const { settings } = useSettings();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>(
    (INTERVALS as readonly string[]).includes(settings.dashboard.defaultTimeframe)
      ? (settings.dashboard.defaultTimeframe as (typeof INTERVALS)[number])
      : "1h",
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [structureTab, setStructureTab] = useState<StructureTab>("ms");

  const { data, meta, isLoading } = useApi<CryptoDetail>(
    `/api/v1/crypto/${encodeURIComponent(symbol)}?interval=${interval}`,
    { refreshInterval: 20_000 },
  );

  const series = useMemo(() => toBars(data?.klines ?? []), [data?.klines]);
  const orderFlow = useMemo(() => deriveOrderFlow(series), [series]);
  const seriesHigh = useMemo(() => {
    if (!series.length) return null;
    return Math.max(...series.slice(-48).map((b) => b.high));
  }, [series]);
  const seriesLow = useMemo(() => {
    if (!series.length) return null;
    return Math.min(...series.slice(-48).map((b) => b.low));
  }, [series]);

  if (isLoading && !data) return <Loading rows={12} />;
  if (!data) {
    return (
      <Unavailable
        title={`Không lấy được dữ liệu ${symbol}`}
        note="Binance không phản hồi hoặc ký hiệu không tồn tại. Kiểm tra /system."
        meta={meta}
      />
    );
  }

  const t = data.ticker;
  const tech = data.technical;
  const patterns = data.patterns ?? [];
  const price = t.price;
  const digits = priceDigits(price);
  const chg = t.changePercent ?? null;
  const rMin = t.low ?? seriesLow ?? price;
  const rMax = t.high ?? seriesHigh ?? price;
  const rSpan = Math.max(1e-8, rMax - rMin);
  const rangePos = Math.max(0, Math.min(100, ((price - rMin) / rSpan) * 100));
  const fundingRate = data.funding?.fundingRate != null ? data.funding.fundingRate * 100 : null;
  const supports = tech?.support?.slice(0, 3) ?? [];
  const resistances = tech?.resistance?.slice(0, 3) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="panel rounded-xl p-2.5 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <Link
              href="/crypto"
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated/60 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-default hover:text-text-primary"
            >
              <ArrowLeft className="size-3" /> Crypto
            </Link>
            <div className="flex size-7 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-[11px] font-bold text-accent-primary">
              {data.baseAsset.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-[15px] font-bold text-text-primary sm:text-[16px]">
                  {data.baseAsset}
                  <span className="text-[12px] font-normal text-text-muted">/USDT</span>
                </h1>
                <Badge tone="neutral">{data.symbol}</Badge>
                <AddToWatchlist symbol={data.symbol} assetType="crypto" />
              </div>
              <div className="num flex items-baseline gap-2 border-l border-border-subtle pl-2.5">
                <span className="text-[18px] font-bold leading-none text-text-primary sm:text-[20px]">{fmtNum(price, digits)}</span>
                {chg != null && <Chg value={chg} className="text-[12px] font-semibold" />}
                {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-3 lg:flex">
            <div className="w-28">
              <div className="flex justify-between text-[9px] uppercase tracking-wider text-text-muted">
                <span>Range 24h</span>
                <span className="num text-text-primary">{rangePos.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                <div className="h-full rounded-full bg-accent-primary/80" style={{ width: `${rangePos}%` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-text-muted">
                <span className="num">{fmtNum(rMin, digits)}</span>
                <span className="num">{fmtNum(rMax, digits)}</span>
              </div>
            </div>
            {fundingRate != null && (
              <div className="rounded-md border border-border-subtle bg-surface-elevated/50 px-2 py-1 text-center">
                <div className="text-[8.5px] uppercase text-text-muted">Funding</div>
                <div className={`num text-[12px] font-semibold ${fundingRate >= 0 ? "text-positive" : "text-negative"}`}>
                  {fundingRate >= 0 ? "+" : ""}{fundingRate.toFixed(4)}%
                </div>
              </div>
            )}
            {data.openInterest?.openInterest != null && (
              <div className="rounded-md border border-border-subtle bg-surface-elevated/50 px-2 py-1 text-center">
                <div className="text-[8.5px] uppercase text-text-muted">OI</div>
                <div className="num text-[12px] font-semibold text-text-primary">{fmtCompact(data.openInterest.openInterest)}</div>
              </div>
            )}
            {t.quoteVolume != null && (
              <div className="rounded-md border border-border-subtle bg-surface-elevated/50 px-2 py-1 text-center">
                <div className="text-[8.5px] uppercase text-text-muted">Vol 24h</div>
                <div className="num text-[12px] font-semibold text-text-primary">{fmtCompact(t.quoteVolume)}</div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border-subtle/70 pt-2">
          <span className="mr-1 text-[9px] uppercase tracking-wider text-text-muted">Quick</span>
          {QUICK_PAIRS.map((p) => (
            <Link
              key={p}
              href={`/crypto/${p}`}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                p === data.symbol
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "bg-surface-elevated text-text-secondary hover:text-text-primary"
              }`}
            >
              {p.replace("USDT", "")}
            </Link>
          ))}
          <div className="ml-auto flex gap-0.5">
            {INTERVALS.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setInterval(tf)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  interval === tf ? "bg-accent-primary/20 text-accent-primary" : "text-text-muted hover:text-text-primary"
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="xl:hidden">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border-subtle bg-surface-elevated/40 p-1">
          {([["chart", "Chart"], ["desk", "Order flow"], ["scalp", "Scalp"], ["structure", "Cấu trúc"], ["news", "Tin / Tâm lý"]] as const).map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMobileTab(id)}
                className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-[11px] font-medium ${
                  mobileTab === id ? "bg-accent-primary/20 text-accent-primary" : "text-text-secondary"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-2 xl:items-stretch">
        <div className="xl:col-span-3 flex min-h-[560px] flex-col gap-2">
          <FILL className="min-h-0 flex-[1.2]">
            <CryptoTradeDesk symbol={data.symbol} mode="orderflow" />
          </FILL>
          <OrderFlowPanel flow={orderFlow} />
          <LiquidityZonesPanel
            price={price}
            digits={digits}
            supports={supports}
            resistances={resistances}
            seriesLow={seriesLow}
            seriesHigh={seriesHigh}
          />
        </div>
        <div className="xl:col-span-6 flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-primary">
          <OrcaChart symbol={data.symbol} assetType="crypto" defaultTimeframe={interval} height={560} title={`${data.baseAsset}/USDT`} />
        </div>
        <div className="xl:col-span-3 flex min-h-[560px] flex-col gap-2">
          <FILL className="min-h-0 flex-1">
            <ScalpPanel symbol={data.symbol} />
          </FILL>
          <KeyZonesCompact price={price} digits={digits} supports={supports} resistances={resistances} />
          <CryptoTradeDesk symbol={data.symbol} mode="leverage" />
        </div>
      </div>

      <div className="space-y-2 xl:hidden">
        {mobileTab === "chart" && (
          <OrcaChart symbol={data.symbol} assetType="crypto" defaultTimeframe={interval} height={400} title={`${data.baseAsset}/USDT`} />
        )}
        {mobileTab === "desk" && (
          <>
            <CryptoTradeDesk symbol={data.symbol} mode="orderflow" />
            <OrderFlowPanel flow={orderFlow} />
            <LiquidityZonesPanel price={price} digits={digits} supports={supports} resistances={resistances} seriesLow={seriesLow} seriesHigh={seriesHigh} />
          </>
        )}
        {mobileTab === "scalp" && (
          <>
            <ScalpPanel symbol={data.symbol} />
            <KeyZonesCompact price={price} digits={digits} supports={supports} resistances={resistances} />
            <CryptoTradeDesk symbol={data.symbol} mode="leverage" />
          </>
        )}
        {mobileTab === "structure" && (
          <MarketStructurePanel tab={structureTab} onTab={setStructureTab} pair={data.symbol} interval={interval} tech={tech} patterns={patterns} cur={t} series={series} assetType="crypto" />
        )}
        {mobileTab === "news" && (
          <div className="space-y-2">
            <DerivativesStrip fundingRate={fundingRate} oi={data.openInterest?.openInterest ?? null} vol={t.quoteVolume} />
            <CryptoSentimentPanel symbol={data.symbol} ticker={t} tech={tech} />
            <CryptoNewsPanel symbol={data.symbol} base={data.baseAsset} />
          </div>
        )}
      </div>

      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-2 xl:items-stretch">
        <div className="xl:col-span-7 flex min-h-[300px] flex-col">
          <MarketStructurePanel tab={structureTab} onTab={setStructureTab} pair={data.symbol} interval={interval} tech={tech} patterns={patterns} cur={t} series={series} assetType="crypto" />
        </div>
        <div className="xl:col-span-5 flex min-h-[300px] flex-col gap-2">
          <DerivativesStrip fundingRate={fundingRate} oi={data.openInterest?.openInterest ?? null} vol={t.quoteVolume} />
          <div className="grid grid-cols-2 gap-2 min-h-0 flex-1">
            <CryptoSentimentPanel symbol={data.symbol} ticker={t} tech={tech} />
            <CryptoNewsPanel symbol={data.symbol} base={data.baseAsset} />
          </div>
        </div>
      </div>

      {meta && <MetaLine meta={meta} />}
    </div>
  );
}

function DerivativesStrip({ fundingRate, oi, vol }: { fundingRate: number | null; oi: number | null; vol?: number | null }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5 text-[11px]">
          <Percent className="size-3 text-accent-primary" /> Phái sinh & Thanh khoản
        </span>
      }
      right={<span className="text-[9px] text-text-muted">Binance futures</span>}
    >
      <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
        <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1.5">
          <div className="text-[8.5px] uppercase text-text-muted">Funding</div>
          <div className={`num text-[12px] font-semibold ${fundingRate == null ? "text-text-muted" : fundingRate >= 0 ? "text-positive" : "text-negative"}`}>
            {fundingRate != null ? `${fundingRate >= 0 ? "+" : ""}${fundingRate.toFixed(4)}%` : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1.5">
          <div className="text-[8.5px] uppercase text-text-muted">Open Interest</div>
          <div className="num text-[12px] font-semibold text-text-primary">{oi != null ? fmtCompact(oi) : "—"}</div>
        </div>
        <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1.5">
          <div className="text-[8.5px] uppercase text-text-muted">Quote Vol</div>
          <div className="num text-[12px] font-semibold text-text-primary">{vol != null ? fmtCompact(vol) : "—"}</div>
        </div>
      </div>
    </Panel>
  );
}

function CryptoSentimentPanel({ symbol, ticker, tech }: { symbol: string; ticker: CryptoMarketRow; tech: TechnicalSnapshot | null }) {
  const fallback = useMemo(() => computeLocalSentiment(ticker, tech), [ticker, tech]);
  const { data, meta, isLoading } = useApi<SentimentApi>(
    `/api/v1/sentiment?assetType=crypto&symbol=${encodeURIComponent(symbol)}`,
    { refreshInterval: 90_000 },
  );
  const quant = data?.quant ?? fallback;
  const llm = data?.llm ?? null;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Brain className="size-3.5 text-accent-primary" /> Tâm lý & AI
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <Badge tone={quant.tone}>
          {quant.label} ({quant.score > 0 ? "+" : ""}{quant.score})
        </Badge>
      }
    >
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-[9px] text-text-muted">
            <span>Bearish</span><span>Neutral</span><span>Bullish</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-background-secondary">
            <div className="absolute top-0 h-full w-1 rounded-full bg-accent-primary" style={{ left: `${Math.min(100, Math.max(0, 50 + quant.score / 2))}%` }} />
          </div>
        </div>
        <ul className="space-y-0.5 text-[10.5px] text-text-secondary">
          {quant.factors.slice(0, 4).map((f, i) => (
            <li key={i} className="flex gap-1">
              <span className="text-text-muted">{f.w > 0 ? "+" : "−"}</span>
              <span className="line-clamp-1">{f.text}</span>
            </li>
          ))}
        </ul>
        {isLoading && !data && <p className="text-[10px] text-text-muted">Đang tải quant…</p>}
        {llm?.narrative && (
          <p className="border-t border-border-subtle/60 pt-1.5 text-[10.5px] leading-relaxed text-text-secondary line-clamp-3">{llm.narrative}</p>
        )}
      </div>
    </Panel>
  );
}

function CryptoNewsPanel({ symbol, base }: { symbol: string; base: string }) {
  const q = encodeURIComponent(`${base} OR ${symbol} crypto`);
  const { data, isLoading } = useApi<NewsPayload>(`/api/v1/news?q=${q}&limit=6`, { refreshInterval: 300_000 });
  const articles = data?.articles ?? [];
  return (
    <Panel title={<span className="flex items-center gap-2"><Newspaper className="size-3.5 text-accent-primary" /> Tin crypto</span>}>
      {isLoading && !articles.length && <Loading rows={2} />}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {articles.slice(0, 6).map((a, i) => (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 rounded-md border border-border-subtle/40 bg-surface-elevated/20 px-2 py-1 text-[10.5px] text-text-secondary transition-colors hover:border-border-default hover:text-text-primary">
            <ExternalLink className="mt-0.5 size-3 shrink-0 text-text-muted" />
            <span className="line-clamp-2 flex-1">{a.title}</span>
          </a>
        ))}
        {!isLoading && !articles.length && <p className="text-[11px] text-text-muted">Chưa có tin liên quan.</p>}
      </div>
    </Panel>
  );
}

function computeLocalSentiment(t: { changePercent?: number | null; price?: number }, tech: TechnicalSnapshot | null) {
  let score = 0;
  const factors: { w: number; text: string }[] = [];
  const chg = t.changePercent;
  if (chg != null) {
    const w = Math.max(-30, Math.min(30, chg * 4));
    score += w;
    factors.push({ w, text: `Biến động phiên ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` });
  }
  if (tech?.rsi14 != null) {
    if (tech.rsi14 > 70) {
      score -= 12;
      factors.push({ w: -12, text: `RSI cao (${tech.rsi14.toFixed(0)}) — quá mua` });
    } else if (tech.rsi14 < 30) {
      score += 12;
      factors.push({ w: 12, text: `RSI thấp (${tech.rsi14.toFixed(0)}) — quá bán` });
    } else {
      factors.push({ w: 0, text: `RSI trung tính (${tech.rsi14.toFixed(0)})` });
    }
  }
  if (tech?.trend?.label) {
    const label = tech.trend.label;
    if (/up|bull/i.test(label)) {
      score += 10;
      factors.push({ w: 10, text: `Trend: ${label}` });
    } else if (/down|bear/i.test(label)) {
      score -= 10;
      factors.push({ w: -10, text: `Trend: ${label}` });
    }
  }
  score = Math.max(-100, Math.min(100, Math.round(score)));
  const label = score >= 20 ? "Bullish" : score <= -20 ? "Bearish" : "Neutral";
  const tone = score >= 20 ? ("up" as const) : score <= -20 ? ("down" as const) : ("neutral" as const);
  return { score, label, tone, factors };
}
