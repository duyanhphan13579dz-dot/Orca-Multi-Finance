"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, BrainCircuit, CircleAlert, Eye, LayoutDashboard, ShieldCheck, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { Badge, Chg, Panel, fmtNum } from "@/components/ui";
import { PortfolioAiPanel } from "@/components/journal/portfolio-ai-panel";
import { PriceAlertsPanel } from "@/components/journal/price-alerts-panel";
import { SmartPortfolioJournal } from "@/components/portfolio/smart-portfolio-journal";
import {
  buildPortfolioSnapshot,
  collectPortfolioSymbols,
  formatAssetType,
  loadPortfolioTrades,
  loadPortfolioWatchlist,
  subscribePortfolioStorage,
  type PortfolioMark,
  type PortfolioTrade,
  type PortfolioWatchItem,
} from "@/lib/portfolio";
import type { CommodityRow, CryptoMarketRow, ForexRow, Quote } from "@/lib/types";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { ForexMarket } from "@/lib/services/forex";

type CryptoData = { rows: CryptoMarketRow[]; summary: CryptoSummary };
type StockQuotesData = { quotes: Quote[]; count?: number; session?: unknown };
type CommodityData = { rows: CommodityRow[]; unavailable?: unknown[] };

const toneClass = { danger: "text-negative", warning: "text-warning", info: "text-accent-primary" } as const;

export default function SmartPortfolioPage() {
  const [trades, setTrades] = useState<PortfolioTrade[]>([]);
  const [watchlist, setWatchlist] = useState<PortfolioWatchItem[]>([]);
  const [activeTab, setActiveTab] = useState<
    "overview" | "positions" | "watchlist" | "journal" | "alerts"
  >("overview");
  const { data: crypto } = useApi<CryptoData>("/api/v1/crypto/markets?limit=300", { refreshInterval: 20_000 });
  const { data: forex } = useApi<ForexMarket>("/api/v1/forex/markets", { refreshInterval: 60_000 });

  useEffect(() => {
    const refresh = () => {
      setTrades(loadPortfolioTrades());
      setWatchlist(loadPortfolioWatchlist());
    };
    refresh();
    return subscribePortfolioStorage(refresh);
  }, []);

  const symbolBuckets = useMemo(() => collectPortfolioSymbols(trades, watchlist), [trades, watchlist]);
  const stockQs = symbolBuckets.stock.slice(0, 40).join(",");
  const { data: stocks, meta: stocksMeta } = useApi<StockQuotesData>(
    stockQs ? `/api/v1/stocks?symbols=${encodeURIComponent(stockQs)}` : null,
    { refreshInterval: 15_000 },
  );
  const { data: commodities, meta: commoditiesMeta } = useApi<CommodityData>("/api/v1/commodities", {
    refreshInterval: 60_000,
  });

  const marks = useMemo(() => {
    const cryptoMarks: PortfolioMark[] = (crypto?.rows ?? []).map((row) => ({
      assetType: "crypto" as const,
      symbol: String(row.symbol ?? "").toUpperCase(),
      price: row.price == null ? null : Number(row.price),
      changePercent: row.changePercent == null ? null : Number(row.changePercent),
      change: row.change == null ? null : Number(row.change),
      updatedAt: null,
      source: "coingecko",
      fresh: true,
    }));
    const forexMarks: PortfolioMark[] = (forex?.rows ?? []).map((row: ForexRow) => ({
      assetType: "forex" as const,
      symbol: String(row.pair ?? row.symbol ?? "").toUpperCase(),
      price: row.price == null ? null : Number(row.price),
      changePercent: row.changePercent == null ? null : Number(row.changePercent),
      change: row.change == null ? null : Number(row.change),
      updatedAt: row.updatedAt ?? null,
      source: "forex",
      fresh: true,
    }));
    const stockMarks: PortfolioMark[] = (stocks?.quotes ?? []).map((q) => ({
      assetType: "stock" as const,
      symbol: String(q.symbol ?? "").toUpperCase(),
      price: q.price == null ? null : Number(q.price),
      changePercent: q.changePercent == null ? null : Number(q.changePercent),
      change: q.change == null ? null : Number(q.change),
      updatedAt: null,
      source: stocksMeta?.source ?? "vndirect",
      fresh: stocksMeta?.freshness === "LIVE" || stocksMeta?.freshness === "DELAYED" ? true : null,
    }));
    const wantedCommodities = new Set(symbolBuckets.commodity.map((s) => s.toUpperCase()));
    const commodityMarks: PortfolioMark[] = (commodities?.rows ?? [])
      .filter(
        (row) =>
          wantedCommodities.has(String(row.symbol ?? row.commodity ?? "").toUpperCase()) ||
          wantedCommodities.has(String(row.commodity ?? "").toUpperCase()),
      )
      .map((row) => ({
        assetType: "commodity" as const,
        symbol: String(row.symbol || row.commodity || "").toUpperCase(),
        price: row.price == null ? null : Number(row.price),
        changePercent: row.changePercent == null ? null : Number(row.changePercent),
        change: row.change == null ? null : Number(row.change),
        updatedAt: row.updatedAt ?? null,
        source: commoditiesMeta?.source ?? "vietnambiz",
        fresh: true,
      }));
    return [...cryptoMarks, ...forexMarks, ...stockMarks, ...commodityMarks].filter(
      (mark) => mark.price != null && Number.isFinite(mark.price),
    );
  }, [crypto, forex, stocks, stocksMeta, commodities, commoditiesMeta, symbolBuckets.commodity]);

  const snapshot = useMemo(() => buildPortfolioSnapshot(trades, watchlist, marks), [trades, watchlist, marks]);
  const watchMarkMap = useMemo(
    () => new Map(marks.map((mark) => [`${mark.assetType}:${mark.symbol.toUpperCase()}`, mark])),
    [marks],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-5 text-accent-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Smart Portfolio</h1>
            <Badge tone="accent">Local-first</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[12px] text-text-muted">
            Watchlist, nhat ky lenh, canh bao gia (Discord) trong mot noi.
          </p>
        </div>
        <Link
          href="/watchlist"
          className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[11px] hover:border-border-default"
        >
          Quan ly watchlist
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-9">
        <Metric label="Vi the mo" value={String(snapshot.positions.length)} icon={<Eye />} />
        <Metric label="Exposure" value={snapshot.totalExposure ? fmtNum(snapshot.totalExposure, 2) : "—"} icon={<Activity />} />
        <Metric label="rPnL" value={fmtNum(snapshot.realizedPnl, 2)} tone={snapshot.realizedPnl >= 0 ? "up" : "down"} icon={<TrendingUp />} />
        <Metric label="uPnL" value={snapshot.unrealizedPnl == null ? "—" : fmtNum(snapshot.unrealizedPnl, 2)} tone={snapshot.unrealizedPnl == null ? undefined : snapshot.unrealizedPnl >= 0 ? "up" : "down"} icon={<TrendingDown />} />
        <Metric label="Win rate" value={snapshot.winRate == null ? "—" : `${(snapshot.winRate * 100).toFixed(0)}%`} icon={<Target />} />
        <Metric label="PF" value={snapshot.profitFactor == null ? "—" : snapshot.profitFactor.toFixed(2)} icon={<BrainCircuit />} />
        <Metric label="Max DD" value={snapshot.maxDrawdown ? fmtNum(snapshot.maxDrawdown, 2) : "—"} icon={<TrendingDown />} />
        <Metric label="Ky luat" value={`${snapshot.disciplineScore}/100`} icon={<ShieldCheck />} />
        <Metric label="Score" value={`${snapshot.portfolioScore}/100`} icon={<Activity />} />
      </div>

      <nav className="flex flex-wrap gap-1 rounded-lg border border-border-subtle bg-surface-base p-1">
        {(
          [
            ["overview", "Tong quan"],
            ["positions", `Vi the (${snapshot.positions.length})`],
            ["journal", `Nhat ky (${trades.length})`],
            ["alerts", "Canh bao gia"],
            ["watchlist", `Theo doi (${watchlist.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={
              "rounded-md px-3 py-1.5 text-[12px] transition " +
              (activeTab === id
                ? "bg-accent-primary/15 font-medium text-accent-primary"
                : "text-text-muted hover:text-text-primary")
            }
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <Overview snapshot={snapshot} trades={trades} watchlistCount={watchlist.length} />
      )}
      {activeTab === "positions" && <Positions snapshot={snapshot} />}
      {activeTab === "journal" && <JournalView trades={trades} setTrades={setTrades} />}
      {activeTab === "alerts" && <PriceAlertsPanel />}
      {activeTab === "watchlist" && <Watchlist items={watchlist} marks={watchMarkMap} />}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-base px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] text-text-muted">
        <span className="opacity-70">{icon}</span>
        {label}
      </div>
      <div
        className={
          "num mt-0.5 text-[14px] font-semibold " +
          (tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Overview({
  snapshot,
  trades,
  watchlistCount,
}: {
  snapshot: ReturnType<typeof buildPortfolioSnapshot>;
  trades: PortfolioTrade[];
  watchlistCount: number;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <PortfolioAiPanel
          trades={trades}
          context={{
            totalExposure: snapshot.totalExposure,
            totalRisk: snapshot.totalRisk,
            disciplineScore: snapshot.disciplineScore,
            portfolioScore: snapshot.portfolioScore,
            stopLossCoverage: snapshot.stopLossCoverage,
            maxDrawdown: snapshot.maxDrawdown,
            allocation: snapshot.allocation,
            volatilityByAsset: snapshot.volatilityByAsset,
            alerts: snapshot.alerts,
            watchlistCount,
          }}
        />
      </div>
      <Panel title="Action queue" right={<Badge tone={snapshot.alerts.length ? "warn" : "up"}>{snapshot.alerts.length} canh bao</Badge>}>
        {snapshot.alerts.length ? (
          <div className="space-y-2">
            {snapshot.alerts.map((alert, index) => (
              <div key={index} className="flex gap-2 rounded-md border border-border-subtle p-2.5">
                <div className={toneClass[alert.tone]}>
                  {alert.tone === "danger" ? <CircleAlert className="size-4" /> : alert.tone === "warning" ? <AlertTriangle className="size-4" /> : <ShieldCheck className="size-4" />}
                </div>
                <div>
                  <div className="text-[12px] font-medium">{alert.symbol ? `${alert.symbol} · ` : ""}{alert.title}</div>
                  <p className="text-[11px] text-text-muted">{alert.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-positive">Chua phat hien vi pham ky luat.</p>
        )}
      </Panel>
      <Panel title="Allocation">
        {snapshot.allocation.length ? (
          snapshot.allocation.map((item) => (
            <div key={item.label} className="mb-2">
              <div className="mb-1 flex justify-between text-[11px]">
                <span>{item.label}</span>
                <span className="num">{(item.weight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-elevated">
                <div className="h-full rounded-full bg-accent-primary/70" style={{ width: `${Math.min(100, item.weight * 100)}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="text-[12px] text-text-muted">Chua co allocation.</p>
        )}
      </Panel>
    </div>
  );
}

function Positions({ snapshot }: { snapshot: ReturnType<typeof buildPortfolioSnapshot> }) {
  return (
    <Panel title="Vi the dang mo" pad={false}>
      {snapshot.positions.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-[10px] uppercase text-text-muted">
                <th className="px-3 py-2">Ma</th>
                <th className="py-2">Entry → Mark</th>
                <th className="py-2 text-right">uPnL</th>
                <th className="py-2 pr-3 text-right">SL</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.positions.map((p) => (
                <tr key={p.id} className="border-b border-border-subtle/60">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{p.symbol}</div>
                    <div className="text-[10px] text-text-muted">{formatAssetType(p.assetType)} · {p.side}</div>
                  </td>
                  <td className="num py-2.5">{fmtNum(p.entry, 4)} → {p.mark == null ? "—" : fmtNum(p.mark, 4)}</td>
                  <td className={"num py-2.5 text-right " + (p.unrealizedPnl == null ? "" : p.unrealizedPnl >= 0 ? "text-positive" : "text-negative")}>
                    {p.unrealizedPnl == null ? "—" : fmtNum(p.unrealizedPnl, 2)}
                  </td>
                  <td className="py-2.5 pr-3 text-right">{p.stopLoss == null ? <Badge tone="warn">Thieu SL</Badge> : <Badge tone="up">Co SL</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-[12px] text-text-muted">Chua co vi the mo.</p>
      )}
    </Panel>
  );
}

function JournalView({ trades, setTrades }: { trades: PortfolioTrade[]; setTrades: (t: PortfolioTrade[]) => void }) {
  return <SmartPortfolioJournal trades={trades} onChange={setTrades} />;
}

function Watchlist({ items, marks }: { items: PortfolioWatchItem[]; marks: Map<string, PortfolioMark> }) {
  return (
    <Panel title="Watchlist" right={<Link href="/watchlist" className="text-[11px] text-accent-primary">Quan ly <ArrowRight className="inline size-3" /></Link>} pad={false}>
      {items.length ? (
        <ul className="divide-y divide-border-subtle">
          {items.map((item) => {
            const mark = marks.get(`${item.assetType}:${item.symbol.toUpperCase()}`);
            const href = item.assetType === "crypto" ? `/crypto/${item.symbol}` : item.assetType === "forex" ? `/forex/${item.symbol}` : item.assetType === "stock" ? `/stocks/${item.symbol}` : "/commodities";
            return (
              <li key={`${item.assetType}-${item.symbol}`} className="flex items-center gap-3 px-3.5 py-3">
                <Link href={href} className="min-w-0 flex-1">
                  <div className="font-semibold">{item.symbol}</div>
                  <div className="text-[10px] text-text-muted">{formatAssetType(item.assetType)}</div>
                </Link>
                {mark ? (
                  <div className="text-right">
                    <div className="num text-[13px]">{fmtNum(mark.price, 4)}</div>
                    <Chg value={mark.changePercent} className="text-[11px]" arrow={false} />
                  </div>
                ) : (
                  <Badge tone="warn">—</Badge>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-4 text-[12px] text-text-muted">Watchlist trong.</p>
      )}
    </Panel>
  );
}
