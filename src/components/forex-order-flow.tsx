"use client";

import { useMemo } from "react";
import type { OhlcvBar } from "@/lib/types";
import { fmtNum, Panel } from "@/components/ui";
import { Radio, Activity, Zap } from "lucide-react";

export function deriveOrderFlow(series: OhlcvBar[]) {
  const bars = series.slice(-48);
  if (bars.length < 8) {
    return {
      buyVol: 0,
      sellVol: 0,
      delta: 0,
      buyRatio: 50,
      cvd: 0,
      rvol: null as number | null,
      hasVolume: false,
    };
  }
  let buyVol = 0;
  let sellVol = 0;
  let cvd = 0;
  const vols: number[] = [];
  for (const b of bars) {
    const v = b.volume ?? 0;
    vols.push(v);
    const range = Math.max(1e-12, b.high - b.low);
    const clv = ((b.close - b.low) - (b.high - b.close)) / range;
    const buyPart = v * (0.5 + clv * 0.5);
    const sellPart = v - buyPart;
    buyVol += buyPart;
    sellVol += sellPart;
    cvd += buyPart - sellPart;
  }
  const total = buyVol + sellVol || 1;
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length || 1;
  const lastVol = vols[vols.length - 1] ?? 0;
  const hasVolume = avgVol > 0;
  return {
    buyVol,
    sellVol,
    delta: buyVol - sellVol,
    buyRatio: (buyVol / total) * 100,
    cvd,
    rvol: hasVolume ? lastVol / avgVol : null,
    hasVolume,
  };
}

function fmtCompactVol(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function OrderFlowPanel({
  flow,
}: {
  flow: ReturnType<typeof deriveOrderFlow>;
}) {
  const deltaTone = flow.delta > 0 ? "text-positive" : flow.delta < 0 ? "text-negative" : "text-text-muted";
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5 text-[11px]">
          <Activity className="size-3 text-accent-primary" /> Order Flow & Liquidity
        </span>
      }
      right={
        <span className="text-[9px] text-text-muted">
          {flow.hasVolume ? "CLV · series" : "Vol N/A"}
        </span>
      }
    >
      <div className="space-y-2 text-[11px]">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-text-muted">Buy Vol</div>
            <div className="num font-semibold text-positive">
              {flow.hasVolume ? fmtCompactVol(flow.buyVol) : "—"}
            </div>
          </div>
          <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-text-muted">Sell Vol</div>
            <div className="num font-semibold text-negative">
              {flow.hasVolume ? fmtCompactVol(flow.sellVol) : "—"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1">
            <div className="text-[8.5px] uppercase text-text-muted">Delta</div>
            <div className={`num text-[12px] font-semibold ${deltaTone}`}>
              {flow.hasVolume ? (flow.delta >= 0 ? "+" : "") + fmtCompactVol(flow.delta) : "—"}
            </div>
          </div>
          <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1">
            <div className="text-[8.5px] uppercase text-text-muted">Buy %</div>
            <div className="num text-[12px] font-semibold text-text-primary">
              {flow.hasVolume ? `${flow.buyRatio.toFixed(0)}%` : "—"}
            </div>
          </div>
          <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/30 px-1.5 py-1">
            <div className="text-[8.5px] uppercase text-text-muted">RVOL</div>
            <div className="num text-[12px] font-semibold text-accent-primary">
              {flow.rvol != null ? `${flow.rvol.toFixed(2)}x` : "—"}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-0.5 flex justify-between text-[9px] text-text-muted">
            <span>Buy pressure</span>
            <span>Sell pressure</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-elevated">
            <div
              className="h-full bg-positive/70 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, flow.buyRatio))}%` }}
            />
            <div
              className="h-full bg-negative/70 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, 100 - flow.buyRatio))}%` }}
            />
          </div>
        </div>

        <p className="text-[9px] leading-relaxed text-text-muted">
          Delta/CVD suy ra từ CLV × volume nến (không phải order book OTC). RVOL = vol nến cuối / TB 48 nến.
        </p>
      </div>
    </Panel>
  );
}

export function LiquidityZonesPanel({
  price,
  digits,
  supports,
  resistances,
  seriesLow,
  seriesHigh,
}: {
  price: number | null;
  digits: number;
  supports: number[];
  resistances: number[];
  seriesLow: number | null;
  seriesHigh: number | null;
}) {
  const levels = useMemo(() => {
    const items: { price: number; kind: "R" | "S" | "P"; strength: number }[] = [];
    resistances.forEach((r, i) => items.push({ price: r, kind: "R", strength: 1 - i * 0.2 }));
    supports.forEach((s, i) => items.push({ price: s, kind: "S", strength: 1 - i * 0.2 }));
    if (price != null) items.push({ price, kind: "P", strength: 1 });
    return items.sort((a, b) => b.price - a.price);
  }, [supports, resistances, price]);

  const lo = seriesLow ?? (levels.length ? Math.min(...levels.map((l) => l.price)) : 0);
  const hi = seriesHigh ?? (levels.length ? Math.max(...levels.map((l) => l.price)) : 1);
  const span = Math.max(1e-12, hi - lo);

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5 text-[11px]">
          <Radio className="size-3 text-accent-primary" /> Liquidity Zones
        </span>
      }
      right={<span className="text-[9px] text-positive">S/R · technical</span>}
    >
      <div className="space-y-1.5 text-[11px]">
        <div className="relative h-3 overflow-hidden rounded-md bg-surface-elevated">
          {levels
            .filter((l) => l.kind !== "P")
            .map((l, i) => {
              const pct = ((l.price - lo) / span) * 100;
              return (
                <div
                  key={i}
                  className={`absolute top-0 h-full w-1.5 rounded-sm ${
                    l.kind === "R" ? "bg-negative/60" : "bg-positive/60"
                  }`}
                  style={{
                    left: `${Math.min(98, Math.max(0, pct))}%`,
                    opacity: 0.4 + l.strength * 0.6,
                  }}
                  title={`${l.kind} ${fmtNum(l.price, digits)}`}
                />
              );
            })}
          {price != null && (
            <div
              className="absolute top-0 h-full w-0.5 bg-accent-primary"
              style={{ left: `${Math.min(98, Math.max(0, ((price - lo) / span) * 100))}%` }}
            />
          )}
        </div>

        {levels.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span
              className={
                l.kind === "R"
                  ? "text-negative"
                  : l.kind === "S"
                    ? "text-positive"
                    : "text-accent-primary"
              }
            >
              ● {l.kind === "R" ? "Sell / Resist" : l.kind === "S" ? "Buy / Support" : "Current"}
            </span>
            <span className={`num font-semibold ${l.kind === "P" ? "text-accent-primary" : "text-text-primary"}`}>
              {fmtNum(l.price, digits)}
            </span>
          </div>
        ))}
        {!levels.length && <div className="text-text-muted">Chưa đủ dữ liệu S/R</div>}
        <p className="pt-0.5 text-[9px] text-text-muted">
          Zone từ technical S/R trên series — không phải depth book OTC.
        </p>
      </div>
    </Panel>
  );
}

export function KeyZonesCompact({
  price,
  digits,
  supports,
  resistances,
}: {
  price: number | null;
  digits: number;
  supports: number[];
  resistances: number[];
}) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5 text-[11px]">
          <Zap className="size-3 text-accent-primary" /> Vùng giá quan trọng
        </span>
      }
    >
      <div className="space-y-1 text-[10.5px]">
        {resistances.slice(0, 2).map((r, i) => (
          <div key={`r${i}`} className="flex justify-between">
            <span className="text-negative">R{i + 1}</span>
            <span className="num font-medium text-text-primary">{fmtNum(r, digits)}</span>
          </div>
        ))}
        {price != null && (
          <div className="flex justify-between border-y border-border-subtle/50 py-0.5">
            <span className="text-accent-primary">Now</span>
            <span className="num font-bold text-text-primary">{fmtNum(price, digits)}</span>
          </div>
        )}
        {supports.slice(0, 2).map((s, i) => (
          <div key={`s${i}`} className="flex justify-between">
            <span className="text-positive">S{i + 1}</span>
            <span className="num font-medium text-text-primary">{fmtNum(s, digits)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
