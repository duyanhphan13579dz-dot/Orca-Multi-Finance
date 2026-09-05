"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import type { ScalpResult } from "@/lib/services/intelligence";
import { Badge, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { Crosshair, ShieldAlert, Timer, Zap } from "lucide-react";

const TF = ["1m", "5m", "15m"] as const;

const DIR_UI: Record<string, { label: string; tone: "up" | "down" | "neutral" }> = {
  "watch-long": { label: "WATCH LONG", tone: "up" },
  "watch-short": { label: "WATCH SHORT", tone: "down" },
  neutral: { label: "QUAN SÁT", tone: "neutral" },
};

export function ScalpPanel({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<(typeof TF)[number]>("5m");
  const { data, meta, isLoading } = useApi<ScalpResult>(`/api/v1/crypto/${encodeURIComponent(symbol)}/scalp?tf=${tf}`, { refreshInterval: 15_000 });

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Zap className="size-4 text-accent-primary" /> Scalping Intelligence
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          {data?.wsLive && <Badge tone="up">WS LIVE</Badge>}
        </span>
      }
      right={
        <div className="seg">
          {TF.map((x) => (
            <button key={x} data-active={tf === x} onClick={() => setTf(x)}>{x}</button>
          ))}
        </div>
      }
    >
      {isLoading && !data ? (
        <Loading rows={4} />
      ) : !data ? (
        <Unavailable title="Chưa đủ dữ liệu realtime" meta={meta} />
      ) : (
        <ScalpView result={data} meta={meta} />
      )}
    </Panel>
  );
}

function ScalpView({ result, meta }: { result: ScalpResult; meta: ReturnType<typeof useApi<ScalpResult>>["meta"] }) {
  const s = result.signal;
  const digits = priceDigits(s.last);
  const dir = DIR_UI[s.direction];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={dir.tone}>
          <span className="text-[12px] font-bold">{dir.label}</span>
        </Badge>
        <span className="num text-[12px] text-text-secondary">
          strength <b className="text-text-primary">{s.strength}</b>/100 · score {s.score >= 0 ? "+" : ""}{s.score}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-text-muted">
          <Timer className="size-3" /> khung {s.timeframe}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="VWAP (24h)" value={fmtNum(s.vwap, digits)} hint={s.vwapDistPct != null ? `giá lệch ${s.vwapDistPct >= 0 ? "+" : ""}${s.vwapDistPct.toFixed(2)}%` : undefined} />
        <Metric label="EMA9 / EMA21" value={s.ema9 != null && s.ema21 != null ? `${fmtNum(s.ema9, digits)} / ${fmtNum(s.ema21, digits)}` : "—"} hint={s.ema9 != null && s.ema21 != null ? (s.ema9 > s.ema21 ? "crossing lên" : "crossing xuống") : undefined} />
        <Metric label="RSI(7)" value={s.rsi7 != null ? s.rsi7.toFixed(0) : "—"} hint="momentum ngắn" />
        <Metric label="ATR / biên" value={s.atr != null ? fmtNum(s.atr, digits) : "—"} hint={s.atrPct != null ? `${s.atrPct.toFixed(2)}%/nến` : undefined} />
        <Metric label="Momentum 3n / 6n" value={`${s.momentum.bars3 != null ? (s.momentum.bars3 >= 0 ? "+" : "") + s.momentum.bars3.toFixed(2) + "%" : "—"} / ${s.momentum.bars6 != null ? (s.momentum.bars6 >= 0 ? "+" : "") + s.momentum.bars6.toFixed(2) + "%" : "—"}`} />
        <Metric label="Volume" value={s.volume.ratioVsMedian != null ? `x${s.volume.ratioVsMedian.toFixed(1)} median` : "—"} hint={s.volume.spike ? "SPIKE xác nhận" : "chưa có spike"} />
        <Metric
          label="Entry zone"
          value={s.entryZone ? `${fmtNum(s.entryZone[1], digits)} → ${fmtNum(s.entryZone[0], digits)}` : "—"}
          tone={dir.tone}
        />
        <Metric
          label="Invalidation"
          value={s.invalidation != null ? fmtNum(s.invalidation, digits) : "—"}
          hint={s.invalidation != null && s.atr != null ? `≈ ${(Math.abs(s.last - s.invalidation) / s.atr).toFixed(1)}×ATR` : undefined}
          tone="down"
        />
      </div>

      {s.micro.resistance.length + s.micro.support.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Crosshair className="size-3.5 text-text-muted" />
          <span className="text-text-muted">Micro levels:</span>
          {s.micro.support.slice(0, 2).map((v) => <span key={`s${v}`} className="num rounded bg-positive/10 px-1.5 py-0.5 text-positive">{fmtNum(v, digits)}</span>)}
          <span className="text-text-muted">·</span>
          {s.micro.resistance.slice(0, 2).map((v) => <span key={`r${v}`} className="num rounded bg-negative/10 px-1.5 py-0.5 text-negative">{fmtNum(v, digits)}</span>)}
        </div>
      )}

      <ul className="space-y-1">
        {s.evidence.map((e, i) => (
          <li key={i} className="text-[12px] text-text-secondary">▸ {e}</li>
        ))}
      </ul>

      {s.riskNotes.length > 0 && (
        <div className="space-y-1 rounded-lg border border-warning/25 bg-warning/5 p-2.5">
          {s.riskNotes.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-text-secondary">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {r}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10.5px] text-text-muted">
        Signal được tính deterministic bởi Quant Engine từ nến realtime (Binance) — không phải khuyến nghị; LLM chỉ giải thích, không tạo tín hiệu.
      </p>
      {meta && <MetaLine meta={meta} />}
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" | "neutral" }) {
  return (
    <div className="panel-inset p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`num mt-0.5 text-[13px] ${tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary"}`}>{value}</div>
      {hint && <div className="text-[10px] text-text-muted">{hint}</div>}
    </div>
  );
}
