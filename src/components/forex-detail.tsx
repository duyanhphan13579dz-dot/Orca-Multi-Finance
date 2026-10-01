"use client";

/**
 * FOREX QUANT TERMINAL — Professional 3-Column Trading Cockpit & Maximum Information Density.
 * Structured identically to Crypto:
 *   - Top: High-Density Sticky Pro Ticker Bar (Pair, Price, 24h Stats, Spread, 24h Range Bar, Global Sessions, Quick Pairs)
 *   - Main 3-Column Stage (Desktop XL, clean natural flow, zero overlap):
 *       Col 1 (~25%): Bàn tính Vị thế & Thanh khoản Forex (Bid/Ask, Pip Value, Margin Calculator, Global Sessions)
 *       Col 2 (~50%): Biểu đồ nến chính (OrcaChart K-lines) có isolator chống tràn
 *       Col 3 (~25%): Radar Scalping & Quản trị rủi ro Forex (ForexScalpPanel)
 *   - Bottom Analysis Deck (Desktop XL, 3 balanced columns, 100% space filled):
 *       Col 1 (~33.3%): Phân tích kỹ thuật (Momentum, Đường trung bình, Hiệu suất, Vùng Hỗ trợ / Kháng cự, Floor Pivot Points)
 *       Col 2 (~33.3%): Mẫu hình nến Nhật nhận diện, Phân kỳ kỹ thuật, Cấu trúc sóng & Volume/Price Confluence
 *       Col 3 (~33.3%): Tâm lý thị trường ngoại hối (Quant & AI Narrative) + Luồng tin tức vĩ mô Ngân hàng Trung ương
 *   - Mobile/Tablet: Thanh chuyển Tab thông minh (Biểu đồ / Tính vị thế / Scalp radar / Phân tích & Tin)
 * Colors: Preserves 100% template color tokens and typography.
 */
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, ForexRow, NewsArticle, OhlcvBar, TechnicalSnapshot } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel, PatternsAndDivergencePanel } from "@/components/technical-panel";
import { ForexScalpPanel } from "@/components/forex-scalp-panel";
import { ForexTradeDesk } from "@/components/forex-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { Brain, ExternalLink, ArrowLeft, BarChart2, BookOpen, Zap, Compass, Newspaper, Radio, Clock, Globe } from "lucide-react";

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

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;
const QUICK_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
  "USDCHF",
  "EURGBP",
  "NZDUSD",
] as const;

type MobileTab = "chart" | "desk" | "scalp" | "analytics";

export function ForexDetailPage({ pair }: { pair: string }) {
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("1d");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");

  const { data, meta, isLoading } = useApi<ForexDetail>(`/api/v1/forex/${pair}`, { refreshInterval: 120_000 });

  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) return <Unavailable title={`Không lấy được dữ liệu cặp ${pair}`} meta={meta} />;

  const cur = data.current;
  const price = cur?.price ?? data.series[data.series.length - 1]?.close ?? null;
  const tech = data.technical;
  const patterns = data.patterns ?? [];
  const digits = price != null ? priceDigits(price) : 4;
  const chg = cur?.changePercent ?? 0;

  // 24h Range Bar calculation
  const rMin = cur?.low ?? (price ? price * 0.995 : 1);
  const rMax = cur?.high ?? (price ? price * 1.005 : 1);
  const rSpan = Math.max(1e-6, rMax - rMin);
  const rangePos = price ? Math.max(0, Math.min(100, ((price - rMin) / rSpan) * 100)) : 50;

  return (
    <div className="flex flex-col gap-3">
      {/* High-Density Top Sticky Ticker Header */}
      <div className="panel rounded-xl p-3 sm:p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Symbol & Price Lockup */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <Link
              href="/forex"
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated/60 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-default hover:text-text-primary"
              title="Về bảng giá thị trường Ngoại hối"
            >
              <ArrowLeft className="size-3" /> Thị trường
            </Link>

            <div className="flex size-7.5 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-[12px] font-bold text-accent-primary">
              {data.base}
            </div>

            <div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-[15px] font-bold text-text-primary sm:text-[17px]">
                  {data.base}
                  <span className="text-[12px] font-normal text-text-muted">/{data.quote}</span>
                </h1>
                <Badge tone="accent">{pair}</Badge>
                {cur?.group && <Badge tone="neutral">{cur.group.toUpperCase()}</Badge>}
                <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
                <AddToWatchlist assetType="forex" symbol={pair} />
              </div>
            </div>

            {price != null && (
              <div className="num flex items-baseline gap-2 border-l border-border-subtle pl-2.5 sm:pl-3">
                <span className="text-[19px] font-bold leading-none text-text-primary sm:text-[22px]">
                  {price >= 1000
                    ? price.toLocaleString("vi-VN", { maximumFractionDigits: 0 })
                    : price >= 100
                      ? price.toFixed(2)
                      : price.toFixed(4)}
                </span>
                <Chg value={chg} className="text-[12px] font-semibold" />
              </div>
            )}
          </div>

          {/* High-Density 24h Stats Desktop Strip */}
          <div className="hidden items-center gap-3.5 xl:flex">
            <HeadStat
              label="Cao 24h"
              value={cur?.high != null ? (cur.high >= 100 ? cur.high.toFixed(2) : cur.high.toFixed(4)) : "—"}
            />
            <div className="h-4 w-px bg-border-subtle" />
            <HeadStat
              label="Thấp 24h"
              value={cur?.low != null ? (cur.low >= 100 ? cur.low.toFixed(2) : cur.low.toFixed(4)) : "—"}
            />
            <div className="h-4 w-px bg-border-subtle" />

            {/* 24h Range Progress Bar */}
            <div>
              <div className="flex justify-between text-[9px] uppercase tracking-wider text-text-muted">
                <span>Vị thế 24h</span>
                <span className="num text-text-primary">{rangePos.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-elevated">
                <div className="h-full bg-accent-primary transition-all duration-300" style={{ width: `${rangePos}%` }} />
              </div>
            </div>
            <div className="h-4 w-px bg-border-subtle" />

            {/* Session Indicator */}
            <div>
              <div className="text-[9px] uppercase tracking-wider text-text-muted">Phiên Giao Dịch</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-positive">
                <span className="size-1.5 rounded-full bg-positive animate-pulse" />
                <span>Thị trường Forex 24/5</span>
              </div>
            </div>
          </div>

          {/* Timeframe & Meta */}
          <div className="flex items-center gap-2">
            <div className="seg">
              {INTERVALS.map((x) => (
                <button
                  key={x}
                  type="button"
                  data-active={interval === x}
                  onClick={() => setInterval(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <MetaLine meta={meta} />
          </div>
        </div>

        {/* Quick pair rail */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle/70 pt-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">Cặp phổ biến:</span>
            {QUICK_PAIRS.map((sym) => {
              const isCurrent = sym === pair;
              const formatted = sym.length === 6 ? `${sym.slice(0, 3)}/${sym.slice(3)}` : sym;
              return (
                <Link
                  key={sym}
                  href={`/forex/${sym}`}
                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    isCurrent
                      ? "border-accent-primary/60 bg-accent-primary/15 font-semibold text-accent-primary"
                      : "border-border-subtle bg-surface-elevated/40 text-text-secondary hover:border-border-default hover:text-text-primary"
                  }`}
                >
                  {formatted}
                </Link>
              );
            })}
          </div>

          {cur?.high != null && cur?.low != null && (
            <div className="flex items-center gap-3 text-[10.5px] text-text-muted xl:hidden">
              <span>Cao: <strong className="num text-text-primary">{cur.high.toFixed(4)}</strong></span>
              <span>Thấp: <strong className="num text-text-primary">{cur.low.toFixed(4)}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Tab Control for screens < 1280px */}
      <div className="xl:hidden">
        <div className="seg-scroll">
          <div className="seg w-full justify-between" role="tablist">
            <button
              type="button"
              data-active={mobileTab === "chart"}
              onClick={() => setMobileTab("chart")}
              className="flex-1 text-center"
            >
              <BarChart2 className="mr-1 inline size-3.5" /> Biểu đồ
            </button>
            <button
              type="button"
              data-active={mobileTab === "desk"}
              onClick={() => setMobileTab("desk")}
              className="flex-1 text-center"
            >
              <BookOpen className="mr-1 inline size-3.5" /> Tính vị thế
            </button>
            <button
              type="button"
              data-active={mobileTab === "scalp"}
              onClick={() => setMobileTab("scalp")}
              className="flex-1 text-center"
            >
              <Zap className="mr-1 inline size-3.5" /> Scalp radar
            </button>
            <button
              type="button"
              data-active={mobileTab === "analytics"}
              onClick={() => setMobileTab("analytics")}
              className="flex-1 text-center"
            >
              <Compass className="mr-1 inline size-3.5" /> Phân tích & Tin
            </button>
          </div>
        </div>
      </div>

      {/* DESKTOP 3-COLUMN TRADING COCKPIT (Clean natural flow, zero overlap) */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-3 xl:items-start">
        {/* Column 1: Forex Liquidity & Position Calculator Desk (~25%) */}
        <div className="xl:col-span-3 flex flex-col">
          <ForexTradeDesk
            pair={pair}
            base={data.base}
            quote={data.quote}
            price={price}
            changePercent={chg}
          />
        </div>

        {/* Column 2: Main Candlestick Chart (~50%) */}
        <div className="xl:col-span-6 flex flex-col overflow-hidden rounded-xl">
          <OrcaChart
            symbol={pair}
            assetType="forex"
            defaultTimeframe={interval}
            height={420}
            title={`${data.base}/${data.quote}`}
          />
        </div>

        {/* Column 3: Forex Scalp Radar & Setup (~25%) */}
        <div className="xl:col-span-3 flex flex-col">
          <ForexScalpPanel pair={pair} />
        </div>
      </div>

      {/* MOBILE / TABLET VIEW CONTENT */}
      <div className="space-y-3 xl:hidden">
        {mobileTab === "chart" && (
          <OrcaChart
            symbol={pair}
            assetType="forex"
            defaultTimeframe={interval}
            height={400}
            title={`${data.base}/${data.quote}`}
          />
        )}

        {mobileTab === "desk" && (
          <ForexTradeDesk
            pair={pair}
            base={data.base}
            quote={data.quote}
            price={price}
            changePercent={chg}
          />
        )}

        {mobileTab === "scalp" && (
          <ForexScalpPanel pair={pair} />
        )}

        {mobileTab === "analytics" && (
          <div className="space-y-3">
            <TechnicalPanel tech={tech} patterns={patterns} ticker={cur} variant="compact" />
            <PatternsAndDivergencePanel tech={tech} patterns={patterns} />
            <SentimentPanelCompact pair={pair} current={cur} tech={tech} />
            <ForexNewsPanel pair={pair} base={data.base} quote={data.quote} />
          </div>
        )}
      </div>

      {/* BOTTOM ANALYTICS DECK (Desktop 3 Columns, balanced height, 100% space filled) */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-3 xl:items-start">
        {/* Column 1: Core Technical Indicators & Floor Pivots (~33.3%) */}
        <div className="xl:col-span-4 flex flex-col">
          <TechnicalPanel tech={tech} patterns={patterns} ticker={cur} variant="compact" />
        </div>

        {/* Column 2: Candlestick Patterns & Divergences (~33.3%) */}
        <div className="xl:col-span-4 flex flex-col">
          <PatternsAndDivergencePanel tech={tech} patterns={patterns} />
        </div>

        {/* Column 3: Forex Sentiment & Macro News (~33.3%) */}
        <div className="xl:col-span-4 flex flex-col gap-3">
          <SentimentPanelCompact pair={pair} current={cur} tech={tech} />
          <ForexNewsPanel pair={pair} base={data.base} quote={data.quote} />
        </div>
      </div>

      {data.referenceNote && (
        <div>
          <p className="rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-2 text-[10.5px] leading-relaxed text-text-muted">
            {data.referenceNote}
          </p>
        </div>
      )}
    </div>
  );
}

const SentimentPanelCompact = memo(function SentimentPanelCompact({
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

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Brain className="size-4 text-accent-primary" /> Tâm lý thị trường & AI Narrative
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <Badge tone={quant.tone}>
          {quant.label} ({quant.score > 0 ? "+" : ""}
          {quant.score})
        </Badge>
      }
    >
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-[9.5px] text-text-muted">
            <span>Bi quan (Bearish)</span>
            <span>Cân bằng</span>
            <span>Lạc quan (Bullish)</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-background-secondary">
            <div className="absolute inset-0 bg-gradient-to-r from-negative/50 via-warning/40 to-positive/50 opacity-70" />
            <div
              className="absolute top-0 bottom-0 w-1.5 rounded-full bg-text-primary shadow"
              style={{ left: `${Math.max(2, Math.min(98, 50 + quant.score / 2))}%`, transform: "translateX(-50%)" }}
            />
          </div>
        </div>

        <ul className="space-y-0.5 text-[11px] leading-snug text-text-secondary">
          {quant.factors.slice(0, 4).map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className={f.w >= 0 ? "text-positive" : "text-negative"}>•</span>
              <span className="line-clamp-1">{f.text}</span>
            </li>
          ))}
        </ul>

        {isLoading && !data && <p className="text-[10px] text-text-muted">Đang tải diễn giải AI…</p>}
        {llm?.narrative && (
          <p className="line-clamp-2 text-[10.5px] leading-relaxed text-text-secondary border-t border-border-subtle/50 pt-1.5">
            {llm.narrative}
          </p>
        )}
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
    } else {
      factors.push({ w: 0, text: `RSI ${tech.rsi14.toFixed(0)} — vùng cân bằng` });
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
    factors.push({ w, text: `Trend: ${tech.trend.label} (${tech.trend.score})` });
  }
  if (tech?.sma?.sma50 != null && t.price != null && t.price > 0) {
    if (t.price < (tech.sma?.sma50 ?? 0)) {
      score -= 10;
      factors.push({ w: -1, text: "Giá dưới SMA50 — cấu trúc trung hạn suy yếu" });
    } else {
      score += 8;
      factors.push({ w: 1, text: "Giá trên SMA50 — cấu trúc trung hạn hỗ trợ" });
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
    const keys = [pair, base, quote, `${base}/${quote}`, `${base}${quote}`, "USD", "FED", "ECB", "BOJ"].map((s) =>
      s.toUpperCase(),
    );
    const related = list.filter((a) => {
      const title = a.title.toUpperCase();
      const summary = (a.summary ?? "").toUpperCase();
      const syms = (a.relatedSymbols ?? []).map((s) => s.toUpperCase());
      return keys.some((k) => title.includes(k) || summary.includes(k) || syms.some((s) => s.includes(k)));
    });
    return (related.length ? related : list).slice(0, 4);
  }, [data, pair, base, quote]);

  return (
    <Panel
      className="h-full flex flex-col justify-between"
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-accent-primary" /> Luồng tin tức vĩ mô & NHTW
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <div className="flex items-center gap-1 text-[10px] text-text-muted">
          <Radio className="size-3 text-positive animate-pulse" /> Live Macro
        </div>
      }
    >
      <div className="flex-1 flex flex-col justify-between space-y-2.5">
        {/* Macro Structure Box */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="panel-inset p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-text-muted block">Ngân Hàng Trung Ương</span>
            <strong className="num text-[11px] font-semibold text-text-primary">Fed vs ECB / BOJ</strong>
          </div>
          <div className="panel-inset p-1.5">
            <span className="text-[8.5px] uppercase tracking-wider text-text-muted block">Chính Sách Lãi Suất</span>
            <strong className="num text-[11px] font-semibold text-accent-primary">Kỳ Vọng Diều Hâu</strong>
          </div>
        </div>

        {/* Articles List */}
        {isLoading && !data ? (
          <Loading rows={3} />
        ) : articles.length > 0 ? (
          <ul className="space-y-1.5 overflow-y-auto max-h-[190px]">
            {articles.map((a) => (
              <li
                key={a.id || a.url}
                className="rounded-md border border-border-subtle bg-surface-elevated/30 px-2 py-1.5 transition-colors hover:bg-surface-elevated"
              >
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-1.5 text-[11px] font-medium leading-snug text-text-primary hover:text-accent-primary"
                >
                  <span className="line-clamp-2 flex-1">{a.title}</span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-40 group-hover:opacity-80" />
                </a>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-text-muted">
                  <span className="text-accent-primary/80">{a.source}</span>
                  <span>·</span>
                  <span>{formatAge(a.publishedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-1.5">
            <div className="panel-inset p-2">
              <div className="text-[9.5px] uppercase tracking-wider text-text-muted">Tổng quan thanh khoản cặp tiền</div>
              <div className="mt-1 text-[11px] text-text-secondary">
                Cặp tiền thanh khoản cao, giao dịch sôi động nhất trong phiên London (14h-23h VN) và New York (19h-04h VN).
              </div>
            </div>
            <div className="panel-inset p-2">
              <div className="text-[9.5px] uppercase tracking-wider text-text-muted">Lịch công bố kinh tế</div>
              <div className="mt-1 text-[11px] text-text-muted">
                Theo dõi chỉ số CPI, Non-Farm Payrolls (NFP) và quyết định lãi suất FOMC.
              </div>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border-subtle bg-surface-elevated/40 p-1.5 text-[9.5px] text-text-muted flex items-center justify-between">
          <span>Nguồn: Reuters, Bloomberg, FXStreet & CafeF</span>
          <span className="text-accent-primary">Cập nhật liên tục</span>
        </div>
      </div>
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

function HeadStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="num text-[12px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
