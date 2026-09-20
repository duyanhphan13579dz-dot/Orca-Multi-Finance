"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, BarChart3, BrainCircuit, CircleAlert, Eye, Gauge, LayoutDashboard, PieChart, ShieldCheck, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { Badge, Chg, Panel, fmtNum } from "@/components/ui";
import { PortfolioAiPanel } from "@/components/journal/portfolio-ai-panel";
import { SmartPortfolioJournal } from "@/components/portfolio/smart-portfolio-journal";
import {
  buildPortfolioSnapshot,
  formatAssetType,
  loadPortfolioTrades,
  loadPortfolioWatchlist,
  subscribePortfolioStorage,
  type PortfolioMark,
  type PortfolioTrade,
  type PortfolioWatchItem,
} from "@/lib/portfolio";
import type { CryptoMarketRow, ForexRow } from "@/lib/types";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { ForexMarket } from "@/lib/services/forex";

type CryptoData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

const toneClass = { danger: "text-negative", warning: "text-warning", info: "text-accent-primary" } as const;
const assetLabels: Record<string, string> = { stock: "Cổ phiếu", crypto: "Crypto", forex: "Forex", commodity: "Hàng hóa" };

export default function SmartPortfolioPage() {
  const [trades, setTrades] = useState<PortfolioTrade[]>([]);
  const [watchlist, setWatchlist] = useState<PortfolioWatchItem[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "positions" | "watchlist" | "journal">("overview");
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

  const marks = useMemo<PortfolioMark[]>(() => {
    const cryptoMarks = (crypto?.rows ?? []).map((row) => ({
      assetType: "crypto" as const,
      symbol: row.symbol,
      price: Number(row.price),
      changePercent: row.changePercent == null ? null : Number(row.changePercent),
    }));
    const forexMarks = (forex?.rows ?? []).map((row: ForexRow) => ({
      assetType: "forex" as const,
      symbol: row.pair,
      price: Number(row.price),
      changePercent: row.changePercent == null ? null : Number(row.changePercent),
    }));
    return [...cryptoMarks, ...forexMarks].filter((mark) => Number.isFinite(mark.price));
  }, [crypto, forex]);

  const snapshot = useMemo(() => buildPortfolioSnapshot(trades, watchlist, marks), [trades, watchlist, marks]);
  const watchMarkMap = useMemo(() => new Map(marks.map((mark) => [`${mark.assetType}:${mark.symbol.toUpperCase()}`, mark])), [marks]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-5 text-accent-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Smart Portfolio</h1>
            <Badge tone="accent">Local-first</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[12px] text-text-muted">Một bảng điều khiển hợp nhất watchlist và nhật ký lệnh: nhìn exposure, hiệu suất, rủi ro và hành động tiếp theo trong cùng một nơi.</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <Link href="/watchlist" className="rounded-md border border-border-subtle px-2.5 py-1.5 hover:border-border-default hover:text-text-primary">Quản lý watchlist</Link>
          <span className="rounded-md bg-accent-primary/15 px-2.5 py-1.5 text-accent-primary">Mở tab Nhật ký để ghi lệnh</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-9">
        <Metric label="Vị thế mở" value={String(snapshot.positions.length)} icon={<Eye />} />
        <Metric label="Exposure" value={snapshot.totalExposure ? fmtNum(snapshot.totalExposure, 2) : "—"} icon={<Gauge />} />
        <Metric label="PnL thực hiện" value={fmtNum(snapshot.realizedPnl, 2)} tone={snapshot.realizedPnl >= 0 ? "up" : "down"} icon={<TrendingUp />} />
        <Metric label="uPnL" value={snapshot.unrealizedPnl == null ? "—" : fmtNum(snapshot.unrealizedPnl, 2)} tone={snapshot.unrealizedPnl == null ? undefined : snapshot.unrealizedPnl >= 0 ? "up" : "down"} icon={<TrendingDown />} />
        <Metric label="Win rate" value={snapshot.winRate == null ? "—" : `${(snapshot.winRate * 100).toFixed(0)}%`} tone={snapshot.winRate != null && snapshot.winRate >= 0.5 ? "up" : undefined} icon={<Target />} />
        <Metric label="Profit factor" value={snapshot.profitFactor == null ? "—" : snapshot.profitFactor.toFixed(2)} icon={<BrainCircuit />} />
        <Metric label="Max drawdown" value={snapshot.maxDrawdown ? fmtNum(snapshot.maxDrawdown, 2) : "—"} tone={snapshot.maxDrawdown > 0 ? "down" : undefined} icon={<TrendingDown />} />
        <Metric label="Kỷ luật" value={`${snapshot.disciplineScore}/100`} tone={snapshot.disciplineScore >= 70 ? "up" : snapshot.disciplineScore < 45 ? "down" : undefined} icon={<ShieldCheck />} />
        <Metric label="Portfolio score" value={`${snapshot.portfolioScore}/100`} tone={snapshot.portfolioScore >= 70 ? "up" : snapshot.portfolioScore < 45 ? "down" : undefined} icon={<Activity />} />
      </div>

      <nav className="flex gap-1 rounded-lg border border-border-subtle bg-surface-base p-1" aria-label="Portfolio views">
        {([["overview", "Tổng quan"], ["positions", `Vị thế (${snapshot.positions.length})`], ["journal", `Nhật ký (${trades.length})`], ["watchlist", `Theo dõi (${watchlist.length})`]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setActiveTab(id)} className={`rounded-md px-3 py-1.5 text-[12px] transition ${activeTab === id ? "bg-accent-primary/15 font-medium text-accent-primary" : "text-text-muted hover:text-text-primary"}`}>{label}</button>
        ))}
      </nav>

      {activeTab === "overview" && <Overview snapshot={snapshot} trades={trades} watchlistCount={watchlist.length} />}
      {activeTab === "positions" && <Positions snapshot={snapshot} />}
      {activeTab === "journal" && <JournalView trades={trades} setTrades={setTrades} />}
      {activeTab === "watchlist" && <Watchlist items={watchlist} marks={watchMarkMap} />}

      <p className="text-[10px] text-text-muted">Giá mark chỉ hiển thị khi data provider trả về dữ liệu thật. PnL của vị thế chưa có mark không được cộng vào uPnL. Smart Portfolio không phải khuyến nghị đầu tư.</p>
    </div>
  );
}

function Overview({ snapshot, trades, watchlistCount }: { snapshot: ReturnType<typeof buildPortfolioSnapshot>; trades: PortfolioTrade[]; watchlistCount: number }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="lg:col-span-2"><PortfolioAiPanel trades={trades} context={{ totalExposure: snapshot.totalExposure, totalRisk: snapshot.totalRisk, disciplineScore: snapshot.disciplineScore, portfolioScore: snapshot.portfolioScore, stopLossCoverage: snapshot.stopLossCoverage, maxDrawdown: snapshot.maxDrawdown, allocation: snapshot.allocation, volatilityByAsset: snapshot.volatilityByAsset, alerts: snapshot.alerts, watchlistCount }} /></div>
      <Panel title="Risk & allocation" right={<span className="text-[10px] text-text-muted">Exposure hiện tại</span>}>
        {snapshot.allocation.length ? <div className="space-y-3">{snapshot.allocation.map((item) => <div key={item.label}><div className="mb-1 flex justify-between text-[12px]"><span>{assetLabels[item.label] ?? item.label}</span><span className="num text-text-secondary">{item.percentage.toFixed(0)}% · {fmtNum(item.value, 2)}</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-modal"><div className="h-full rounded-full bg-accent-primary" style={{ width: `${item.percentage}%` }} /></div></div>)}<div className="grid grid-cols-2 gap-2 border-t border-border-subtle pt-3"><Info label="Risk to SL" value={snapshot.totalRisk == null ? "Chưa đủ SL" : fmtNum(snapshot.totalRisk, 2)} /><Info label="Expectancy" value={snapshot.expectancy == null ? "—" : fmtNum(snapshot.expectancy, 2)} /></div></div> : <Empty title="Chưa có vị thế mở" note="Mở tab Nhật ký để ghi một lệnh chưa đóng và bắt đầu theo dõi exposure." href="/portfolio" action="Mở Smart Portfolio" />}
      </Panel>
      <Panel title="Action queue" right={<Badge tone={snapshot.alerts.length ? "warn" : "up"}>{snapshot.alerts.length} cảnh báo</Badge>}>
        {snapshot.alerts.length ? <div className="space-y-2">{snapshot.alerts.map((alert, index) => <div key={`${alert.title}-${alert.symbol}-${index}`} className="flex gap-2 rounded-md border border-border-subtle bg-surface-base/60 p-2.5"><div className={toneClass[alert.tone]}>{alert.tone === "danger" ? <CircleAlert className="size-4" /> : alert.tone === "warning" ? <AlertTriangle className="size-4" /> : <ShieldCheck className="size-4" />}</div><div className="min-w-0"><div className="text-[12px] font-medium">{alert.symbol ? `${alert.symbol} · ` : ""}{alert.title}</div><p className="mt-0.5 text-[11px] text-text-muted">{alert.detail}</p></div></div>)}</div> : <div className="flex items-center gap-2 rounded-md bg-positive/10 p-3 text-[12px] text-positive"><ShieldCheck className="size-4" /> Chưa phát hiện vi phạm kỷ luật rõ ràng trên dữ liệu hiện có.</div>}
      </Panel>
      <Panel className="lg:col-span-2" title="Smart readout">
        <div className="grid gap-3 sm:grid-cols-3"><Readout label="Trạng thái book" value={snapshot.positions.length ? `${snapshot.positions.length} vị thế đang mở` : "Chưa có vị thế"} note={snapshot.totalExposure ? `Exposure ${fmtNum(snapshot.totalExposure, 2)}` : "Watchlist vẫn hoạt động độc lập"} /><Readout label="Chất lượng hiệu suất" value={snapshot.profitFactor == null ? "Chưa đủ mẫu" : snapshot.profitFactor >= 1.5 ? "Có lợi thế" : snapshot.profitFactor >= 1 ? "Cần theo dõi" : "Đang suy yếu"} note={snapshot.winRate == null ? "Cần lệnh đã đóng" : `Win rate ${(snapshot.winRate * 100).toFixed(0)}%`} /><Readout label="Việc nên làm trước" value={snapshot.alerts[0]?.title ?? "Tiếp tục ghi nhận"} note={snapshot.alerts[0]?.detail ?? "Ghi entry, SL, TP và exit để analytics đáng tin cậy hơn."} /></div>
      </Panel>
      <VolatilityMonitor snapshot={snapshot} />
      <PortfolioCharts snapshot={snapshot} />
    </div>
  );
}

function JournalView({
  trades,
  setTrades,
}: {
  trades: PortfolioTrade[];
  setTrades: (trades: PortfolioTrade[]) => void;
}) {
  return (
    <SmartPortfolioJournal trades={trades} onChange={setTrades} />
  );
}

const volatilityLabels = { low: "Thấp", elevated: "Tăng", high: "Cao", extreme: "Cực cao", unavailable: "Chưa có mark" } as const;
const volatilityTone = { low: "text-positive", elevated: "text-warning", high: "text-warning", extreme: "text-negative", unavailable: "text-text-muted" } as const;

function VolatilityMonitor({ snapshot }: { snapshot: ReturnType<typeof buildPortfolioSnapshot> }) {
  return (
    <Panel className="lg:col-span-2" title={<span className="flex items-center gap-1.5"><Activity className="size-3.5 text-accent-primary" /> Risk alert theo biến động</span>} right={<span className="text-[10px] text-text-muted">Tự cập nhật theo mark</span>}>
      {snapshot.volatilityByAsset.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{snapshot.volatilityByAsset.map((item) => {
        const thresholdMax = item.extremeThresholdPct * 1.25;
        const width = item.volatilityPct == null ? 0 : Math.min(100, (item.volatilityPct / thresholdMax) * 100);
        return <div key={item.label} className="rounded-md border border-border-subtle bg-surface-base/60 p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium">{assetLabels[item.label] ?? item.label}</span><span className={`text-[10px] font-semibold ${volatilityTone[item.level]}`}>{volatilityLabels[item.level]}</span></div><div className="mt-2 flex items-end justify-between"><span className="num text-[16px] font-semibold">{item.volatilityPct == null ? "—" : `${item.volatilityPct.toFixed(2)}%`}</span><span className="text-[10px] text-text-muted">{item.markedPositions}/{item.positionCount} mark</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-modal"><div className={`h-full rounded-full ${item.level === "extreme" ? "bg-negative" : item.level === "high" || item.level === "elevated" ? "bg-warning" : "bg-positive"}`} style={{ width: `${width}%` }} /></div><div className="mt-1 flex justify-between text-[9px] text-text-muted"><span>Ngưỡng cao {item.highThresholdPct}%</span><span>Alert {item.extremeThresholdPct}%</span></div></div>;
      })}</div> : <ChartEmpty text="Chưa có vị thế mở để đo biến động theo nhóm tài sản." />}
      <p className="mt-3 text-[10px] text-text-muted">Biến động là proxy tức thời: trung bình có trọng số exposure của |% thay đổi| từ quote hiện tại. Cảnh báo chỉ mang tính thông tin, không tự đóng lệnh.</p>
    </Panel>
  );
}

const CHART_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185"];

function PortfolioCharts({ snapshot }: { snapshot: ReturnType<typeof buildPortfolioSnapshot> }) {
  const allocationTotal = snapshot.allocation.reduce((sum, item) => sum + item.value, 0);
  const allocationSegments = snapshot.allocation.reduce<{ label: string; value: number; color: string; start: number }[]>((segments, item, index) => {
    const previous = segments.at(-1);
    const start = previous ? previous.start + previous.value : 0;
    segments.push({ label: item.label, value: item.value, color: CHART_COLORS[index % CHART_COLORS.length], start });
    return segments;
  }, []);
  const maxAbsPnl = Math.max(1, ...snapshot.performanceByAsset.map((item) => Math.abs(item.pnl)));

  return (
    <Panel className="lg:col-span-2" title="Portfolio charts" right={<span className="text-[10px] text-text-muted">Từ engine phân tích</span>}>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section aria-labelledby="pnl-chart-title">
          <div className="mb-3 flex items-center gap-1.5 text-[12px] font-medium"><BarChart3 className="size-3.5 text-accent-primary" /><h2 id="pnl-chart-title">PnL theo nhóm tài sản</h2></div>
          {snapshot.performanceByAsset.length ? <div className="space-y-3">{snapshot.performanceByAsset.map((item, index) => <div key={item.label} title={`${assetLabels[item.label] ?? item.label}: ${fmtNum(item.pnl, 2)} · ${item.trades} lệnh`}><div className="mb-1 flex items-center justify-between text-[11px]"><span>{assetLabels[item.label] ?? item.label} <span className="text-text-muted">· {item.trades} lệnh</span></span><span className={`num font-medium ${item.pnl >= 0 ? "text-positive" : "text-negative"}`}>{item.pnl >= 0 ? "+" : ""}{fmtNum(item.pnl, 2)}</span></div><div className="relative h-5 rounded bg-surface-modal"><div className={`absolute inset-y-0 rounded ${item.pnl >= 0 ? "bg-positive/75" : "bg-negative/75"}`} style={{ width: `${Math.max(4, (Math.abs(item.pnl) / maxAbsPnl) * 100)}%`, left: item.pnl >= 0 ? "0" : "auto", right: item.pnl < 0 ? "0" : "auto" }} /><div className="absolute inset-y-0 left-1/2 w-px bg-border-default/80" /></div><div className="mt-0.5 text-[10px] text-text-muted">Win rate {item.winRate == null ? "—" : `${(item.winRate * 100).toFixed(0)}%`}</div></div>)}</div> : <ChartEmpty text="Chưa có lệnh đã đóng để vẽ PnL." />}
        </section>
        <section aria-labelledby="allocation-chart-title">
          <div className="mb-3 flex items-center gap-1.5 text-[12px] font-medium"><PieChart className="size-3.5 text-accent-primary" /><h2 id="allocation-chart-title">Phân bổ exposure</h2></div>
          {allocationTotal > 0 ? <div className="flex flex-wrap items-center gap-5 sm:flex-nowrap"><div className="relative size-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${allocationSegments.map((segment) => `${segment.color} ${(segment.start / allocationTotal) * 100}% ${((segment.start + segment.value) / allocationTotal) * 100}%`).join(", ")})` }} role="img" aria-label="Biểu đồ tròn phân bổ exposure"><div className="absolute inset-[22px] grid place-items-center rounded-full bg-surface-base text-center"><span className="text-[9px] uppercase tracking-wide text-text-muted">Exposure</span><b className="num text-[13px]">{fmtNum(allocationTotal, 2)}</b></div></div><div className="min-w-0 flex-1 space-y-2">{allocationSegments.map((segment) => <div key={segment.label} className="flex items-center justify-between gap-3 text-[11px]"><span className="flex min-w-0 items-center gap-1.5"><i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />{assetLabels[segment.label] ?? segment.label}</span><span className="num text-text-secondary">{((segment.value / allocationTotal) * 100).toFixed(0)}%</span></div>)}</div></div> : <ChartEmpty text="Chưa có vị thế mở để vẽ phân bổ." />}
        </section>
      </div>
    </Panel>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return <div className="grid min-h-36 place-items-center rounded-md border border-dashed border-border-subtle px-4 text-center text-[11px] text-text-muted">{text}</div>;
}

function Positions({ snapshot }: { snapshot: ReturnType<typeof buildPortfolioSnapshot> }) {
  return <Panel title="Open positions" right={<span className="text-[11px] text-text-muted">Quản lý tại tab Nhật ký</span>} pad={false}>{snapshot.positions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[12px]"><thead><tr className="border-b border-border-subtle text-[10px] uppercase tracking-wide text-text-muted"><th className="px-3.5 py-2">Mã</th><th className="py-2">Entry → Mark</th><th className="py-2 text-right">uPnL</th><th className="py-2 text-right">Exposure</th><th className="py-2 text-right">SL / TP</th><th className="py-2 pr-3.5 text-right">Kỷ luật</th></tr></thead><tbody>{snapshot.positions.map((position) => <tr key={position.id} className="border-b border-border-subtle/60"><td className="px-3.5 py-2.5"><div className="font-semibold">{position.symbol}</div><div className="text-[10px] text-text-muted">{formatAssetType(position.assetType)} · {position.side}</div></td><td className="num py-2.5">{fmtNum(position.entry, 4)} → {position.mark == null ? <span className="text-text-muted">chưa có mark</span> : fmtNum(position.mark, 4)}</td><td className={`num py-2.5 text-right ${position.unrealizedPnl == null ? "text-text-muted" : position.unrealizedPnl >= 0 ? "text-positive" : "text-negative"}`}>{position.unrealizedPnl == null ? "—" : fmtNum(position.unrealizedPnl, 2)}</td><td className="num py-2.5 text-right">{fmtNum(position.exposure, 2)}</td><td className="num py-2.5 text-right text-text-muted">{position.stopLoss ?? "—"} / {position.takeProfit ?? "—"}</td><td className="py-2.5 pr-3.5 text-right">{position.stopLoss == null ? <Badge tone="warn">Thiếu SL</Badge> : <Badge tone="up">Có SL</Badge>}</td></tr>)}</tbody></table></div> : <Empty title="Chưa có vị thế mở" note="Các lệnh đã đóng vẫn được dùng cho thống kê hiệu suất." href="/portfolio" action="Mở Smart Portfolio" />}</Panel>;
}

function Watchlist({ items, marks }: { items: PortfolioWatchItem[]; marks: Map<string, PortfolioMark> }) {
  return <Panel title="Watchlist intelligence" right={<Link href="/watchlist" className="inline-flex items-center gap-1 text-[11px] text-accent-primary">Quản lý <ArrowRight className="size-3" /></Link>} pad={false}>{items.length ? <ul className="divide-y divide-border-subtle">{items.map((item) => { const mark = marks.get(`${item.assetType}:${item.symbol.toUpperCase()}`); const href = item.assetType === "crypto" ? `/crypto/${item.symbol}` : item.assetType === "forex" ? `/forex/${item.symbol}` : item.assetType === "stock" ? `/stocks/${item.symbol}` : "/commodities"; return <li key={`${item.assetType}-${item.symbol}`} className="flex items-center gap-3 px-3.5 py-3"><Link href={href} className="min-w-0 flex-1"><div className="font-semibold hover:text-accent-primary">{item.symbol}</div><div className="text-[10px] text-text-muted">{formatAssetType(item.assetType)} · theo dõi từ {new Date(item.addedAt).toLocaleDateString("vi-VN")}</div></Link>{mark ? <div className="text-right"><div className="num text-[13px]">{fmtNum(mark.price, mark.price && mark.price >= 100 ? 2 : 4)}</div><Chg value={mark.changePercent} className="text-[11px]" arrow={false} /></div> : <Badge tone="warn">Chưa có giá</Badge>}</li>; })}</ul> : <Empty title="Watchlist trống" note="Thêm mã tại trang Watchlist để tạo danh sách cơ hội." href="/watchlist" action="Thêm mã" />}</Panel>;
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone?: "up" | "down"; icon: React.ReactNode }) { return <div className="rounded-lg border border-border-subtle bg-surface-base px-2.5 py-2"><div className="flex items-center justify-between text-text-muted"><span className="text-[9px] uppercase tracking-wide">{label}</span><span className="size-3.5">{icon}</span></div><div className={`num mt-1 text-[15px] font-semibold ${tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary"}`}>{value}</div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div><div className="num mt-0.5 text-[13px] font-medium">{value}</div></div>; }
function Readout({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-md border border-border-subtle p-3"><div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div><div className="mt-1 text-[13px] font-semibold">{value}</div><div className="mt-1 text-[11px] text-text-muted">{note}</div></div>; }
function Empty({ title, note, href, action }: { title: string; note: string; href: string; action: string }) { return <div className="flex flex-col items-center gap-2 p-8 text-center"><div className="text-[13px] font-medium">{title}</div><p className="max-w-sm text-[11px] text-text-muted">{note}</p><Link href={href} className="inline-flex items-center gap-1 rounded-md bg-accent-primary/15 px-2.5 py-1.5 text-[11px] text-accent-primary">{action} <ArrowRight className="size-3" /></Link></div>; }
