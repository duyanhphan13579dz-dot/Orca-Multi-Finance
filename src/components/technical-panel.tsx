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

export function TechnicalPanel({ tech, patterns }: { tech: TechnicalSnapshot | null; patterns: CandlePattern[] }) {
  if (!tech) {
    return (
      <Panel title="Phân tích kỹ thuật">
        <p className="text-[12px] text-ink-3">Chưa đủ dữ liệu chuỗi giá để tính toán chỉ báo.</p>
      </Panel>
    );
  }
  const t = TREND_LABEL[tech.trend.label];
  const digits = priceDigits(tech.last);
  return (
    <div className="space-y-3">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Gauge className="size-4 text-accent" /> Phân tích kỹ thuật
          </span>
        }
        right={
          <Badge tone={t.tone}>
            {t.tone === "up" ? <TrendingUp className="size-3" /> : t.tone === "down" ? <TrendingDown className="size-3" /> : null}
            {t.vi} ({tech.trend.score >= 0 ? "+" : ""}{tech.trend.score.toFixed(1)})
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="RSI(14)" value={fmtNum(tech.rsi14, 1)} hint={tech.rsi14 != null ? (tech.rsi14 >= 70 ? "quá mua" : tech.rsi14 <= 30 ? "quá bán" : "trung tính") : undefined} />
          <Metric label="MACD hist" value={tech.macd ? tech.macd.histogram.toPrecision(3) : "—"} hint={tech.macd ? (tech.macd.histogram > 0 ? "đà tăng" : "đà giảm") : undefined} />
          <Metric label="ATR(14)" value={fmtNum(tech.atr14, digits)} hint="biên dao động" />
          <Metric
            label="Volatility 30d"
            value={tech.volatility30d != null ? `${(tech.volatility30d * 100).toFixed(1)}%` : "—"}
            hint="annualized"
          />
          <Metric label="SMA20" value={fmtNum(tech.sma.sma20, digits)} above={cmp(tech.last, tech.sma.sma20)} />
          <Metric label="SMA50" value={fmtNum(tech.sma.sma50, digits)} above={cmp(tech.last, tech.sma.sma50)} />
          <Metric label="SMA200" value={fmtNum(tech.sma.sma200, digits)} above={cmp(tech.last, tech.sma.sma200)} />
          <Metric label="Max drawdown (1Y)" value={tech.maxDrawdown != null ? `${(tech.maxDrawdown * 100).toFixed(1)}%` : "—"} />
          <Metric label="Hiệu suất 7 ngày" value={pct(tech.returns.d7)} signed />
          <Metric label="Hiệu suất 30 ngày" value={pct(tech.returns.d30)} signed />
          <Metric label="YTD" value={pct(tech.returns.ytd)} signed />
          <Metric label="1 năm" value={pct(tech.returns.y1)} signed />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="panel-inset p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
              <Shield className="size-3.5 text-up" /> Hỗ trợ
            </div>
            <div className="num flex flex-wrap gap-1.5 text-[12px]">
              {tech.support.length ? tech.support.map((s) => <span key={s} className="rounded bg-up/10 px-1.5 py-0.5 text-up">{fmtNum(s, digits)}</span>) : <span className="text-ink-3">—</span>}
            </div>
          </div>
          <div className="panel-inset p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
              <Crosshair className="size-3.5 text-down" /> Kháng cự
            </div>
            <div className="num flex flex-wrap gap-1.5 text-[12px]">
              {tech.resistance.length ? tech.resistance.map((s) => <span key={s} className="rounded bg-down/10 px-1.5 py-0.5 text-down">{fmtNum(s, digits)}</span>) : <span className="text-ink-3">—</span>}
            </div>
          </div>
        </div>

        <ul className="mt-3 space-y-1">
          {tech.signals.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-ink-2">
              <LineChart className="mt-0.5 size-3.5 shrink-0 text-accent/70" />
              {s}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <Waves className="size-4 text-accent" /> Mô hình nến nhận diện
          </span>
        }
      >
        {!patterns.length ? (
          <p className="text-[12px] text-ink-3">Không có mô hình nến đáng chú ý trong 5 kỳ gần nhất — thị trường đang vận động theo cấu trúc thông thường.</p>
        ) : (
          <div className="space-y-2">
            {patterns.map((p) => (
              <div key={p.name} className="panel-inset p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[12px] font-semibold">{p.nameVi}</span>
                  <span className="text-[10px] text-ink-3">({p.name})</span>
                  <Badge tone={p.type === "bullish" ? "up" : p.type === "bearish" ? "down" : "neutral"}>
                    {p.type === "bullish" ? "thiên tăng" : p.type === "bearish" ? "thiên giảm" : "trung tính"}
                  </Badge>
                  <Badge tone="warn">độ tin cậy {p.reliability === "high" ? "cao" : p.reliability === "medium" ? "trung bình" : "thấp"}</Badge>
                </div>
                <p className="text-[12px] leading-relaxed text-ink-2">{p.description}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Metric({ label, value, hint, above, signed }: { label: string; value: string; hint?: string; above?: boolean | null; signed?: boolean }) {
  const signedNum = signed ? parseFloat(value) : NaN;
  const tone = signed && Number.isFinite(signedNum) ? (signedNum > 0 ? "text-up" : signedNum < 0 ? "text-down" : "text-ink") : "text-ink";
  return (
    <div className="panel-inset p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
        {above != null && <span className={`size-1.5 rounded-full ${above ? "bg-up" : "bg-down"}`} title={above ? "Giá trên đường này" : "Giá dưới đường này"} />}
      </div>
      <div className={`num mt-0.5 text-[14px] ${tone}`}>{value}</div>
      {hint && <div className="text-[10px] text-ink-3">{hint}</div>}
    </div>
  );
}

function cmp(last: number, ma: number | null): boolean | null {
  return ma == null ? null : last >= ma;
}
function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
