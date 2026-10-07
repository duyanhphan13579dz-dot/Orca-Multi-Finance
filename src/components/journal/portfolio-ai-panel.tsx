"use client";

import { useState } from "react";
import {
  Bot,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Crosshair,
} from "lucide-react";
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

function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, j) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return (
            <strong key={j} className="font-semibold text-text-primary">
              {p.slice(2, -2)}
            </strong>
          );
        }
        if (p.startsWith("`") && p.endsWith("`")) {
          return (
            <code
              key={j}
              className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px] text-accent-primary"
            >
              {p.slice(1, -1)}
            </code>
          );
        }
        return <span key={j}>{p}</span>;
      })}
    </>
  );
}

type Section = {
  title: string;
  icon: "summary" | "market" | "note" | "risk" | "default";
  lines: string[];
};

function splitSections(narrative: string): Section[] {
  const lines = narrative.split("\n");
  const sections: Section[] = [];
  let cur: Section = { title: "", icon: "default", lines: [] };

  const classify = (t: string): Section["icon"] => {
    const low = t.toLowerCase();
    if (/tóm tắt|vị thế|open|position/.test(low)) return "summary";
    if (/thị trường|market|hub|điều kiện/.test(low)) return "market";
    if (/rủi ro|risk|kỷ luật|discipline/.test(low)) return "risk";
    if (/nhận xét|kết luận|outlook|gợi ý/.test(low)) return "note";
    return "default";
  };

  for (const raw of lines) {
    const t = raw.trim();
    const isHeading =
      t.startsWith("## ") ||
      t.startsWith("### ") ||
      (/^[A-ZÀ-Ỵ]/.test(t) &&
        t.length < 80 &&
        !t.startsWith("-") &&
        !t.startsWith("*") &&
        !t.startsWith("•") &&
        (t.endsWith(":") ||
          /^(Tóm tắt|Đánh giá|Nhận xét|Rủi ro|Kỷ luật|Market|PORTFOLIO)/i.test(t)));

    if (isHeading) {
      if (cur.lines.length || cur.title) sections.push(cur);
      const title = t.replace(/^#+\s*/, "").replace(/:$/, "");
      cur = { title, icon: classify(title), lines: [] };
      continue;
    }
    if (t) cur.lines.push(t);
  }
  if (cur.lines.length || cur.title) sections.push(cur);
  return sections.filter((s) => s.title || s.lines.length);
}

function SectionIcon({ icon }: { icon: Section["icon"] }) {
  const cls = "size-3.5 shrink-0";
  if (icon === "summary") return <Crosshair className={`${cls} text-accent-primary`} />;
  if (icon === "market") return <BarChart3 className={`${cls} text-sky-400`} />;
  if (icon === "risk") return <AlertTriangle className={`${cls} text-amber-400`} />;
  if (icon === "note") return <Sparkles className={`${cls} text-violet-400`} />;
  return <Bot className={`${cls} text-text-muted`} />;
}

function sectionAccent(icon: Section["icon"]): string {
  if (icon === "summary") return "border-accent-primary/30 bg-accent-primary/5";
  if (icon === "market") return "border-sky-500/25 bg-sky-500/5";
  if (icon === "risk") return "border-amber-500/25 bg-amber-500/5";
  if (icon === "note") return "border-violet-500/25 bg-violet-500/5";
  return "border-border-subtle bg-surface-elevated/40";
}

function NarrativeBlocks({ text }: { text: string }) {
  const sections = splitSections(text);
  if (!sections.length) {
    return <p className="text-[12.5px] text-text-secondary">{text}</p>;
  }

  return (
    <div className="space-y-2.5">
      {sections.map((sec, si) => (
        <div key={si} className={`rounded-xl border px-3 py-2.5 ${sectionAccent(sec.icon)}`}>
          {sec.title ? (
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-text-primary">
              <SectionIcon icon={sec.icon} />
              {sec.title}
            </div>
          ) : null}
          <div className="space-y-1">
            {sec.lines.map((line, li) => {
              const t = line.trim();
              if (/^[-•*]\s/.test(t) || /^\*\s+\*\*/.test(t)) {
                const body = t.replace(/^[-•*]\s+/, "").replace(/^\*\s+/, "");
                return (
                  <div
                    key={li}
                    className="flex gap-2 text-[12.5px] leading-relaxed text-text-secondary"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-primary/70" />
                    <span className="min-w-0">
                      <InlineMd text={body} />
                    </span>
                  </div>
                );
              }
              return (
                <p key={li} className="text-[12.5px] leading-relaxed text-text-secondary">
                  <InlineMd text={t} />
                </p>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral" | "accent";
}) {
  const color =
    tone === "up"
      ? "text-up border-up/25 bg-up/10"
      : tone === "down"
        ? "text-down border-down/25 bg-down/10"
        : tone === "accent"
          ? "text-accent-primary border-accent-primary/30 bg-accent-primary/10"
          : "text-text-secondary border-border-subtle bg-surface-elevated/60";
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${color}`}>
      <div className="text-[9.5px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="num text-[13px] font-semibold">{value}</div>
    </div>
  );
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
      <p className="mb-2 text-[11.5px] text-text-muted">
        Đọc nhật ký, exposure, volatility, risk alerts và vị thế đang mở · LLM nhận xét khi có API key.
        {trades.length > 0 && (
          <span className="ml-1 text-text-secondary">
            ({closedN} đóng · {openN} mở)
          </span>
        )}
      </p>

      {err && <p className="text-[12px] text-down">{err}</p>}

      {!result && !err && (
        <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-2.5 text-[12px] text-text-muted">
          <Bot className="mt-0.5 size-4 shrink-0 text-accent-primary" />
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
            {result.model && <Badge tone="neutral">{result.model}</Badge>}
            <Badge tone="neutral">{s.open} mở</Badge>
            <Badge tone="neutral">{s.closed} đóng</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {s.winRate != null && (
              <StatChip
                label="Win rate"
                value={`${(s.winRate * 100).toFixed(0)}%`}
                tone={s.winRate >= 0.5 ? "up" : "down"}
              />
            )}
            {s.unrealizedPnl != null && (
              <StatChip
                label="uPnL"
                value={s.unrealizedPnl.toFixed(2)}
                tone={s.unrealizedPnl >= 0 ? "up" : "down"}
              />
            )}
            {s.totalPnl != null && (
              <StatChip
                label="PnL đóng"
                value={s.totalPnl.toFixed(2)}
                tone={s.totalPnl >= 0 ? "up" : "down"}
              />
            )}
            {s.profitFactor != null && (
              <StatChip
                label="Profit factor"
                value={s.profitFactor.toFixed(2)}
                tone={s.profitFactor >= 1 ? "up" : "down"}
              />
            )}
            {s.avgR != null && <StatChip label="Avg R" value={s.avgR.toFixed(2)} tone="accent" />}
            {s.expectancy != null && (
              <StatChip
                label="Expectancy"
                value={s.expectancy.toFixed(2)}
                tone={s.expectancy >= 0 ? "up" : "down"}
              />
            )}
            {s.maxConsecLosses > 0 && (
              <StatChip label="Chuỗi thua max" value={String(s.maxConsecLosses)} tone="neutral" />
            )}
          </div>

          {result.openMarks && result.openMarks.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Vị thế mở
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.openMarks.map((o) => {
                  const pnl = o.unrealizedPnl;
                  const neg = pnl != null && pnl < 0;
                  const pos = pnl != null && pnl >= 0;
                  return (
                    <div
                      key={`${o.symbol}-${o.entry}`}
                      className={`rounded-xl border px-3 py-2.5 ${
                        neg
                          ? "border-down/30 bg-down/5"
                          : pos
                            ? "border-up/30 bg-up/5"
                            : "border-border-subtle bg-surface-elevated/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-bold text-text-primary">{o.symbol}</span>
                          <Badge tone={o.side === "short" ? "down" : "up"}>{o.side}</Badge>
                          {neg ? (
                            <TrendingDown className="size-3.5 text-down" />
                          ) : pos ? (
                            <TrendingUp className="size-3.5 text-up" />
                          ) : null}
                        </div>
                        <span
                          className={`num text-[14px] font-semibold ${
                            neg ? "text-down" : pos ? "text-up" : "text-text-muted"
                          }`}
                        >
                          {pnl != null ? (pnl >= 0 ? "+" : "") + pnl.toFixed(2) : "—"}
                        </span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] text-text-muted">
                        <div>
                          <span className="block text-[9px] uppercase opacity-70">Entry</span>
                          <span className="num text-text-secondary">{o.entry}</span>
                        </div>
                        <div>
                          <span className="block text-[9px] uppercase opacity-70">Mark</span>
                          <span className="num text-text-secondary">
                            {o.mark != null ? o.mark.toFixed(2) : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[9px] uppercase opacity-70">SL / TP</span>
                          <span className="num text-text-secondary">
                            {o.distToSlPct != null ? `${o.distToSlPct.toFixed(1)}%` : "—"}
                            {" / "}
                            {o.distToTpPct != null ? `${o.distToTpPct.toFixed(1)}%` : "—"}
                          </span>
                        </div>
                      </div>
                      {(o.strategy || o.notes) && (
                        <p className="mt-1.5 truncate text-[11px] text-text-muted">
                          {[o.strategy, o.notes].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Phân tích ORCA
            </div>
            <NarrativeBlocks text={result.narrative} />
          </div>
        </div>
      )}
    </Panel>
  );
}
