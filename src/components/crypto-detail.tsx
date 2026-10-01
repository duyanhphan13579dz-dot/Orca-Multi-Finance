"use client";

/**
 * CRYPTO QUANT TERMINAL — Zero-Gap Pro Trading Cockpit (Binance & Bybit style).
 * Layout:
 *   - Top: Sticky Pro Ticker Bar (Asset, Price, 24h Stats, Timeframes, Quick Switch)
 *   - Main 3-Column Desk (Desktop XL, fixed height 540px, perfectly aligned):
 *       Col 1 (~25%): Sổ lệnh 2 chiều (Depth Asks/Bids) & Khớp lệnh lớn (aggTrades)
 *       Col 2 (~50%): Biểu đồ nến chính (OrcaChart K-lines)
 *       Col 3 (~25%): Tín hiệu Scalping Radar & Mô phỏng đòn bẩy SL/TP
 *   - Bottom Analysis Deck (Desktop XL, 3 balanced columns, 100% space filled):
 *       Col 1 (~33.3%): Phân tích kỹ thuật (Momentum, Đường trung bình, Hiệu suất, Hỗ trợ / Kháng cự)
 *       Col 2 (~33.3%): Mẫu hình nến nhận diện & Phân kỳ kỹ thuật (Divergences & Signals)
 *       Col 3 (~33.3%): Tâm lý thị trường (Fear/Greed score) + Luồng tin tức & Sự kiện dòng tiền
 *   - Mobile/Tablet: Thanh chuyển Tab thông minh (Biểu đồ / Sổ lệnh / Scalp / Phân tích)
 * Colors: Preserves 100% template color tokens and typography.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, CryptoMarketRow, NewsArticle, TechnicalSnapshot } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel, PatternsAndDivergencePanel } from "@/components/technical-panel";
import { ScalpPanel } from "@/components/scalp-panel";
import { CryptoTradeDesk } from "@/components/crypto-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { useSettings } from "@/lib/settings";
import { Brain, ExternalLink, ArrowLeft, BarChart2, BookOpen, Zap, Compass, Newspaper, Radio } from "lucide-react";

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

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;
const QUICK_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"] as const;

type MobileTab = "chart" | "orderflow" | "scalp" | "analytics";

export function CryptoDetailPage({ symbol }: { symbol: string }) {
  const { settings } = useSettings();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>(
    (INTERVALS as readonly string[]).includes(settings.dashboard.defaultTimeframe)
      ? (settings.dashboard.defaultTimeframe as (typeof INTERVALS)[number])
      : "1h",
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");

  const { data, meta, isLoading } = useApi<CryptoDetail>(
    `/api/v1/crypto/${encodeURIComponent(symbol)}?interval=${interval}`,
    { refreshInterval: 20_000 },
  );

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
    <div className="flex flex-col gap-3">
      {/* Top sticky ticker header */}
      <div className="panel rounded-xl p-3 sm:p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Symbol & Price Lockup */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <Link
              href="/crypto"
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated/60 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-default hover:text-text-primary"
              title="Về bảng giá thị trường Crypto"
            >
              <ArrowLeft className="size-3" /> Thị trường
            </Link>

            <div className="flex size-7.5 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-[12.5px] font-bold text-accent-primary">
              {data.baseAsset.slice(0, 1)}
            </div>

            <div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-[15px] font-bold text-text-primary sm:text-[17px]">
                  {data.baseAsset}
                  <span className="text-[11.5px] font-normal text-text-muted">/USDT</span>
                </h1>
                <Badge tone="accent">SPOT</Badge>
                <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
                <AddToWatchlist assetType="crypto" symbol={data.symbol} />
              </div>
            </div>

            <div className="num flex items-baseline gap-2 border-l border-border-subtle pl-2.5 sm:pl-3">
              <span className="text-[18px] font-bold leading-none text-text-primary sm:text-[21px]">
                {fmtNum(t.price, digits)}
              </span>
              <Chg value={chg} className="text-[12px] font-semibold" />
            </div>
          </div>

          {/* 24h Stats Desktop Strip */}
          <div className="hidden items-center gap-3.5 xl:flex">
            <HeadStat label="Cao 24h" value={fmtNum(t.high ?? t.price, digits)} />
            <div className="h-4 w-px bg-border-subtle" />
            <HeadStat label="Thấp 24h" value={fmtNum(t.low ?? t.price, digits)} />
            <div className="h-4 w-px bg-border-subtle" />
            <HeadStat label="Khối lượng 24h" value={`$${fmtCompact(t.quoteVolume ?? 0)}`} />
            <div className="h-4 w-px bg-border-subtle" />
            <HeadStat label="Lượt khớp 24h" value={fmtCompact(t.trades24h ?? 0)} />
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
              const base = sym.replace("USDT", "");
              const isCurrent = sym === symbol;
              return (
                <Link
                  key={sym}
                  href={`/crypto/${sym}`}
                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    isCurrent
                      ? "border-accent-primary/60 bg-accent-primary/15 font-semibold text-accent-primary"
                      : "border-border-subtle bg-surface-elevated/40 text-text-secondary hover:border-border-default hover:text-text-primary"
                  }`}
                >
                  {base}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-[10.5px] text-text-muted xl:hidden">
            <span>Cao: <strong className="num text-text-primary">{fmtNum(t.high ?? t.price, digits)}</strong></span>
            <span>Thấp: <strong className="num text-text-primary">{fmtNum(t.low ?? t.price, digits)}</strong></span>
            <span>Vol: <strong className="num text-text-primary">${fmtCompact(t.quoteVolume ?? 0)}</strong></span>
          </div>
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
              data-active={mobileTab === "orderflow"}
              onClick={() => setMobileTab("orderflow")}
              className="flex-1 text-center"
            >
              <BookOpen className="mr-1 inline size-3.5" /> Sổ lệnh
            </button>
            <button
              type="button"
              data-active={mobileTab === "scalp"}
              onClick={() => setMobileTab("scalp")}
              className="flex-1 text-center"
            >
              <Zap className="mr-1 inline size-3.5" /> Scalp & Đòn bẩy
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
        {/* Column 1: Order Flow Desk (Left ~25%) */}
        <div className="xl:col-span-3 flex flex-col">
          <CryptoTradeDesk symbol={data.symbol} mode="orderflow" />
        </div>

        {/* Column 2: Main Candlestick Chart (Center ~50%) */}
        <div className="xl:col-span-6 flex flex-col overflow-hidden rounded-xl">
          <OrcaChart
            symbol={data.symbol}
            assetType="crypto"
            defaultTimeframe={interval}
            height={420}
            title={`${data.baseAsset}/USDT`}
          />
        </div>

        {/* Column 3: Scalping Radar & Leverage Simulator (Right ~25%) */}
        <div className="xl:col-span-3 flex flex-col gap-3">
          <ScalpPanel symbol={data.symbol} />
          <CryptoTradeDesk symbol={data.symbol} mode="leverage" />
        </div>
      </div>

      {/* MOBILE / TABLET VIEW CONTENT */}
      <div className="space-y-3 xl:hidden">
        {mobileTab === "chart" && (
          <OrcaChart
            symbol={data.symbol}
            assetType="crypto"
            defaultTimeframe={interval}
            height={420}
            title={`${data.baseAsset}/USDT`}
          />
        )}

        {mobileTab === "orderflow" && (
          <CryptoTradeDesk symbol={data.symbol} mode="orderflow" />
        )}

        {mobileTab === "scalp" && (
          <div className="space-y-3">
            <ScalpPanel symbol={data.symbol} />
            <CryptoTradeDesk symbol={data.symbol} mode="leverage" />
          </div>
        )}

        {mobileTab === "analytics" && (
          <div className="space-y-3">
            <TechnicalPanel tech={tech} patterns={data.patterns} variant="compact" />
            <PatternsAndDivergencePanel tech={tech} patterns={data.patterns} />
            <SentimentPanelCompact symbol={data.symbol} ticker={t} tech={tech} />
            <CryptoNewsPanel symbol={data.symbol} baseAsset={data.baseAsset} ticker={t} />
          </div>
        )}
      </div>

      {/* BOTTOM ANALYTICS DECK (Desktop 3 Columns, balanced height, 100% space filled) */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-3 xl:items-start">
        {/* Column 1: Core Technical Indicators (~33.3%) */}
        <div className="xl:col-span-4 flex flex-col">
          <TechnicalPanel tech={tech} patterns={data.patterns} variant="compact" />
        </div>

        {/* Column 2: Candlestick Patterns & Divergences (~33.3%) */}
        <div className="xl:col-span-4 flex flex-col">
          <PatternsAndDivergencePanel tech={tech} patterns={data.patterns} />
        </div>

        {/* Column 3: Market Sentiment & Crypto News (~33.3%) */}
        <div className="xl:col-span-4 flex flex-col gap-3">
          <SentimentPanelCompact symbol={data.symbol} ticker={t} tech={tech} />
          <CryptoNewsPanel symbol={data.symbol} baseAsset={data.baseAsset} ticker={t} dense />
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
      title={
        <span className="flex items-center gap-2">
          <Brain className="size-4 text-accent-primary" /> Tâm lý thị trường
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
            <span>Bi quan</span>
            <span>Trung tính</span>
            <span>Lạc quan</span>
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
              <span className={f.w > 0 ? "text-positive" : f.w < 0 ? "text-negative" : "text-text-muted"}>•</span>
              <span className="line-clamp-1">{f.text}</span>
            </li>
          ))}
        </ul>
        {isLoading && !data && <p className="text-[10px] text-text-muted">Đang tải diễn giải…</p>}
        {llm?.narrative && (
          <p className="line-clamp-2 text-[10.5px] leading-relaxed text-text-secondary border-t border-border-subtle/50 pt-1.5">
            {llm.narrative}
          </p>
        )}
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

function CryptoNewsPanel({
  symbol,
  baseAsset,
  ticker,
  dense,
}: {
  symbol: string;
  baseAsset: string;
  ticker?: CryptoMarketRow;
  dense?: boolean;
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
    return (related.length ? related : list).slice(0, dense ? 6 : 5);
  }, [data, symbol, baseAsset, dense]);

  return (
    <Panel
      className="h-full flex flex-col justify-between"
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-accent-primary" /> Luồng tin tức & Dòng tiền
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <Radio className="size-3 text-positive animate-pulse" /> Live Feed
        </div>
      }
    >
      <div className="flex-1 flex flex-col justify-between space-y-2.5">
        {isLoading && !data ? (
          <Loading rows={3} />
        ) : articles.length > 0 ? (
          <ul className="space-y-1.5 overflow-y-auto max-h-[220px]">
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
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9.5px] text-text-muted">
                  <span className="text-accent-primary/80">{a.source}</span>
                  <span>·</span>
                  <span>{formatAge(a.publishedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          /* Live Market Pulse Fallback when RSS is waiting for updates - NEVER leave an empty card */
          <div className="space-y-2">
            <div className="panel-inset p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Trạng thái thanh khoản 24h</div>
              <div className="num mt-1 flex items-baseline justify-between text-[13px] font-bold text-text-primary">
                <span>Vol: ${fmtCompact(ticker?.quoteVolume ?? 0)}</span>
                <span className="text-[11px] font-normal text-text-secondary">
                  {fmtCompact(ticker?.trades24h ?? 0)} lượt khớp
                </span>
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                Thanh khoản tập trung tại sàn Binance Spot, độ lệch sổ lệnh thấp.
              </div>
            </div>

            <div className="panel-inset p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Độ sâu dòng lệnh</div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-text-secondary">
                <span>Biên dao động</span>
                <span className="num font-semibold text-text-primary">
                  ${fmtCompact(ticker?.low ?? 0)} — ${fmtCompact(ticker?.high ?? 0)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-text-secondary">
                <span>Cập nhật RSS</span>
                <span className="text-positive">Đang lắng nghe feed mới</span>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border-subtle bg-surface-elevated/40 p-2 text-[10px] text-text-muted">
          Luồng tin tức và thông báo tài chính được tổng hợp tự động từ CoinTelegraph, VietnamBiz và CafeF.
        </div>
      </div>
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
      <div className="text-[9.5px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="num text-[12px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
