use client

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

  const { data, meta, error, loading, refresh } = useApi<{ detail: CryptoDetail }>(
    `/api/v1/crypto/${encodeURIComponent(symbol)}?interval=${interval}`,
  );

  if (loading && !data) return <Loading label={`Đang tải ${symbol}…`} />;
  if (error && !data) return <Unavailable title={symbol} detail={error} onRetry={refresh} />;
  if (!data) return <Unavailable title={symbol} detail="Không có dữ liệu" onRetry={refresh} />;

  const d = data.detail;
  const t = d.ticker;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-ink-1">{d.baseAsset || symbol}</h1>
              <Badge>{d.symbol}</Badge>
              <FreshnessDot meta={meta} />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="num text-2xl font-semibold text-ink-1">{fmtNum(t.price, priceDigits(t.price))}</span>
              <Chg value={t.changePercent} />
            </div>
            <MetaLine meta={meta} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AddToWatchlist symbol={d.symbol} assetType="crypto" />
            <div className="flex rounded-lg border border-border-subtle p-0.5">
              {INTERVALS.map((iv) => (
                <button
                  key={iv}
                  type="button"
                  onClick={() => setInterval(iv)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    interval === iv ? "bg-accent-primary/15 text-accent-primary" : "text-text-muted hover:text-ink-1"
                  }`}
                >
                  {iv}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <OrcaChart
              symbol={d.symbol}
              interval={interval}
              assetType="crypto"
              height={360}
            />
          </Panel>
          <TechnicalPanel tech={d.technical} patterns={d.patterns} />
          <ScalpPanel symbol={d.symbol} assetType="crypto" interval={interval} />
        </div>
        <div className="space-y-4">
          <CryptoTradeDesk symbol={d.symbol} ticker={t} funding={d.funding} openInterest={d.openInterest} />
          <SentimentPanel symbol={d.symbol} ticker={t} tech={d.technical} />
          <NewsPanel symbol={d.symbol} />
        </div>
      </div>
    </div>
  );
}

function SentimentPanel({ symbol, ticker, tech }: { symbol: string; ticker: CryptoMarketRow; tech: TechnicalSnapshot | null }) {
  const { data, loading } = useApi<SentimentApi>(`/api/v1/sentiment?asset=crypto&symbol=${encodeURIComponent(symbol)}`);
  const quant = data?.quant;
  const llm = data?.llm;
  const llmStatus = data?.llmStatus;

  return (
    <Panel>
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-2">
        <Brain className="size-3.5 text-accent-primary" />
        Sentiment
      </div>
      {loading && !data ? (
        <Loading label="Đang chấm điểm…" />
      ) : quant ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">Quant score</span>
            <Badge tone={quant.tone === "up" ? "up" : quant.tone === "down" ? "down" : "neutral"}>{quant.label}</Badge>
          </div>
          <div className="num text-xl font-semibold text-ink-1">{quant.score}</div>
          <ul className="space-y-1">
            {quant.factors.slice(0, 4).map((f, i) => (
              <li key={i} className="text-[11px] text-text-secondary">
                {f.text}
              </li>
            ))}
          </ul>
          {llm && (
            <div className="mt-2 rounded-lg border border-border-subtle bg-surface-elevated p-2.5 text-[12px] text-text-secondary">
              <div className="mb-1 text-[10px] text-text-muted">LLM · {llm.model}</div>
              {llm.narrative}
            </div>
          )}
          {!llm && llmStatus === "skipped" && (
            <p className="text-[10px] text-text-muted">LLM chưa bật (OPENROUTER_API_KEY) — chỉ điểm quant.</p>
          )}
          {!llm && (llmStatus === "unavailable" || llmStatus === "failed") && (
            <p className="text-[10px] text-text-muted">LLM tạm không phản hồi — giữ điểm quant.</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">Chưa có sentiment.</p>
      )}
    </Panel>
  );
}

function NewsPanel({ symbol }: { symbol: string }) {
  const { data, loading } = useApi<NewsPayload>(`/api/v1/news?q=${encodeURIComponent(symbol)}&limit=6`);
  return (
    <Panel>
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-2">
        <Newspaper className="size-3.5" />
        Tin liên quan
      </div>
      {loading && !data ? (
        <Loading label="Đang tải tin…" />
      ) : data?.articles?.length ? (
        <ul className="space-y-2">
          {data.articles.slice(0, 6).map((a, i) => (
            <li key={i}>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-1.5 text-[12px] text-ink-2 hover:text-accent-primary"
              >
                <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-50 group-hover:opacity-100" />
                <span className="line-clamp-2">{a.title}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-text-muted">Không có tin.</p>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  );
}
