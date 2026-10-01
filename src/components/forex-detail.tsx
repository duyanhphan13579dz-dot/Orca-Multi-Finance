"use client";

/**
 * FOREX QUANT TERMINAL — Institutional cockpit matching mockup.
 *
 * Layout (XL):
 *   Sticky ticker · Stage 3+6+3 (desk+flow | chart | scalp) · Bottom 7+5 (structure | calendar)
 * Colors: system tokens. No mock order-book — volume from OHLCV CLV.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, ForexRow, OhlcvBar, TechnicalSnapshot } from "@/lib/types";
import {
  Badge,
  Chg,
  fmtNum,
  FreshnessDot,
  Loading,
  MetaLine,
  priceDigits,
  Unavailable,
} from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { ForexScalpPanel } from "@/components/forex-scalp-panel";
import { ForexTradeDesk } from "@/components/forex-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { ArrowLeft } from "lucide-react";
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
import {
  EconomicCalendarPanel,
  SentimentPanelCompact,
  ForexNewsPanel,
} from "@/components/forex-side-panels";

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

const INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;
const QUICK_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "XAUUSD",
  "XAGUSD",
  "AUDUSD",
  "EURJPY",
  "GBPJPY",
  "EURCHF",
  "AUDNZD",
] as const;

type MobileTab = "chart" | "desk" | "scalp" | "structure" | "news";

function FILL({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function sessionLabel(now = new Date()): { name: string; active: boolean }[] {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  return [
    { name: "Sydney", active: h >= 21 || h < 6 },
    { name: "Tokyo", active: h >= 0 && h < 9 },
    { name: "London", active: h >= 7 && h < 16 },
    { name: "New York", active: h >= 12 && h < 21 },
  ];
}

export function ForexDetailPage({ pair }: { pair: string }) {
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("1h");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [structureTab, setStructureTab] = useState<StructureTab>("ms");

  const { data, meta, isLoading } = useApi<ForexDetail>(`/api/v1/forex/${pair}`, {
    refreshInterval: 60_000,
  });

  const seriesHigh = useMemo(() => {
    const s = data?.series?.slice(-48) ?? [];
    if (!s.length) return null;
    return Math.max(...s.map((b) => b.high));
  }, [data?.series]);
  const seriesLow = useMemo(() => {
    const s = data?.series?.slice(-48) ?? [];
    if (!s.length) return null;
    return Math.min(...s.map((b) => b.low));
  }, [data?.series]);

  const orderFlow = useMemo(() => deriveOrderFlow(data?.series ?? []), [data?.series]);

  if (isLoading && !data) return <Loading rows={12} />;
  if (!data) return <Unavailable title={`Không lấy được dữ liệu cặp ${pair}`} meta={meta} />;

  const cur = data.current;
  const price = cur?.price ?? data.series[data.series.length - 1]?.close ?? null;
  const chg = cur?.changePercent ?? null;
  const tech = data.technical;
  const patterns = data.patterns ?? [];
  const digits = priceDigits(price ?? 1);
  const sessions = sessionLabel();
  const rangePos =
    price != null && seriesHigh != null && seriesLow != null && seriesHigh > seriesLow
      ? ((price - seriesLow) / (seriesHigh - seriesLow)) * 100
      : 50;

  const supports = tech?.support?.slice(0, 3) ?? [];
  const resistances = tech?.resistance?.slice(0, 3) ?? [];

  return (
    <div className="flex flex-col gap-2">
      {/* Dense ticker */}
      <div className="panel rounded-xl p-2.5 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <Link
              href="/forex"
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated/60 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-default hover:text-text-primary"
            >
              <ArrowLeft className="size-3" /> Forex
            </Link>
            <div className="flex size-7 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-[11px] font-bold text-accent-primary">
              {data.base.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-[15px] font-bold text-text-primary sm:text-[16px]">
                  {data.base}
                  <span className="text-[12px] font-normal text-text-muted">/{data.quote}</span>
                </h1>
                <Badge tone="neutral">{pair}</Badge>
                <AddToWatchlist symbol={pair} assetType="forex" />
              </div>
              <div className="num flex items-baseline gap-2 border-l border-border-subtle pl-2.5">
                <span className="text-[18px] font-bold leading-none text-text-primary sm:text-[20px]">
                  {price != null ? fmtNum(price, digits) : "—"}
                </span>
                {chg != null && <Chg value={chg} className="text-[12px] font-semibold" />}
                {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            {seriesLow != null && seriesHigh != null && (
              <div className="w-28">
                <div className="flex justify-between text-[9px] uppercase tracking-wider text-text-muted">
                  <span>Range</span>
                  <span className="num text-text-primary">{rangePos.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                  <div
                    className="h-full rounded-full bg-accent-primary/80"
                    style={{ width: `${Math.min(100, Math.max(0, rangePos))}%` }}
                  />
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-text-muted">
                  <span className="num">{fmtNum(seriesLow, digits)}</span>
                  <span className="num">{fmtNum(seriesHigh, digits)}</span>
                </div>
              </div>
            )}
            <div className="flex gap-1">
              {sessions.map((s) => (
                <span
                  key={s.name}
                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                    s.active ? "bg-positive/15 text-positive" : "bg-surface-elevated text-text-muted"
                  }`}
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border-subtle/70 pt-2">
          <span className="mr-1 text-[9px] uppercase tracking-wider text-text-muted">Quick</span>
          {QUICK_PAIRS.map((p) => (
            <Link
              key={p}
              href={`/forex/${p}`}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                p === pair
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "bg-surface-elevated text-text-secondary hover:text-text-primary"
              }`}
            >
              {p}
            </Link>
          ))}
          <div className="ml-auto flex gap-0.5">
            {INTERVALS.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setInterval(tf)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  interval === tf
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="xl:hidden">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border-subtle bg-surface-elevated/40 p-1">
          {(
            [
              ["chart", "Chart"],
              ["desk", "Vị thế"],
              ["scalp", "Scalp"],
              ["structure", "Cấu trúc"],
              ["news", "Tin / Lịch"],
            ] as const
          ).map(([id, label]) => (
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
          ))}
        </div>
      </div>

      {/* Top stage: 3+6+3 */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-2 xl:items-stretch">
        <div className="xl:col-span-3 flex min-h-[560px] flex-col gap-2">
          <FILL className="min-h-0 flex-[1.2]">
            <ForexTradeDesk
              pair={pair}
              base={data.base}
              quote={data.quote}
              price={price}
              changePercent={chg}
            />
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
          <OrcaChart
            symbol={pair}
            assetType="forex"
            defaultTimeframe={interval}
            height={560}
            title={`${data.base}/${data.quote}`}
          />
        </div>

        <div className="xl:col-span-3 flex min-h-[560px] flex-col gap-2">
          <FILL className="min-h-0 flex-1">
            <ForexScalpPanel pair={pair} />
          </FILL>
          <KeyZonesCompact price={price} digits={digits} supports={supports} resistances={resistances} />
        </div>
      </div>

      {/* Mobile content */}
      <div className="space-y-2 xl:hidden">
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
          <>
            <ForexTradeDesk
              pair={pair}
              base={data.base}
              quote={data.quote}
              price={price}
              changePercent={chg}
            />
            <OrderFlowPanel flow={orderFlow} />
            <LiquidityZonesPanel
              price={price}
              digits={digits}
              supports={supports}
              resistances={resistances}
              seriesLow={seriesLow}
              seriesHigh={seriesHigh}
            />
          </>
        )}
        {mobileTab === "scalp" && (
          <>
            <ForexScalpPanel pair={pair} />
            <KeyZonesCompact price={price} digits={digits} supports={supports} resistances={resistances} />
          </>
        )}
        {mobileTab === "structure" && (
          <MarketStructurePanel
            tab={structureTab}
            onTab={setStructureTab}
            pair={pair}
            interval={interval}
            tech={tech}
            patterns={patterns}
            cur={cur}
            series={data.series}
          />
        )}
        {mobileTab === "news" && (
          <div className="space-y-2">
            <EconomicCalendarPanel />
            <SentimentPanelCompact pair={pair} current={cur} tech={tech} />
            <ForexNewsPanel pair={pair} base={data.base} quote={data.quote} />
          </div>
        )}
      </div>

      {/* Bottom cockpit: 7+5 */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-2 xl:items-stretch">
        <div className="xl:col-span-7 flex min-h-[300px] flex-col">
          <MarketStructurePanel
            tab={structureTab}
            onTab={setStructureTab}
            pair={pair}
            interval={interval}
            tech={tech}
            patterns={patterns}
            cur={cur}
            series={data.series}
          />
        </div>

        <div className="xl:col-span-5 flex min-h-[300px] flex-col gap-2">
          <EconomicCalendarPanel />
          <div className="grid grid-cols-2 gap-2 min-h-0 flex-1">
            <SentimentPanelCompact pair={pair} current={cur} tech={tech} />
            <ForexNewsPanel pair={pair} base={data.base} quote={data.quote} />
          </div>
        </div>
      </div>

      {data.referenceNote && (
        <p className="rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-1.5 text-[10px] leading-relaxed text-text-muted">
          {data.referenceNote}
        </p>
      )}
      {meta && <MetaLine meta={meta} />}
    </div>
  );
}
