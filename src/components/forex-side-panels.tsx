"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { ForexRow, NewsArticle, TechnicalSnapshot } from "@/lib/types";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Brain, Calendar, Newspaper, ExternalLink } from "lucide-react";

interface CalendarEvent {
  time?: string;
  countryCode?: string;
  currency?: string;
  name?: string;
  importance?: string;
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

export function EconomicCalendarPanel() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          "https://biquote.io/api/calendar?importance=high&countries=US,EU,GB,JP",
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as CalendarEvent[];
        if (!cancelled) {
          const now = Date.now();
          const sorted = (Array.isArray(data) ? data : [])
            .filter((e) => e.time && Date.parse(e.time) >= now - 6 * 3_600_000)
            .sort((a, b) => Date.parse(a.time!) - Date.parse(b.time!))
            .slice(0, 12);
          setEvents(sorted);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "calendar unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const impTone = (imp?: string) => {
    const i = (imp ?? "").toLowerCase();
    if (i === "high") return "down" as const;
    if (i === "medium") return "neutral" as const;
    return "neutral" as const;
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Calendar className="size-3.5 text-accent-primary" /> Economic Calendar
        </span>
      }
      right={<span className="text-[9px] text-text-muted">Biquote · high impact</span>}
    >
      {loading && <Loading rows={3} />}
      {err && <p className="text-[11px] text-text-muted">Không tải được lịch: {err}</p>}
      {!loading && !err && events.length === 0 && (
        <p className="text-[11px] text-text-muted">Không có sự kiện high-impact gần đây.</p>
      )}
      <div className="max-h-44 space-y-1 overflow-y-auto">
        {events.map((e, idx) => {
          const t = e.time ? new Date(e.time) : null;
          const timeStr = t
            ? t.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false })
            : "—";
          return (
            <div
              key={`${e.name}-${idx}`}
              className="grid grid-cols-[44px_28px_1fr_auto] items-center gap-1.5 rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-2 py-1 text-[10.5px]"
            >
              <span className="num text-text-muted">{timeStr}</span>
              <span className="font-semibold text-text-secondary">{e.countryCode ?? e.currency ?? "—"}</span>
              <span className="truncate text-text-primary">{e.name}</span>
              <Badge tone={impTone(e.importance)}>{(e.importance ?? "—").toUpperCase()}</Badge>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export const SentimentPanelCompact = memo(function SentimentPanelCompact({
  pair,
  current,
  tech,
}: {
  pair: string;
  current: ForexRow | null;
  tech: TechnicalSnapshot | null;
}) {
  const fallback = useMemo(
    () =>
      computeLocalSentiment(
        { changePercent: current?.changePercent, price: current?.price },
        tech,
      ),
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
          <Brain className="size-3.5 text-accent-primary" /> Tâm lý & AI
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
          <div className="mb-1 flex justify-between text-[9px] text-text-muted">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-background-secondary">
            <div
              className="absolute top-0 h-full w-1 rounded-full bg-accent-primary"
              style={{ left: `${Math.min(100, Math.max(0, 50 + quant.score / 2))}%` }}
            />
          </div>
        </div>
        <ul className="space-y-0.5 text-[10.5px] text-text-secondary">
          {quant.factors.slice(0, 4).map((f, i) => (
            <li key={i} className="flex gap-1">
              <span className="text-text-muted">{f.w > 0 ? "+" : "−"}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        {isLoading && !data && <p className="text-[10px] text-text-muted">Đang tải quant…</p>}
        {llm?.narrative && (
          <p className="border-t border-border-subtle/60 pt-1.5 text-[10.5px] leading-relaxed text-text-secondary">
            {llm.narrative}
          </p>
        )}
      </div>
    </Panel>
  );
});

export function ForexNewsPanel({ pair, base, quote }: { pair: string; base: string; quote: string }) {
  const q = encodeURIComponent(`${base} ${quote} forex OR ${pair}`);
  const { data, isLoading } = useApi<NewsPayload>(`/api/v1/news?q=${q}&limit=6`, {
    refreshInterval: 300_000,
  });
  const articles = data?.articles ?? [];

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-3.5 text-accent-primary" /> Tin FX
        </span>
      }
    >
      {isLoading && !articles.length && <Loading rows={2} />}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {articles.slice(0, 6).map((a, i) => (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-1.5 rounded-md border border-border-subtle/40 bg-surface-elevated/20 px-2 py-1 text-[10.5px] text-text-secondary transition-colors hover:border-border-default hover:text-text-primary"
          >
            <ExternalLink className="mt-0.5 size-3 shrink-0 text-text-muted" />
            <span className="line-clamp-2 flex-1">{a.title}</span>
          </a>
        ))}
        {!isLoading && !articles.length && (
          <p className="text-[11px] text-text-muted">Chưa có tin liên quan.</p>
        )}
      </div>
    </Panel>
  );
}

function computeLocalSentiment(
  ticker: { changePercent?: number | null; price?: number | null },
  tech: TechnicalSnapshot | null,
) {
  let score = 0;
  const factors: { w: number; text: string }[] = [];
  const chg = ticker.changePercent;
  if (chg != null) {
    const w = Math.max(-25, Math.min(25, chg * 3));
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
    const bull = /up|bull/i.test(label);
    const bear = /down|bear/i.test(label);
    if (bull) {
      score += 10;
      factors.push({ w: 10, text: `Trend: ${label}` });
    } else if (bear) {
      score -= 10;
      factors.push({ w: -10, text: `Trend: ${label}` });
    }
  }
  score = Math.max(-100, Math.min(100, Math.round(score)));
  const label = score >= 20 ? "Bullish" : score <= -20 ? "Bearish" : "Neutral";
  const tone = score >= 20 ? ("up" as const) : score <= -20 ? ("down" as const) : ("neutral" as const);
  return { score, label, tone, factors };
}
