"use client";

import { useMemo } from "react";
import type { CandlePattern, ForexRow, OhlcvBar, TechnicalSnapshot } from "@/lib/types";
import { fmtNum, Panel, priceDigits } from "@/components/ui";
import { TechnicalPanel, PatternsAndDivergencePanel } from "@/components/technical-panel";
import { MtfBiasPanel } from "@/components/mtf-bias-panel";
import { Layers } from "lucide-react";

export type StructureTab = "ms" | "ict" | "smc" | "vsa";

export function MarketStructurePanel({
  tab,
  onTab,
  pair,
  interval,
  tech,
  patterns,
  cur,
  series,
}: {
  tab: StructureTab;
  onTab: (t: StructureTab) => void;
  pair: string;
  interval: string;
  tech: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  cur: ForexRow | null;
  series: OhlcvBar[];
}) {
  const structureNotes = useMemo(() => buildStructureNotes(series, tech), [series, tech]);

  const tabs: { id: StructureTab; label: string }[] = [
    { id: "ms", label: "Market Structure" },
    { id: "ict", label: "ICT" },
    { id: "smc", label: "SMC" },
    { id: "vsa", label: "VSA" },
  ];

  return (
    <Panel
      className="h-full"
      title={
        <span className="flex items-center gap-2">
          <Layers className="size-3.5 text-accent-primary" /> Market Structure & Smart Money
        </span>
      }
      right={<span className="text-[9px] text-text-muted">Deterministic · series</span>}
    >
      <div className="space-y-2">
        <div className="flex gap-1 overflow-x-auto rounded-md border border-border-subtle bg-surface-elevated/40 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={`flex-1 whitespace-nowrap rounded px-2 py-1 text-[10.5px] font-medium ${
                tab === t.id
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KeyLevel label="Trend" value={structureNotes.trend} tone={structureNotes.trendTone} />
          <KeyLevel label="BOS / CHoCH" value={structureNotes.bos} tone={structureNotes.bosTone} />
          <KeyLevel label="Liquidity" value={structureNotes.liquidity} tone="neutral" />
          <KeyLevel label="Regime" value={tech?.trend?.label ?? "—"} tone="neutral" />
        </div>

        {tab === "ms" && (
          <div className="space-y-2">
            <MtfBiasPanel symbol={pair} assetType="forex" chartTimeframe={interval} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TechnicalPanel tech={tech} patterns={patterns} ticker={cur} variant="compact" />
              <PatternsAndDivergencePanel tech={tech} patterns={patterns} />
            </div>
            {structureNotes.narrative && (
              <p className="rounded-md border border-border-subtle/60 bg-surface-elevated/30 px-2.5 py-1.5 text-[11px] leading-relaxed text-text-secondary">
                {structureNotes.narrative}
              </p>
            )}
          </div>
        )}

        {tab === "ict" && (
          <div className="space-y-2 text-[11px]">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/30 px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-text-muted">Premium / Discount</div>
                <div className="mt-0.5 font-semibold text-text-primary">{structureNotes.pd}</div>
              </div>
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/30 px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-text-muted">Dealing Range</div>
                <div className="mt-0.5 num font-semibold text-text-primary">{structureNotes.range}</div>
              </div>
            </div>
            <ul className="space-y-1 text-text-secondary">
              {structureNotes.ictPoints.map((p, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-accent-primary">▸</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <MtfBiasPanel symbol={pair} assetType="forex" chartTimeframe={interval} />
          </div>
        )}

        {tab === "smc" && (
          <div className="space-y-2 text-[11px]">
            <ul className="space-y-1 text-text-secondary">
              {structureNotes.smcPoints.map((p, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-accent-primary">▸</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TechnicalPanel tech={tech} patterns={patterns} ticker={cur} variant="compact" />
              <PatternsAndDivergencePanel tech={tech} patterns={patterns} />
            </div>
            <p className="text-[9.5px] text-text-muted">
              FVG / OB / BOS / Sweep hiển thị trên chart qua SMC overlay (client-side từ series).
            </p>
          </div>
        )}

        {tab === "vsa" && (
          <div className="space-y-2 text-[11px]">
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/30 px-2 py-1.5 text-center">
                <div className="text-[8.5px] uppercase text-text-muted">RVOL</div>
                <div className="num font-semibold text-text-primary">{structureNotes.rvol}</div>
              </div>
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/30 px-2 py-1.5 text-center">
                <div className="text-[8.5px] uppercase text-text-muted">CLV</div>
                <div className="num font-semibold text-text-primary">{structureNotes.clv}</div>
              </div>
              <div className="rounded-md border border-border-subtle/60 bg-surface-elevated/30 px-2 py-1.5 text-center">
                <div className="text-[8.5px] uppercase text-text-muted">Effort</div>
                <div className="font-semibold text-text-primary">{structureNotes.effort}</div>
              </div>
            </div>
            <ul className="space-y-1 text-text-secondary">
              {structureNotes.vsaPoints.map((p, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-accent-primary">▸</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function KeyLevel({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
}) {
  const c =
    tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary";
  return (
    <div className="rounded-md border border-border-subtle/50 bg-surface-elevated/25 px-2 py-1.5">
      <div className="text-[8.5px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-0.5 text-[11px] font-semibold ${c}`}>{value}</div>
    </div>
  );
}

function buildStructureNotes(series: OhlcvBar[], tech: TechnicalSnapshot | null) {
  const bars = series.slice(-60);
  const last = bars[bars.length - 1];
  const empty = {
    trend: "—",
    trendTone: "neutral" as const,
    bos: "—",
    bosTone: "neutral" as const,
    liquidity: "—",
    pd: "UNKNOWN",
    range: "—",
    rvol: "—",
    clv: "—",
    effort: "—",
    narrative: "",
    ictPoints: [] as string[],
    smcPoints: [] as string[],
    vsaPoints: [] as string[],
  };
  if (!last || bars.length < 10) return empty;

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const swingHigh = Math.max(...highs.slice(-20));
  const swingLow = Math.min(...lows.slice(-20));
  const mid = (swingHigh + swingLow) / 2;
  const close = last.close;
  const pd =
    close > mid + (swingHigh - swingLow) * 0.1
      ? "PREMIUM"
      : close < mid - (swingHigh - swingLow) * 0.1
        ? "DISCOUNT"
        : "EQUILIBRIUM";

  const trendLabel = tech?.trend?.label ?? "";
  const bull = /up|bull/i.test(trendLabel);
  const bear = /down|bear/i.test(trendLabel);
  const trend = bull ? "Uptrend" : bear ? "Downtrend" : trendLabel || "Range / Neutral";
  const trendTone = bull ? ("up" as const) : bear ? ("down" as const) : ("neutral" as const);

  let bos = "No clear BOS";
  let bosTone: "up" | "down" | "neutral" = "neutral";
  const prevSliceH = highs.slice(-12, -1);
  const prevSliceL = lows.slice(-12, -1);
  const prevHigh = prevSliceH.length ? Math.max(...prevSliceH) : close;
  const prevLow = prevSliceL.length ? Math.min(...prevSliceL) : close;
  if (close > prevHigh) {
    bos = "BOS ▲ Bullish";
    bosTone = "up";
  } else if (close < prevLow) {
    bos = "BOS ▼ Bearish";
    bosTone = "down";
  }

  const vols = bars.map((b) => b.volume ?? 0);
  const avgVol = vols.reduce((a, b) => a + b, 0) / (vols.length || 1) || 1;
  const rvol = (last.volume ?? 0) / avgVol;
  const range = Math.max(1e-12, last.high - last.low);
  const clv = ((last.close - last.low) - (last.high - last.close)) / range;
  const effort =
    rvol > 1.5 && Math.abs(clv) < 0.25
      ? "High effort · low result"
      : rvol > 1.5 && clv > 0.4
        ? "Demand expansion"
        : rvol > 1.5 && clv < -0.4
          ? "Supply expansion"
          : "Balanced";

  const supports = tech?.support?.slice(0, 2) ?? [];
  const resistances = tech?.resistance?.slice(0, 2) ?? [];
  const liquidity =
    supports.length || resistances.length
      ? `S ${supports.map((s) => s.toFixed(2)).join("/")} · R ${resistances.map((r) => r.toFixed(2)).join("/")}`
      : "Chưa đủ level";

  const digits = priceDigits(close);
  const narrative = [
    `${trend}. Giá đang ở vùng ${pd}.`,
    bos !== "No clear BOS" ? bos + "." : null,
    rvol > 1.4 ? `RVOL ${rvol.toFixed(2)}x — volume bất thường.` : null,
    tech?.rsi14 != null ? `RSI ${tech.rsi14.toFixed(0)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    trend,
    trendTone,
    bos,
    bosTone,
    liquidity,
    pd,
    range: `${fmtNum(swingLow, digits)} – ${fmtNum(swingHigh, digits)}`,
    rvol: rvol > 0 ? `${rvol.toFixed(2)}x` : "—",
    clv: clv.toFixed(2),
    effort,
    narrative,
    ictPoints: [
      `Premium/Discount: ${pd} (mid range ${fmtNum(mid, digits)})`,
      `Dealing range: ${fmtNum(swingLow, digits)} – ${fmtNum(swingHigh, digits)}`,
      pd === "DISCOUNT"
        ? "Giá ở discount — ưu tiên kịch bản long nếu có confirmation."
        : pd === "PREMIUM"
          ? "Giá ở premium — ưu tiên kịch bản short nếu có confirmation."
          : "Giá quanh equilibrium — chờ displacement rõ.",
      supports.length ? `Support gần: ${supports.map((s) => fmtNum(s, digits)).join(", ")}` : "Chưa có support rõ.",
    ],
    smcPoints: [
      bos,
      resistances.length
        ? `Order block / Resist proxy: ${resistances.map((r) => fmtNum(r, digits)).join(", ")}`
        : "Chưa có resistance rõ trên technical.",
      supports.length
        ? `Demand / Support proxy: ${supports.map((s) => fmtNum(s, digits)).join(", ")}`
        : "Chưa có support rõ trên technical.",
      "Overlay FVG/OB/Sweep trên chart nếu SMC engine bật.",
    ],
    vsaPoints: [
      `RVOL nến cuối: ${rvol > 0 ? rvol.toFixed(2) + "x" : "N/A"}`,
      `CLV: ${clv.toFixed(2)} (−1 bán · +1 mua)`,
      `Effort/Result: ${effort}`,
      rvol > 2 ? "Volume cực đoan — có thể climax / absorption." : "Volume trong biên bình thường.",
    ],
  };
}
