"use client";

import { useState } from "react";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { Badge, Panel } from "@/components/ui";

type TradeLite = {
  assetType: string;
  symbol: string;
  side: string;
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  size: number | null;
  leverage: number | null;
  strategy: string;
  emotion: string;
  notes: string;
};

type OpenMark = {
  symbol: string;
  side: string;
  entry: number;
  mark: number | null;
  unrealizedPnl: number | null;
  distToSlPct: number | null;
  distToTpPct: number | null;
  strategy: string;
  notes: string;
};

type AnalyzeResult = {
  stats: {
    total: number;
    closed: number;
    open: number;
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    avgR: number | null;
    totalPnl: number | null;
    unrealizedPnl: number | null;
    maxConsecLosses: number;
  };
  openMarks?: OpenMark[];
  narrative: string;
  mode: "deterministic" | "llm";
  model: string | null;
};

export type PortfolioAiContext = {
  totalExposure: number;
  totalRisk: number | null;
  disciplineScore: number;
  portfolioScore: number;
  stopLossCoverage: number;
  maxDrawdown: number;
  allocation: { label: string; percentage: number; value: number }[];
  volatilityByAsset: { label: string; volatilityPct: number | null; level: string; exposurePct: number }[];
  alerts: { tone: string; title: string; detail: string; symbol?: string }[];
  watchlistCount: number;
};

function renderMarkdownLite(text: string) {
  return text.split("\n").map((line, i) => {
    const t = line.trim();
    if (t.startsWith("## ")) {
      return (
        <h3 key={i} className="mt-3 text-[13px] font-semibold text-accent first:mt-0">
          {t.slice(3)}
        </h3>
      );
    }
    if (t.startsWith("### ")) {
      return (
        <h4 key={i} className="mt-2.5 text-[12px] font-semibold text-ink">
          {t.slice(4)}
        </h4>
      );
    }
    if (/^[-•*]\s/.test(t)) {
      return (
        <p key={i} className="mt-1 pl-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="text-ink-3">• </span>
          {t.replace(/^[-•*]\s/, "")}
        </p>
      );
    }
    if (!t) return <div key={i} className="h-1.5" />;
    const parts = t.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
        {parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={j} className="font-semibold text-ink">
              {p.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{p}</span>
          ),
        )}
      </p>
    );
  });
}

export function PortfolioAiPanel({ trades, context }: { trades: TradeLite[]; context?: PortfolioAiContext }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  async function run() {
    if (!trades.length) {
      setErr("Chưa có lệnh trong nhật ký.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/v1/journal/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades, portfolioContext: context }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: AnalyzeResult;
        error?: { message?: string };
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      setResult(json.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Phân tích thất bại");
    } finally {
      setLoading(false);
    }
  }

  const s = result?.stats;
  const openN = trades.filter((t) => t.exit == null).length;
  const closedN = trades.filter((t) => t.exit != null).length;

  return (
    <Panel
      title="AI Portfolio Coach"
      right={
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || !trades.length}
          className="inline-flex items-center gap-1.5 rounded-md border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-1 text-[11px] font-medium text-accent-primary disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {loading ? "Đang phân tích…" : "Phân tích danh mục"}
        </button>
      }
    >
      <p className="mb-2 text-[11.5px] text-ink-3">
        Đọc nhật ký, exposure, volatility, risk alerts và vị thế đang mở · LLM nhận xét khi có API key.
        {trades.length > 0 && (
          <span className="ml-1 text-ink-2">
            ({closedN} đóng · {openN} mở)
          </span>
        )}
      </p>

      {err && <p className="text-[12px] text-down">{err}</p>}

      {!result && !err && (
        <div className="flex items-start gap-2 rounded-lg border border-line/60 bg-bg-2/40 px-3 py-2.5 text-[12px] text-ink-3">
          <Bot className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>
            {trades.length
              ? `Bấm "Phân tích danh mục" để ORCA đánh giá ${trades.length} lệnh cùng snapshot Smart Portfolio.`
              : "Thêm lệnh vào nhật ký trước, rồi bấm phân tích."}
          </span>
        </div>
      )}

      {result && s && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{result.mode === "llm" ? "LLM" : "Stats"}</Badge>
            {result.model && <Badge tone="accent">{result.model}</Badge>}
            <Badge tone="accent">{s.open} mở</Badge>
            <Badge tone="accent">{s.closed} đóng</Badge>
            {s.winRate != null && (
              <Badge tone={s.winRate >= 0.5 ? "up" : "down"}>
                WR {(s.winRate * 100).toFixed(0)}%
              </Badge>
            )}
            {s.unrealizedPnl != null && (
              <Badge tone={s.unrealizedPnl >= 0 ? "up" : "down"}>
                uPnL {s.unrealizedPnl.toFixed(1)}
              </Badge>
            )}
            {s.totalPnl != null && (
              <Badge tone={s.totalPnl >= 0 ? "up" : "down"}>PnL {s.totalPnl.toFixed(1)}</Badge>
            )}
          </div>

          {result.openMarks && result.openMarks.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line/50">
              <table className="w-full text-left text-[11.5px]">
                <thead>
                  <tr className="border-b border-line/60 text-[10px] uppercase text-ink-3">
                    <th className="px-2 py-1.5">Mã</th>
                    <th className="px-2 py-1.5">Entry</th>
                    <th className="px-2 py-1.5">Mark</th>
                    <th className="px-2 py-1.5 text-right">uPnL</th>
                    <th className="px-2 py-1.5">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {result.openMarks.map((o) => (
                    <tr key={`${o.symbol}-${o.entry}`} className="border-b border-line/40">
                      <td className="px-2 py-1.5 font-medium">
                        {o.symbol}{" "}
                        <span className="text-ink-3">{o.side}</span>
                      </td>
                      <td className="num px-2 py-1.5">{o.entry}</td>
                      <td className="num px-2 py-1.5">{o.mark != null ? o.mark.toFixed(2) : "—"}</td>
                      <td
                        className={`num px-2 py-1.5 text-right ${
                          o.unrealizedPnl == null
                            ? "text-ink-3"
                            : o.unrealizedPnl >= 0
                              ? "text-up"
                              : "text-down"
                        }`}
                      >
                        {o.unrealizedPnl != null ? o.unrealizedPnl.toFixed(2) : "—"}
                      </td>
                      <td className="max-w-[140px] truncate px-2 py-1.5 text-ink-3">
                        {[o.strategy, o.notes].filter(Boolean).join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-lg border border-line/50 bg-bg-2/30 px-3 py-2">
            {renderMarkdownLite(result.narrative)}
          </div>
        </div>
      )}
    </Panel>
  );
}
