"use client";

import type { CandlePattern, TechnicalSnapshot } from "@/lib/types";
import { Badge, fmtNum, Panel, priceDigits } from "@/components/ui";
import { Crosshair, Gauge, LineChart, Shield, TrendingDown, TrendingUp, Waves } from "lucide-react";

const TREND_LABEL: Record<string, { vi: string; tone: "up" | "down" | "neutral" }> = {
  "strong-up": { vi: "Tăng mạnh", tone: "up" },
  up: { vi: "Tăng", tone: "up" },
  sideways: { vi: "Đi ngang", tone: "neutral" },
  down: { vi: "Giảm", tone: "down" },
  "strong-down": { vi: "Giảm mạnh", tone: "down" },
};

export function TechnicalPanel({
  tech,
  patterns,
  variant = "stacked",
}: {
  tech: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  variant?: "stacked" | "compact";
}) {
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

  return (
    <div className={variant === "compact" ? "h-full" : "space-y-3"}>
      <Panel
        className="h-full flex flex-col justify-between"
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-4 text-accent-primary" /> Phân tích kỹ thuật
          </span>
        }
        right={
          <Badge tone={t.tone}>
            {t.tone === "up" ? <TrendingUp className="size-3" /> : t.tone === "down" ? <TrendingDown className="size-3" /> : null}
            {t.vi} ({tech.trend.score >= 0 ? "+" : ""}
            {tech.trend.score.toFixed(1)})
          </Badge>
        }
      >
        <div className="space-y-2.5">
          {sig ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-elevated/60 px-2.5 py-1.5">
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
              {sig.reasons?.[0] ? (
                <span className="truncate text-[10.5px] text-text-muted">· {sig.reasons[0]}</span>
              ) : null}
            </div>
          ) : null}

          <div>
            <SectionLabel>Momentum</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric
                label="RSI(14)"
                value={fmtNum(tech.rsi14, 1)}
                hint={tech.rsi14 != null ? (tech.rsi14 >= 70 ? "quá mua" : tech.rsi14 <= 30 ? "quá bán" : "cân bằng") : undefined}
                accent={tech.rsi14 != null ? (tech.rsi14 >= 70 ? "down" : tech.rsi14 <= 30 ? "up" : null) : null}
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
                value={tech.volatility30d != null ? `${(tech.volatility30d * 100).toFixed(1)}%` : "—"}
                hint="annualized"
              />
            </div>
          </div>

          <div>
            <SectionLabel>Đường trung bình</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric label="SMA20" value={fmtNum(tech.sma.sma20, digits)} above={cmp(tech.last, tech.sma.sma20)} />
              <Metric label="SMA50" value={fmtNum(tech.sma.sma50, digits)} above={cmp(tech.last, tech.sma.sma50)} />
              <Metric label="SMA200" value={fmtNum(tech.sma.sma200, digits)} above={cmp(tech.last, tech.sma.sma200)} />
              <Metric label="Max drawdown (1Y)" value={tech.maxDrawdown != null ? `${(tech.maxDrawdown * 100).toFixed(1)}%` : "—"} />
            </div>
          </div>

          <div>
            <SectionLabel>Hiệu suất</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric label="7 ngày" value={pct(tech.returns.d7)} signed />
              <Metric label="30 ngày" value={pct(tech.returns.d30)} signed />
              <Metric label="YTD" value={pct(tech.returns.ytd)} signed />
              <Metric label="1 năm" value={pct(tech.returns.y1)} signed />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="panel-inset p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium text-text-secondary">
                <Shield className="size-3.5 text-positive" /> Vùng Hỗ trợ
              </div>
              <div className="num flex flex-wrap gap-1 text-[11px]">
                {tech.support.length ? (
                  tech.support.map((s) => (
                    <span key={s} className="rounded bg-positive/10 px-1.5 py-0.5 text-positive">
                      {fmtNum(s, digits)}
                    </span>
                  ))
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </div>
            </div>
            <div className="panel-inset p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium text-text-secondary">
                <Crosshair className="size-3.5 text-negative" /> Vùng Kháng cự
              </div>
              <div className="num flex flex-wrap gap-1 text-[11px]">
                {tech.resistance.length ? (
                  tech.resistance.map((s) => (
                    <span key={s} className="rounded bg-negative/10 px-1.5 py-0.5 text-negative">
                      {fmtNum(s, digits)}
                    </span>
                  ))
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {variant === "stacked" && tech.signals?.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border-subtle/60 pt-2.5">
            {tech.signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] text-text-secondary">
                <LineChart className="mt-0.5 size-3.5 shrink-0 text-accent-primary" />
                {s}
              </li>
            ))}
          </ul>
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
                Không có mô hình nến đáng chú ý trong 5 kỳ gần nhất — thị trường đang vận động theo cấu trúc thông thường.
              </p>
            ) : (
              <div className="space-y-2">
                {patterns.map((p) => (
                  <div key={p.name} className="panel-inset p-2.5">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-text-primary">{p.nameVi}</span>
                      <span className="text-[10px] text-text-muted">({p.name})</span>
                      <Badge tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}>
                        {p.type === "bullish" ? "thiên tăng" : p.type === "bearish" ? "thiên giảm" : "trung tính"}
                      </Badge>
                      <Badge tone="warn">
                        độ tin cậy {p.reliability === "high" ? "cao" : p.reliability === "medium" ? "trung bình" : "thấp"}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-text-secondary">{p.description}</p>
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
                    d.oscillator === "rsi" ? "RSI" : d.oscillator === "macd_hist" ? "MACD hist" : d.oscillator;
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
                      <p className="text-[11px] text-text-secondary">
                        Pivot giá {fmtNum(d.pricePivots[0].price, digits)} → {fmtNum(d.pricePivots[1].price, digits)} · osc{" "}
                        {d.oscPivots[0].value.toFixed(2)} → {d.oscPivots[1].value.toFixed(2)}
                      </p>
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

export function PatternsAndDivergencePanel({
  tech,
  patterns,
}: {
  tech: TechnicalSnapshot | null;
  patterns: CandlePattern[];
}) {
  const digits = tech ? priceDigits(tech.last) : 2;
  const divergences = tech?.divergences ?? [];
  const signals = tech?.signals ?? [];

  return (
    <Panel
      className="h-full flex flex-col justify-between"
      title={
        <span className="flex items-center gap-2">
          <Waves className="size-4 text-accent-primary" /> Mẫu hình nến & Phân kỳ
        </span>
      }
      right={
        <div className="flex items-center gap-1.5">
          <Badge tone={patterns.length ? "up" : "neutral"}>{patterns.length} mô hình</Badge>
          {divergences.length > 0 && <Badge tone="warn">{divergences.length} phân kỳ</Badge>}
        </div>
      }
    >
      <div className="flex-1 space-y-3 overflow-y-auto max-h-[380px] pr-1">
        {/* Candlestick Patterns */}
        <div>
          <SectionLabel>Mô hình nến phát hiện ({patterns.length})</SectionLabel>
          {!patterns.length ? (
            <p className="text-[11px] text-text-muted">
              Không có mô hình nến đảo chiều bất thường trong 5 nến gần nhất.
            </p>
          ) : (
            <div className="space-y-1.5">
              {patterns.map((p) => (
                <div key={p.name} className="panel-inset p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] font-semibold text-text-primary">{p.nameVi}</span>
                    <Badge tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}>
                      {p.type === "bullish" ? "Thiên tăng" : p.type === "bearish" ? "Thiên giảm" : "Trung tính"}
                    </Badge>
                    <Badge tone="warn">{p.reliability}</Badge>
                  </div>
                  {p.description && (
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] text-text-secondary">{p.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divergences */}
        {divergences.length > 0 && (
          <div>
            <SectionLabel>Phân kỳ kỹ thuật (Divergence)</SectionLabel>
            <div className="space-y-1.5">
              {divergences.map((d, i) => {
                const isBull = d.kind.includes("bullish");
                const osc =
                  d.oscillator === "rsi" ? "RSI" : d.oscillator === "macd_hist" ? "MACD hist" : d.oscillator;
                const kindLabel =
                  d.kind === "regular_bullish"
                    ? "Regular ↑ Đảo chiều lên"
                    : d.kind === "regular_bearish"
                      ? "Regular ↓ Đảo chiều xuống"
                      : d.kind === "hidden_bullish"
                        ? "Hidden ↑ Tiếp diễn tăng"
                        : "Hidden ↓ Tiếp diễn giảm";
                return (
                  <div key={`${d.kind}-${d.oscillator}-${i}`} className="panel-inset p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={isBull ? "up" : "down"}>{kindLabel}</Badge>
                      <Badge tone="neutral">{osc}</Badge>
                      <span className="text-[9.5px] text-text-muted">
                        conf {(d.confidence * 100).toFixed(0)}% · {d.barsBetween} nến
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-text-secondary">
                      Pivot {fmtNum(d.pricePivots[0].price, digits)} → {fmtNum(d.pricePivots[1].price, digits)} · osc{" "}
                      {d.oscPivots[0].value.toFixed(2)} → {d.oscPivots[1].value.toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Price Action Signals */}
        {signals.length > 0 && (
          <div>
            <SectionLabel>Cấu trúc xu hướng & Tín hiệu</SectionLabel>
            <ul className="space-y-1">
              {signals.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-text-secondary">
                  <LineChart className="mt-0.5 size-3 shrink-0 text-accent-primary" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-text-muted ${className}`}>
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
        <span className="text-[9.5px] uppercase tracking-wider text-text-muted">{label}</span>
        {above != null && (
          <span
            className={`size-1.5 rounded-full ${above ? "bg-positive" : "bg-negative"}`}
            title={above ? "Giá trên đường này" : "Giá dưới đường này"}
          />
        )}
      </div>
      <div className={`num mt-0.5 text-[13px] font-semibold ${tone}`}>{value}</div>
      {hint && <div className="truncate text-[9.5px] text-text-muted">{hint}</div>}
    </div>
  );
}

function cmp(last: number, ma: number | null): boolean | null {
  return ma == null ? null : last >= ma;
}
function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
