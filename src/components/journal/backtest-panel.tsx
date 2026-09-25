"use client";

import { useMemo, useState } from "react";
import { FlaskConical, Loader2, Play } from "lucide-react";
import { Badge, Panel } from "@/components/ui";
import type { PortfolioTrade } from "@/lib/portfolio";

type Summary = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxConsecLosses: number;
  finalEquity: number;
  equityCurve: { i: number; equity: number; pnl: number; symbol?: string }[];
};

function Sparkline({ points }: { points: { equity: number }[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 280;
  const h = 56;
  const span = max - min || 1;
  const d = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = vals[vals.length - 1];
  const up = last >= vals[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={up ? "rgb(34 197 94)" : "rgb(239 68 68)"} strokeWidth="2" />
    </svg>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
}) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text-primary";
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-elevated/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`num text-[12.5px] font-semibold ${c}`}>{value}</div>
    </div>
  );
}

export function BacktestPanel({ trades }: { trades: PortfolioTrade[] }) {
  const [mode, setMode] = useState<"journal" | "symbol">("journal");
  const [symbol, setSymbol] = useState("VCB");
  const [strategy, setStrategy] = useState<"sma_cross" | "buy_hold">("sma_cross");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [metaLabel, setMetaLabel] = useState("");

  const closedCount = useMemo(() => trades.filter((t) => t.exit != null).length, [trades]);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const body =
        mode === "journal"
          ? {
              mode: "journal",
              trades: trades.map((t) => ({
                symbol: t.symbol,
                side: t.side,
                entry: t.entry,
                exit: t.exit,
                size: t.size,
                leverage: t.leverage,
                openedAt: t.openedAt,
                closedAt: t.closedAt,
              })),
              startingEquity: 100,
            }
          : {
              mode: "symbol",
              symbol: symbol.trim().toUpperCase(),
              strategy,
              fast: 10,
              slow: 30,
              limit: 250,
            };

      const res = await fetch("/api/v1/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { summary?: Summary; symbol?: string; strategy?: string; bars?: number } & Summary;
        error?: { message?: string };
      };
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      const s = (json.data?.summary ?? json.data) as Summary;
      if (!s || typeof s.trades !== "number") throw new Error("Thiếu summary");
      setSummary(s);
      setMetaLabel(
        mode === "journal"
          ? `Nhật ký · ${closedCount} lệnh đóng`
          : `${json.data?.symbol ?? symbol} · ${json.data?.strategy ?? strategy} · ${json.data?.bars ?? "?"} nến`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backtest thất bại");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <FlaskConical className="size-4 text-accent-primary" />
          Backtest
        </span>
      }
      right={
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || (mode === "journal" && closedCount === 0)}
          className="inline-flex items-center gap-1 rounded-md border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-1 text-[11px] font-medium text-accent-primary disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Chạy
        </button>
      }
    >
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setMode("journal")}
            className={`rounded-md px-2 py-1 text-[11px] ${
              mode === "journal"
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-text-muted hover:bg-surface-elevated"
            }`}
          >
            Từ nhật ký ({closedCount})
          </button>
          <button
            type="button"
            onClick={() => setMode("symbol")}
            className={`rounded-md px-2 py-1 text-[11px] ${
              mode === "symbol"
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-text-muted hover:bg-surface-elevated"
            }`}
          >
            Chiến lược mã
          </button>
        </div>

        {mode === "symbol" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-0.5 block text-[9px] uppercase text-text-muted">Mã</span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="input w-full text-[12px]"
                placeholder="VCB"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[9px] uppercase text-text-muted">Chiến lược</span>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as "sma_cross" | "buy_hold")}
                className="input w-full text-[12px]"
              >
                <option value="sma_cross">SMA cross 10/30</option>
                <option value="buy_hold">Buy &amp; hold</option>
              </select>
            </label>
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">
            Mô phỏng equity từ các lệnh đã đóng trong nhật ký (PnL · max DD · chuỗi thua).
          </p>
        )}

        {err && <p className="text-[12px] text-down">{err}</p>}

        {summary && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{metaLabel}</Badge>
              <Badge tone="neutral">{summary.trades} lệnh</Badge>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface-elevated/30 px-2 py-1">
              <Sparkline points={summary.equityCurve} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              <Metric
                label="Win rate"
                value={summary.winRate != null ? `${(summary.winRate * 100).toFixed(0)}%` : "—"}
                tone={summary.winRate != null && summary.winRate >= 0.5 ? "up" : "down"}
              />
              <Metric
                label="Tổng PnL"
                value={summary.totalPnl.toFixed(2)}
                tone={summary.totalPnl >= 0 ? "up" : "down"}
              />
              <Metric
                label="PF"
                value={summary.profitFactor != null ? summary.profitFactor.toFixed(2) : "—"}
                tone={summary.profitFactor != null && summary.profitFactor >= 1 ? "up" : "down"}
              />
              <Metric label="Max DD" value={`${summary.maxDrawdownPct.toFixed(1)}%`} tone="down" />
              <Metric label="Chuỗi thua" value={String(summary.maxConsecLosses)} />
              <Metric
                label="Equity cuối"
                value={summary.finalEquity.toFixed(1)}
                tone={summary.finalEquity >= 100 ? "up" : "down"}
              />
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
