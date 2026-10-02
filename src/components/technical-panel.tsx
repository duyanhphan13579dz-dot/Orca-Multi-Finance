"use client";

import { useState } from "react";
import type { CandlePattern, TechnicalSnapshot } from "@/lib/types";
import { Badge, fmtNum, Panel, priceDigits } from "@/components/ui";
import {
  Crosshair,
  Gauge,
  LineChart,
  Shield,
  TrendingDown,
  TrendingUp,
  Waves,
  Compass,
  Activity,
  ChevronDown,
} from "lucide-react";

const TREND_LABEL: Record<string, { vi: string; tone: "up" | "down" | "neutral" }> = {
  "strong-up": { vi: "Tăng mạnh", tone: "up" },
  up: { vi: "Tăng", tone: "up" },
  sideways: { vi: "Đi ngang", tone: "neutral" },
  down: { vi: "Giảm", tone: "down" },
  "strong-down": { vi: "Giảm mạnh", tone: "down" },
};

const SIGNAL_PREVIEW = 3;

export function TechnicalPanel({
  tech,
  patterns,
  ticker,
  variant = "stacked",
}: {
  tech: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  ticker?: { high?: number | null; low?: number | null; price?: number | null } | null;
  variant?: "stacked" | "compact";
}) {
  const [signalsOpen, setSignalsOpen] = useState(false);

  if (!tech) {
    return (
      <Panel title="Phân tích kỹ thuật" className="h-full">
        <p className="text-[12px] text-text-muted">Chưa đủ dữ liệu chuỗi giá để tính toán chỉ báo.</p>
      </Panel>
    );
  }
  const t = TREND_LABEL[tech.trend.label] ?? { vi: tech.trend.label, tone: "neutral" as const };
  const digits = priceDigits(tech.last);
  const sig = tech.tradeSignal;
  const allSignals = tech.signals ?? [];
  const visibleSignals = signalsOpen ? allSignals : allSignals.slice(0, SIGNAL_PREVIEW);
  const hiddenCount = Math.max(0, allSignals.length - SIGNAL_PREVIEW);

  // Compute Standard Floor Pivot Points
  const high = ticker?.high ?? tech.last * 1.015;
  const low = ticker?.low ?? tech.last * 0.985;
  const close = tech.last;
  const pp = (high + low + close) / 3;
  const r1 = 2 * pp - low;
  const s1 = 2 * pp - high;
  const r2 = pp + (high - low);
  const s2 = pp - (high - low);

  return (
    <div className={variant === "compact" ? "h-full" : "space-y-3"}>
      <Panel
        className="h-full flex flex-col justify-between"
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-4 text-accent-primary" /> Phân tích kỹ thuật chuyên sâu
          </span>
        }
        right={
          <Badge tone={t.tone}>
            {t.tone === "up" ? (
              <TrendingUp className="size-3" />
            ) : t.tone === "down" ? (
              <TrendingDown className="size-3" />
            ) : null}
            {t.vi} ({tech.trend.score >= 0 ? "+" : ""}
            {tech.trend.score.toFixed(1)})
          </Badge>
        }
      >
        <div className="space-y-2.5">
          {sig ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-elevated/60 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={
                    "rounded-md px-2 py-0.5 text-[11px] font-bold " +
                    (sig.action === "buy"
                      ? "bg-positive/20 text-positive"
                      : sig.action === "sell"
                        ? "bg-negative/20 text-negative"
                        : "bg-surface-elevated text-text-muted")
                  }
                >
                  {sig.actionVi}
                </span>
                <span className="text-[11.5px] font-semibold tabular-nums text-text-primary">
                  Độ tin cậy {sig.confidence}%
                </span>
              </div>
              {sig.reasons?.[0] ? (
                <span className="truncate text-[10.5px] text-text-muted">· {sig.reasons[0]}</span>
              ) : null}
            </div>
          ) : null}

          {/* Momentum Grid */}
          <div>
            <SectionLabel>Động lượng & Biên độ (Momentum)</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric
                label="RSI(14)"
                value={fmtNum(tech.rsi14, 1)}
                hint={
                  tech.rsi14 != null
                    ? tech.rsi14 >= 70
                      ? "quá mua"
                      : tech.rsi14 <= 30
                        ? "quá bán"
                        : "cân bằng"
                    : undefined
                }
                accent={
                  tech.rsi14 != null
                    ? tech.rsi14 >= 70
                      ? "down"
                      : tech.rsi14 <= 30
                        ? "up"
                        : null
                    : null
                }
              />
              <Metric
                label="MACD hist"
                value={tech.macd ? tech.macd.histogram.toPrecision(3) : "—"}
                hint={tech.macd ? (tech.macd.histogram > 0 ? "đà tăng" : "đà giảm") : undefined}
                accent={tech.macd ? (tech.macd.histogram > 0 ? "up" : "down") : null}
              />
              <Metric label="ATR(14)" value={fmtNum(tech.atr14, digits)} hint="biên dao động" />
              <Metric
                label="Volatility 30d"
                value={
                  tech.volatility30d != null ? `${(tech.volatility30d * 100).toFixed(1)}%` : "—"
                }
                hint="annualized"
              />
            </div>
          </div>

          {/* Moving Averages Grid */}
          <div>
            <SectionLabel>Hệ thống Đường Trung Bình (Moving Averages)</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric
                label="SMA20"
                value={fmtNum(tech.sma.sma20, digits)}
                above={cmp(tech.last, tech.sma.sma20)}
              />
              <Metric
                label="SMA50"
                value={fmtNum(tech.sma.sma50, digits)}
                above={cmp(tech.last, tech.sma.sma50)}
              />
              <Metric
                label="SMA200"
                value={fmtNum(tech.sma.sma200, digits)}
                above={cmp(tech.last, tech.sma.sma200)}
              />
              <Metric
                label="MAX DRAWDOWN (1Y)"
                value={pct(tech.maxDrawdown1y)}
                signed
                accent={
                  tech.maxDrawdown1y != null
                    ? tech.maxDrawdown1y < -0.2
                      ? "down"
                      : null
                    : null
                }
              />
            </div>
          </div>

          {/* Performance */}
          <div>
            <SectionLabel>Hiệu suất lợi nhuận (Performance)</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric label="7 NGÀY" value={pct(tech.perf?.d7)} signed />
              <Metric label="30 NGÀY" value={pct(tech.perf?.d30)} signed />
              <Metric label="YTD" value={pct(tech.perf?.ytd)} signed />
              <Metric label="1 NĂM" value={pct(tech.perf?.y1)} signed />
            </div>
          </div>

          {/* Support / Resistance */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <Shield className="size-3 text-positive" /> Vùng Hỗ trợ (Support)
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <Crosshair className="size-3 text-negative" /> Vùng Kháng cự (Resistance)
              </span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(tech.support ?? []).slice(0, 4).map((s) => (
                <span
                  key={`s-${s}`}
                  className="rounded-md bg-positive/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-positive"
                >
                  {fmtNum(s, digits)}
                </span>
              ))}
              {(tech.resistance ?? []).slice(0, 4).map((s) => (
                <span
                  key={`r-${s}`}
                  className="rounded-md bg-negative/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-negative"
                >
                  {fmtNum(s, digits)}
                </span>
              ))}
            </div>

            <SectionLabel>Điểm xoay Pivot Points (Classic Floor)</SectionLabel>
            <div className="grid grid-cols-2 gap-1 text-center text-[11px] md:grid-cols-4">
              <div className="rounded border border-positive/20 bg-positive/5 p-1">
                <span className="block text-[8.5px] text-text-muted">S2 (Hỗ trợ 2)</span>
                <strong className="num text-positive">{fmtNum(s2, digits)}</strong>
              </div>
              <div className="rounded border border-positive/20 bg-positive/5 p-1">
                <span className="block text-[8.5px] text-text-muted">S1 (Hỗ trợ 1)</span>
                <strong className="num text-positive">{fmtNum(s1, digits)}</strong>
              </div>
              <div className="rounded border border-negative/20 bg-negative/5 p-1">
                <span className="block text-[8.5px] text-text-muted">R1 (Kháng cự 1)</span>
                <strong className="num text-negative">{fmtNum(r1, digits)}</strong>
              </div>
              <div className="rounded border border-negative/20 bg-negative/5 p-1">
                <span className="block text-[8.5px] text-text-muted">R2 (Kháng cự 2)</span>
                <strong className="num text-negative">{fmtNum(r2, digits)}</strong>
              </div>
            </div>
            <p className="mt-1 text-right text-[9px] text-text-muted">
              Pivot: {fmtNum(pp, digits)}
            </p>
          </div>
        </div>

        {variant === "stacked" && allSignals.length > 0 && (
          <div className="mt-3 border-t border-border-subtle/60 pt-2.5">
            <ul className="space-y-1">
              {visibleSignals.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[11.5px] text-text-secondary">
                  <LineChart className="mt-0.5 size-3.5 shrink-0 text-accent-primary" />
                  {s}
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setSignalsOpen((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent-primary hover:bg-surface-elevated"
              >
                <ChevronDown
                  className={`size-3.5 transition-transform ${signalsOpen ? "rotate-180" : ""}`}
                />
                {signalsOpen ? "Thu gọn" : `Xem thêm ${hiddenCount} tín hiệu`}
              </button>
            )}
          </div>
        )}
      </Panel>

      {variant === "stacked" && (
        <>
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Waves className="size-4 text-accent-primary" /> Mô hình nến nhận diện
              </span>
            }
          >
            {!patterns.length ? (
              <p className="text-[12px] text-text-muted">
                Không có mô hình nến đáng chú ý trong 5 kỳ gần nhất — thị trường đang vận động theo
                cấu trúc thông thường.
              </p>
            ) : (
              <div className="space-y-2">
                {patterns.map((p) => (
                  <div key={p.name} className="panel-inset p-2.5">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-text-primary">{p.nameVi}</span>
                      <span className="text-[10px] text-text-muted">({p.name})</span>
                      <Badge
                        tone={
                          p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"
                        }
                      >
                        {p.type === "bullish"
                          ? "thiên tăng"
                          : p.type === "bearish"
                            ? "thiên giảm"
                            : "trung tính"}
                      </Badge>
                      <Badge tone="warn">
                        độ tin cậy{" "}
                        {p.reliability === "high"
                          ? "cao"
                          : p.reliability === "medium"
                            ? "trung bình"
                            : "thấp"}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-text-secondary">
                      {p.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {tech.divergences && tech.divergences.length > 0 && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <LineChart className="size-4 text-accent-primary" /> Phân kỳ (divergence)
                </span>
              }
            >
              <div className="space-y-2">
                {tech.divergences.map((d, i) => {
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
                    <div key={`${d.kind}-${d.oscillator}-${i}`} className="panel-inset p-2.5">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={isBull ? "up" : "down"}>{kindLabel}</Badge>
                        <Badge tone="neutral">{osc}</Badge>
                        <Badge tone="warn">class {d.strength}</Badge>
                        <span className="text-[10px] text-text-muted">
                          conf {(d.confidence * 100).toFixed(0)}% · {d.barsBetween} nến
                        </span>
                      </div>
                      {d.notes ? (
                        <p className="text-[11px] text-text-secondary">{d.notes}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted ${className}`}
    >
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  above,
  signed,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  above?: boolean | null;
  signed?: boolean;
  accent?: "up" | "down" | null;
}) {
  const signedNum = signed ? parseFloat(value) : NaN;
  const tone =
    accent === "up"
      ? "text-positive"
      : accent === "down"
        ? "text-negative"
        : signed && Number.isFinite(signedNum)
          ? signedNum > 0
            ? "text-positive"
            : signedNum < 0
              ? "text-negative"
              : "text-text-primary"
          : "text-text-primary";
  return (
    <div className="panel-inset p-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
        {above != null && (
          <span
            className={`size-1.5 rounded-full ${above ? "bg-positive" : "bg-negative"}`}
            title={above ? "Giá trên đường này" : "Giá dưới đường này"}
          />
        )}
      </div>
      <div className={`num mt-0.5 text-[12.5px] font-semibold ${tone}`}>{value}</div>
      {hint && <div className="truncate text-[9px] text-text-muted">{hint}</div>}
    </div>
  );
}

function cmp(last: number, ma: number | null): boolean | null {
  return ma == null ? null : last >= ma;
}
function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * (Math.abs(v) <= 2 ? 100 : 1)).toFixed?.(1) ?? v}%`.replace(
    /(\d+\.\d)%/,
    (_, n) => {
      // if already percent-like (>2) don't *100 twice — handle both 0.12 and 12 styles
      return `${n}%`;
    },
  );
}
