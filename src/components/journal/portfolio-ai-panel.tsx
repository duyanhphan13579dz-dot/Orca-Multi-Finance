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

type AnalyzeResult = {
  stats: {
    total: number;
    closed: number;
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    avgR: number | null;
    totalPnl: number | null;
    maxConsecLosses: number;
  };
  narrative: string;
  mode: "deterministic" | "llm";
  model: string | null;
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
    if (/^[-•*]\s/.test(t)) {
      return (
        <p key={i} className="mt-1 pl-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="text-ink-3">• </span>
          {t.replace(/^[-•*]\s/, "")}
        </p>
      );
    }
    if (!t) return <div key={i} className="h-1.5" />;
    // bold **x**
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

export function PortfolioAiPanel({ trades }: { trades: TradeLite[] }) {
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
        body: JSON.stringify({ trades }),
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

  return (
    <Panel
      title="Đánh giá danh mục AI"
      right={
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-1 text-[11px] font-medium text-accent-primary disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {loading ? "Đang phân tích…" : "Phân tích danh mục"}
        </button>
      }
    >
      <p className="mb-2 text-[11.5px] text-ink-3">
        Tính win rate, profit factor, R-multiple từ nhật ký · bổ sung nhận xét LLM khi hệ thống có API key.
      </p>

      {err && <p className="text-[12px] text-down">{err}</p>}

      {!result && !err && (
        <div className="flex items-start gap-2 rounded-lg border border-line/60 bg-bg-2/40 px-3 py-2.5 text-[12px] text-ink-3">
          <Bot className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>Bấm "Phân tích danh mục" để ORCA đọc toàn bộ lệnh đã ghi và đưa nhận xét.</span>
        </div>
      )}

      {result && s && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{result.mode === "llm" ? "LLM" : "Stats"}</Badge>
            {result.model && <Badge tone="accent">{result.model}</Badge>}
            <Badge tone={s.winRate != null && s.winRate >= 0.5 ? "up" : "down"}>
              WR {s.winRate != null ? `${(s.winRate * 100).toFixed(0)}%` : "—"}
            </Badge>
            {s.profitFactor != null && <Badge tone="accent">PF {s.profitFactor.toFixed(2)}</Badge>}
            {s.avgR != null && <Badge tone="accent">Avg R {s.avgR.toFixed(2)}</Badge>}
            {s.totalPnl != null && (
              <Badge tone={s.totalPnl >= 0 ? "up" : "down">PnL {s.totalPnl.toFixed(1)}</Badge>
            )}
          </div>
          <div className="rounded-lg border border-line/50 bg-bg-2/30 px-3 py-2">
            {renderMarkdownLite(result.narrative)}
          </div>
        </div>
      )}
    </Panel>
  );
}
