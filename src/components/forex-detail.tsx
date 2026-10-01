"use client";

/**
 * FOREX QUANT TERMINAL — Institutional cockpit matching mockup.
 * Layout XL: ticker | 3+6+3 (desk+flow | chart | scalp) | 7+5 (structure | calendar)
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, ForexRow, OhlcvBar, TechnicalSnapshot } from "@/lib/types";
import {
  Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable,
} from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { ForexScalpPanel } from "@/components/forex-scalp-panel";
import { ForexTradeDesk } from "@/components/forex-trade-desk";
import { MtfBiasPanel } from "@/components/mtf-bias-panel";
import { TechnicalPanel, PatternsAndDivergencePanel } from "@/components/technical-panel";
import { AddToWatchlist } from "@/components/watchlist-button";
import { ArrowLeft, Layers, Radio, Activity } from "lucide-react";

interface ForexDetail {
  pair: string; base: string; quote: string;
  current: ForexRow | null; series: OhlcvBar[];
  technical: TechnicalSnapshot | null; patterns: CandlePattern[];
  referenceNote: string;
}

const INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;
const QUICK_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD", "AUDUSD", "EURJPY", "GBPJPY", "EURCHF", "AUDNZD"] as const;
type MobileTab = "chart" | "desk" | "scalp" | "structure" | "news";

function FILL({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function sessionLabel(now = new Date()) {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  return [
    { name: "Sydney", active: h >= 21 || h < 6 },
    { name: "Tokyo", active: h >= 0 && h < 9 },
    { name: "London", active: h >= 7 && h < 16 },
    { name: "New York", active: h >= 12 && h < 21 },
  ];
}

function deriveOrderFlow(series: OhlcvBar[]) {
  const bars = series.slice(-48);
  if (bars.length < 8) return { buyVol: 0, sellVol: 0, delta: 0, buyRatio: 50, rvol: null as number | null, hasVolume: false };
  let buyVol = 0, sellVol = 0;
  const vols: number[] = [];
  for (const b of bars) {
    const v = b.volume ?? 0;
    vols.push(v);
    const range = Math.max(1e-12, b.high - b.low);
    const clv = ((b.close - b.low) - (b.high - b.close)) / range;
    buyVol += v * (0.5 + clv * 0.5);
    sellVol += v * (0.5 - clv * 0.5);
  }
  const total = buyVol + sellVol || 1;
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length || 1;
  return {
    buyVol, sellVol, delta: buyVol - sellVol,
    buyRatio: (buyVol / total) * 100,
    rvol: avg > 0 ? (vols[vols.length - 1] ?? 0) / avg : null,
    hasVolume: avg > 0,
  };
}

export function ForexDetailPage({ pair }: { pair: string }) {
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("1h");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const { data, meta, isLoading } = useApi<ForexDetail>(`/api/v1/forex/${pair}`, { refreshInterval: 60_000 });

  const seriesHigh = useMemo(() => {
    const s = data?.series?.slice(-48) ?? [];
    return s.length ? Math.max(...s.map((b) => b.high)) : null;
  }, [data?.series]);
  const seriesLow = useMemo(() => {
    const s = data?.series?.slice(-48) ?? [];
    return s.length ? Math.min(...s.map((b) => b.low)) : null;
  }, [data?.series]);
  const flow = useMemo(() => deriveOrderFlow(data?.series ?? []), [data?.series]);

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
            <Link href="/forex" className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-elevated/60 px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary">
              <ArrowLeft className="size-3" /> Forex
            </Link>
            <div className="flex size-7 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-[11px] font-bold text-accent-primary">{data.base.slice(0, 1)}</div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-[15px] font-bold text-text-primary sm:text-[16px]">
                  {data.base}<span className="text-[12px] font-normal text-text-muted">/{data.quote}</span>
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
                  <div className="h-full rounded-full bg-accent-primary/80" style={{ width: `${Math.min(100, Math.max(0, rangePos))}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-1">
              {sessions.map((s) => (
                <span key={s.name} className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${s.active ? "bg-positive/15 text-positive" : "bg-surface-elevated text-text-muted"}`}>
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border-subtle/70 pt-2">
          <span className="mr-1 text-[9px] uppercase tracking-wider text-text-muted">Quick</span>
          {QUICK_PAIRS.map((p) => (
            <Link key={p} href={`/forex/${p}`} className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${p === pair ? "bg-accent-primary/20 text-accent-primary" : "bg-surface-elevated text-text-secondary hover:text-text-primary"}`}>
              {p}
            </Link>
          ))}
          <div className="ml-auto flex gap-0.5">
            {INTERVALS.map((tf) => (
              <button key={tf} type="button" onClick={() => setInterval(tf)} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${interval === tf ? "bg-accent-primary/20 text-accent-primary" : "text-text-muted hover:text-text-primary"}`}>
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="xl:hidden">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border-subtle bg-surface-elevated/40 p-1">
          {([["chart", "Chart"], ["desk", "Vị thế"], ["scalp", "Scalp"], ["structure", "Cấu trúc"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setMobileTab(id)} className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-[11px] font-medium ${mobileTab === id ? "bg-accent-primary/20 text-accent-primary" : "text-text-secondary"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Top stage 3+6+3 */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-2 xl:items-stretch">
        <div className="xl:col-span-3 flex min-h-[560px] flex-col gap-2">
          <FILL className="min-h-0 flex-[1.2]">
            <ForexTradeDesk pair={pair} base={data.base} quote={data.quote} price={price} changePercent={chg} />
          </FILL>
          <Panel
            title={<span className="flex items-center gap-1.5 text-[11px]"><Activity className="size-3 text-accent-primary" /> Order Flow & Liquidity</span>}
            right={<span className="text-[9px] text-text-muted">{flow.hasVolume ? "CLV · series" : "Vol N/A"}</span>}
          >
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/40 px-2 py-1.5">
                <div className="text-[9px] uppercase text-text-muted">Buy Vol</div>
                <div className="num font-semibold text-positive">{flow.hasVolume ? flow.buyVol.toFixed(0) : "—"}</div>
              </div>
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/40 px-2 py-1.5">
                <div className="text-[9px] uppercase text-text-muted">Sell Vol</div>
                <div className="num font-semibold text-negative">{flow.hasVolume ? flow.sellVol.toFixed(0) : "—"}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
              <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1">
                <div className="text-[8.5px] uppercase text-text-muted">Delta</div>
                <div className={`num text-[12px] font-semibold ${flow.delta > 0 ? "text-positive" : flow.delta < 0 ? "text-negative" : "text-text-muted"}`}>
                  {flow.hasVolume ? (flow.delta >= 0 ? "+" : "") + flow.delta.toFixed(0) : "—"}
                </div>
              </div>
              <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1">
                <div className="text-[8.5px] uppercase text-text-muted">Buy %</div>
                <div className="num text-[12px] font-semibold">{flow.hasVolume ? `${flow.buyRatio.toFixed(0)}%` : "—"}</div>
              </div>
              <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1">
                <div className="text-[8.5px] uppercase text-text-muted">RVOL</div>
                <div className="num text-[12px] font-semibold text-accent-primary">{flow.rvol != null ? `${flow.rvol.toFixed(2)}x` : "—"}</div>
              </div>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-elevated">
              <div className="h-full bg-positive/70" style={{ width: `${Math.min(100, Math.max(0, flow.buyRatio))}%` }} />
              <div className="h-full bg-negative/70" style={{ width: `${Math.min(100, Math.max(0, 100 - flow.buyRatio))}%` }} />
            </div>
            <p className="mt-1.5 text-[9px] text-text-muted">Delta/CVD từ CLV × volume nến — không phải order book OTC.</p>
          </Panel>
          <Panel
            title={<span className="flex items-center gap-1.5 text-[11px]"><Radio className="size-3 text-accent-primary" /> Liquidity Zones</span>}
            right={<span className="text-[9px] text-positive">S/R · technical</span>}
          >
            <div className="space-y-1 text-[11px]">
              {resistances.map((r, i) => (
                <div key={`r${i}`} className="flex justify-between gap-2">
                  <span className="text-negative">● Sell / Resist</span>
                  <span className="num font-semibold text-text-primary">{fmtNum(r, digits)}</span>
                </div>
              ))}
              {price != null && (
                <div className="flex justify-between gap-2 border-y border-border-subtle/60 py-1">
                  <span className="text-accent-primary">● Current</span>
                  <span className="num font-bold text-text-primary">{fmtNum(price, digits)}</span>
                </div>
              )}
              {supports.map((s, i) => (
                <div key={`s${i}`} className="flex justify-between gap-2">
                  <span className="text-positive">● Buy / Support</span>
                  <span className="num font-semibold text-text-primary">{fmtNum(s, digits)}</span>
                </div>
              ))}
              {!supports.length && !resistances.length && <div className="text-text-muted">Chưa đủ dữ liệu S/R</div>}
            </div>
          </Panel>
        </div>

        <div className="xl:col-span-6 flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-primary">
          <OrcaChart symbol={pair} assetType="forex" defaultTimeframe={interval} height={560} title={`${data.base}/${data.quote}`} />
        </div>

        <div className="xl:col-span-3 flex min-h-[560px] flex-col">
          <FILL><ForexScalpPanel pair={pair} /></FILL>
        </div>
      </div>

      {/* Mobile */}
      <div className="space-y-2 xl:hidden">
        {mobileTab === "chart" && <OrcaChart symbol={pair} assetType="forex" defaultTimeframe={interval} height={400} title={`${data.base}/${data.quote}`} />}
        {mobileTab === "desk" && (
          <>
            <ForexTradeDesk pair={pair} base={data.base} quote={data.quote} price={price} changePercent={chg} />
          </>
        )}
        {mobileTab === "scalp" && <ForexScalpPanel pair={pair} />}
        {mobileTab === "structure" && (
          <div className="space-y-2">
            <MtfBiasPanel symbol={pair} assetType="forex" chartTimeframe={interval} />
            <TechnicalPanel tech={tech} patterns={patterns} ticker={cur} variant="compact" />
            <PatternsAndDivergencePanel tech={tech} patterns={patterns} />
          </div>
        )}
      </div>

      {/* Bottom 7+5 */}
      <div className="hidden xl:grid xl:grid-cols-12 xl:gap-2 xl:items-stretch">
        <div className="xl:col-span-7 flex min-h-[280px] flex-col">
          <Panel title={<span className="flex items-center gap-2"><Layers className="size-3.5 text-accent-primary" /> Market Structure & Multi-TF</span>}>
            <div className="space-y-2">
              <MtfBiasPanel symbol={pair} assetType="forex" chartTimeframe={interval} />
              <div className="grid grid-cols-2 gap-2">
                <TechnicalPanel tech={tech} patterns={patterns} ticker={cur} variant="compact" />
                <PatternsAndDivergencePanel tech={tech} patterns={patterns} />
              </div>
            </div>
          </Panel>
        </div>
        <div className="xl:col-span-5 flex min-h-[280px] flex-col gap-2">
          <Panel title={<span className="flex items-center gap-2 text-[11px]">Key Zones</span>}>
            <div className="space-y-1 text-[11px]">
              {resistances.slice(0, 2).map((r, i) => (
                <div key={i} className="flex justify-between"><span className="text-negative">R{i + 1}</span><span className="num font-medium">{fmtNum(r, digits)}</span></div>
              ))}
              {price != null && <div className="flex justify-between border-y border-border-subtle/50 py-0.5"><span className="text-accent-primary">Now</span><span className="num font-bold">{fmtNum(price, digits)}</span></div>}
              {supports.slice(0, 2).map((s, i) => (
                <div key={i} className="flex justify-between"><span className="text-positive">S{i + 1}</span><span className="num font-medium">{fmtNum(s, digits)}</span></div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {data.referenceNote && (
        <p className="rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-1.5 text-[10px] leading-relaxed text-text-muted">{data.referenceNote}</p>
      )}
      {meta && <MetaLine meta={meta} />}
    </div>
  );
}
