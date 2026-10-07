"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "@/lib/hooks";
import type { StockStyleFitResult, StyleCriterionExplanation } from "@/lib/services/stock-style-fit";
import type { StructureAnalysis } from "@/lib/engines/wyckoff-elliott";
import type { CandlePattern, TechnicalSnapshot } from "@/lib/types";
import { Badge, FreshnessDot, Panel } from "@/components/ui";
import {
  CheckCircle2,
  ChevronRight,
  GitBranch,
  Layers,
  Shapes,
  X,
  XCircle,
} from "lucide-react";

type ItemKey = "canslim" | "wyckoff" | "elliott" | "minervini" | "patterns";
type StructureData = StructureAnalysis & { symbol: string };

function biasTone(b: string): "up" | "down" | "neutral" {
  if (b === "bullish") return "up";
  if (b === "bearish") return "down";
  return "neutral";
}

const VOL_VI: Record<string, string> = {
  rising: "tăng",
  falling: "giảm",
  flat: "đi ngang",
};

const DEGREE_VI: Record<string, string> = {
  minor: "nhỏ",
  intermediate: "trung gian",
};

export function PatternAnalysisHub({
  symbol,
  patterns = [],
  technical = null,
}: {
  symbol: string;
  patterns?: CandlePattern[];
  technical?: TechnicalSnapshot | null;
}) {
  const [open, setOpen] = useState<ItemKey | null>(null);

  const { data: styleFit, isLoading: styleLoading, meta: styleMeta } = useApi<StockStyleFitResult>(
    symbol ? `/api/v1/stocks/${symbol}/style-fit` : null,
    { refreshInterval: 120_000 },
  );
  const { data: structure, isLoading: structLoading, meta: structMeta } = useApi<StructureData>(
    symbol ? `/api/v1/stocks/${symbol}/structure` : null,
    { refreshInterval: 120_000 },
  );

  const divergences = technical?.divergences ?? [];

  const items = useMemo(() => {
    const canslimScore =
      styleFit?.canslim != null ? `${styleFit.canslim.passCount}/${styleFit.canslim.total}` : "—";
    const minScore =
      styleFit?.minervini != null
        ? `${styleFit.minervini.passCount}/${styleFit.minervini.total}`
        : "—";
    const wyckoffScore =
      structure?.wyckoff != null ? `${structure.wyckoff.confidence}%` : "—";
    const elliottScore =
      structure?.elliott != null ? `${structure.elliott.confidence}%` : "—";
    const patternScore =
      patterns.length || divergences.length
        ? `${patterns.length + divergences.length}`
        : "—";

    return [
      {
        key: "canslim" as const,
        label: "CANSLIM",
        score: canslimScore,
        tone:
          styleFit?.canslim != null && styleFit.canslim.score >= 40
            ? ("up" as const)
            : ("neutral" as const),
      },
      {
        key: "wyckoff" as const,
        label: "Wyckoff",
        score: wyckoffScore,
        tone: structure?.wyckoff ? biasTone(structure.wyckoff.bias) : ("neutral" as const),
      },
      {
        key: "elliott" as const,
        label: "Elliott",
        score: elliottScore,
        tone: structure?.elliott ? biasTone(structure.elliott.bias) : ("neutral" as const),
      },
      {
        key: "minervini" as const,
        label: "Minervini",
        score: minScore,
        tone:
          styleFit?.minervini != null && styleFit.minervini.passCount >= 6
            ? ("up" as const)
            : ("neutral" as const),
      },
      {
        key: "patterns" as const,
        label: "Pattern / Setup",
        score: patternScore,
        tone: patterns.some((p) => p.type === "bullish")
          ? ("up" as const)
          : patterns.some((p) => p.type === "bearish")
            ? ("down" as const)
            : ("neutral" as const),
      },
    ];
  }, [styleFit, structure, patterns, divergences.length]);

  const warming = (styleLoading && !styleFit) || (structLoading && !structure);

  return (
    <>
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Shapes className="size-4 text-accent-primary" /> Phân tích mẫu hình
            {(styleMeta || structMeta) && (
              <FreshnessDot
                status={styleMeta?.freshness ?? structMeta?.freshness}
                ageMs={styleMeta?.ageMs ?? structMeta?.ageMs}
              />
            )}
          </span>
        }
        right={
          <span className="text-[10px] text-text-muted">
            {warming ? "Đang làm nóng…" : "Chọn mục để xem chi tiết"}
          </span>
        }
      >
        <ul className="divide-y divide-border-subtle/80">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setOpen(item.key)}
                className="orca-interactive flex w-full items-center justify-between gap-3 rounded-md px-0.5 py-2.5 text-left hover:bg-surface-elevated/40"
              >
                <span className="text-[13px] font-medium text-text-primary">{item.label}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-md border border-border-subtle bg-surface-elevated/70 px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                      item.tone === "up"
                        ? "text-positive"
                        : item.tone === "down"
                          ? "text-negative"
                          : "text-text-muted"
                    }`}
                  >
                    {item.score}
                  </span>
                  <ChevronRight className="size-3.5 text-text-muted" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {open && (
        <DetailModal
          title={
            open === "canslim"
              ? "CANSLIM"
              : open === "minervini"
                ? "Mark Minervini"
                : open === "wyckoff"
                  ? "Wyckoff"
                  : open === "elliott"
                    ? "Elliott Wave"
                    : "Pattern / Setup"
          }
          onClose={() => setOpen(null)}
        >
          {open === "canslim" && (
            <CriteriaDetail
              empty={!styleFit?.canslim && !styleLoading}
              loading={styleLoading && !styleFit}
              summary={
                styleFit?.canslim
                  ? `Score ${styleFit.canslim.score}/100 · Grade ${styleFit.canslim.grade} · ${styleFit.canslim.passCount}/${styleFit.canslim.total} chữ`
                  : undefined
              }
              criteria={styleFit?.canslim?.letters ?? []}
              note={
                styleFit?.canslim
                  ? `${styleFit.canslim.note}${styleFit.canslim.phase ? ` · phase ${styleFit.canslim.phase}` : ""}`
                  : styleFit?.notes?.join(" · ")
              }
            />
          )}
          {open === "minervini" && (
            <CriteriaDetail
              empty={!styleFit?.minervini && !styleLoading}
              loading={styleLoading && !styleFit}
              summary={
                styleFit?.minervini
                  ? `${styleFit.minervini.passCount}/${styleFit.minervini.total} điều kiện${styleFit.minervini.stage2 ? " · Stage 2" : ""}`
                  : undefined
              }
              criteria={styleFit?.minervini?.criteria ?? []}
              note={styleFit?.minervini?.note ?? styleFit?.notes?.join(" · ")}
            />
          )}
          {open === "wyckoff" && structure && (
            <WyckoffDetail w={structure.wyckoff} summary={structure.summary} />
          )}
          {open === "wyckoff" && !structure && (
            <p className="text-[12px] text-text-muted">
              {structLoading ? "Đang tải cấu trúc Wyckoff…" : "Chưa đủ chuỗi giá để đọc Wyckoff."}
            </p>
          )}
          {open === "elliott" && structure && <ElliottDetail e={structure.elliott} />}
          {open === "elliott" && !structure && (
            <p className="text-[12px] text-text-muted">
              {structLoading ? "Đang tải cấu trúc Elliott…" : "Chưa đủ chuỗi giá để đọc Elliott."}
            </p>
          )}
          {open === "patterns" && (
            <PatternsDetail patterns={patterns} divergences={divergences} />
          )}
        </DetailModal>
      )}
    </>
  );
}

function DetailModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const requestClose = () => {
    setLeaving((prev) => {
      if (prev) return prev;
      window.setTimeout(() => onClose(), 180);
      return true;
    });
  };

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLeaving((prev) => {
          if (prev) return prev;
          window.setTimeout(() => onClose(), 180);
          return true;
        });
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    const sb = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (sb > 0) document.body.style.paddingRight = `${sb}px`;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="orca-modal-root fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className={`orca-modal-overlay absolute inset-0 cursor-default border-0 bg-black/70 backdrop-blur-[3px]${leaving ? " is-leaving" : ""}`}
        aria-label="Đóng"
        onClick={requestClose}
      />
      <div
        className={`orca-modal-panel relative z-[1] flex max-h-[min(86vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-primary shadow-2xl shadow-black/50${leaving ? " is-leaving" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary"
            aria-label="Đóng chi tiết"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function CriteriaDetail({
  empty,
  loading,
  summary,
  criteria,
  note,
}: {
  empty: boolean;
  loading?: boolean;
  summary?: string;
  criteria: StyleCriterionExplanation[];
  note?: string;
}) {
  if (loading) {
    return <p className="text-[12px] text-text-muted">Đang tải điều kiện bộ lọc…</p>;
  }
  if (empty) {
    return (
      <p className="text-[12px] text-text-muted">
        Chưa đủ dữ liệu OHLCV / BCTC để đánh giá bộ lọc này.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {summary && (
        <div className="rounded-lg border border-border-subtle bg-surface-elevated/50 px-3 py-2 text-[12.5px] font-medium text-text-primary">
          {summary}
        </div>
      )}
      <div className="space-y-1.5">
        {criteria.map((c) => (
          <div
            key={c.key}
            className="flex items-start gap-2 rounded-md border border-border-subtle/70 px-2.5 py-2"
          >
            {c.pass ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-positive" />
            ) : (
              <XCircle className="mt-0.5 size-3.5 shrink-0 text-negative" />
            )}
            <div className="min-w-0">
              <div
                className={`text-[12px] font-medium ${c.pass ? "text-text-primary" : "text-text-secondary"}`}
              >
                {c.label}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-text-muted">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {note && <p className="text-[11px] leading-relaxed text-text-muted">{note}</p>}
    </div>
  );
}

function WyckoffDetail({
  w,
  summary,
}: {
  w: StructureAnalysis["wyckoff"];
  summary: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-text-secondary">{summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={biasTone(w.bias)}>{w.confidence}%</Badge>
        <span className="text-[13px] font-semibold text-text-primary">{w.phaseVi}</span>
      </div>
      <div className="text-[12px] text-text-muted">
        Khối lượng: {VOL_VI[w.volumeTrend] ?? w.volumeTrend}
        {w.range && (
          <span className="num">
            {" "}
            · Range {w.range.low.toLocaleString("vi-VN")} – {w.range.high.toLocaleString("vi-VN")}
          </span>
        )}
      </div>
      {w.events.length > 0 && (
        <ul className="space-y-1">
          {w.events.map((ev, i) => (
            <li key={i} className="text-[12px] text-text-secondary">
              ▸ {ev}
            </li>
          ))}
        </ul>
      )}
      {w.notes.map((n, i) => (
        <p key={i} className="text-[11px] text-text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}

function ElliottDetail({ e }: { e: StructureAnalysis["elliott"] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="size-4 text-accent-primary" />
        <span className="text-[13px] font-semibold text-text-primary">{e.patternVi}</span>
        <Badge tone={biasTone(e.bias)}>{e.confidence}%</Badge>
      </div>
      <div className="text-[12px] text-text-muted">Cấp độ: {DEGREE_VI[e.degree] ?? e.degree}</div>
      {e.waves.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {e.waves.map((wv, i) => (
            <span
              key={i}
              className="num rounded bg-surface-elevated px-2 py-1 text-[11px] text-text-secondary"
            >
              {wv.label}: {wv.price.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-md border border-border-subtle px-2.5 py-2">
          <div className="text-[10px] uppercase text-text-muted">Vô hiệu</div>
          <div className="num mt-0.5 font-medium text-text-primary">
            {e.invalidation != null
              ? e.invalidation.toLocaleString("vi-VN", { maximumFractionDigits: 2 })
              : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border-subtle px-2.5 py-2">
          <div className="text-[10px] uppercase text-text-muted">Mục tiêu</div>
          <div className="num mt-0.5 font-medium text-text-primary">
            {e.nextTarget != null
              ? e.nextTarget.toLocaleString("vi-VN", { maximumFractionDigits: 2 })
              : "—"}
          </div>
        </div>
      </div>
      {e.notes.map((n, i) => (
        <p key={i} className="text-[11px] text-text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}

function PatternsDetail({
  patterns,
  divergences,
}: {
  patterns: CandlePattern[];
  divergences: NonNullable<TechnicalSnapshot["divergences"]>;
}) {
  if (!patterns.length && !divergences.length) {
    return (
      <p className="text-[12px] text-text-muted">
        Không có mẫu hình nến / phân kỳ đáng chú ý trên dữ liệu hiện có.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          <Layers className="size-3.5" /> Mẫu hình nến
        </div>
        {!patterns.length ? (
          <p className="text-[12px] text-text-muted">Không có mô hình nến nổi bật gần đây.</p>
        ) : (
          <div className="space-y-2">
            {patterns.map((p) => (
              <div key={p.name} className="rounded-md border border-border-subtle px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-text-primary">{p.nameVi}</span>
                  <span className="text-[10px] text-text-muted">({p.name})</span>
                  <Badge
                    tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}
                  >
                    {p.type === "bullish"
                      ? "thiên tăng"
                      : p.type === "bearish"
                        ? "thiên giảm"
                        : "trung tính"}
                  </Badge>
                  <Badge tone="warn">
                    tin cậy{" "}
                    {p.reliability === "high"
                      ? "cao"
                      : p.reliability === "medium"
                        ? "TB"
                        : "thấp"}
                  </Badge>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
                  {p.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {divergences.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Phân kỳ (divergence)
          </div>
          <div className="space-y-2">
            {divergences.map((d, i) => {
              const isBull = d.kind.includes("bullish");
              const osc =
                d.oscillator === "rsi"
                  ? "RSI"
                  : d.oscillator === "macd_hist"
                    ? "MACD hist"
                    : d.oscillator;
              const kindLabel =
                d.kind === "regular_bullish"
                  ? "Regular ↑ đảo chiều lên"
                  : d.kind === "regular_bearish"
                    ? "Regular ↓ đảo chiều xuống"
                    : d.kind === "hidden_bullish"
                      ? "Hidden ↑ tiếp diễn"
                      : d.kind === "hidden_bearish"
                        ? "Hidden ↓ tiếp diễn"
                        : d.kind;
              return (
                <div
                  key={`${d.kind}-${d.oscillator}-${i}`}
                  className="rounded-md border border-border-subtle px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={isBull ? "up" : "down"}>{kindLabel}</Badge>
                    <Badge tone="neutral">{osc}</Badge>
                    <Badge tone="warn">class {d.strength}</Badge>
                    <span className="text-[10px] text-text-muted">
                      conf {(d.confidence * 100).toFixed(0)}% · {d.barsBetween} nến
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
