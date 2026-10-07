"use client";

import { memo, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { Badge, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Crosshair, ShieldAlert, Timer, Zap } from "lucide-react";
import type { Meta, QualityStatus } from "@/lib/types";

interface FxSetup {
  strategy: string;
  status: string;
  direction: string;
  strength: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  stopPips: number | null;
}

interface FxSignal {
  pair: string;
  timeframe: string;
  direction: string;
  strength: number;
  score: number;
  last: number;
  pipSize: number;
  atrPips: number | null;
  entryZone: [number, number] | null;
  invalidation: number | null;
  micro: { support: number[]; resistance: number[] };
  riskNotes: string[];
  evidence: string[];
  filter: {
    tier: string;
    eligible: boolean;
    sessionLabel: string;
    spreadPips: number | null;
    maxSpreadPips: number;
  };
  regime: { market: string; volatility: string };
  primarySetup: FxSetup | null;
  moduleBStatus: string;
  riskHint: { recommendedRiskPct: number; stopPips: number | null; note: string };
}

interface FxScalpResult {
  signal: FxSignal;
  quality: QualityStatus;
}

const DIR: Record<string, { label: string; tone: "up" | "down" | "neutral" }> = {
  "watch-long": { label: "WATCH LONG", tone: "up" },
  "watch-short": { label: "WATCH SHORT", tone: "down" },
  neutral: { label: "QUAN SAT", tone: "neutral" },
};

const LEVERAGES = [1, 5, 10, 20, 50, 100, 200] as const;

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(0)}`;
}

function riskTier(leverage: number) {
  if (leverage >= 100) return "EXTREME";
  if (leverage >= 50) return "HIGH";
  if (leverage >= 20) return "MODERATE";
  return "LOW";
}

function tierClass(t: string) {
  if (t === "EXTREME") return "text-negative";
  if (t === "HIGH") return "text-warning";
  if (t === "MODERATE") return "text-warning";
  return "text-positive";
}

/** RR mục tiêu theo đòn bẩy — đòn cao → RR thấp hơn (chốt gần hơn). */
function rrForLeverage(leverage: number): number {
  if (leverage >= 100) return 1.0;
  if (leverage >= 50) return 1.15;
  if (leverage >= 20) return 1.3;
  if (leverage >= 10) return 1.5;
  if (leverage >= 5) return 1.75;
  return 2.0;
}

/**
 * Scale khoảng SL theo đòn bẩy (ref 10x).
 * Đòn cao → SL hẹp hơn; đòn thấp → SL rộng hơn.
 */
function stopScaleForLeverage(leverage: number): number {
  const ref = 10;
  const raw = Math.sqrt(ref / Math.max(1, leverage));
  return Math.min(2.2, Math.max(0.28, raw));
}

/**
 * Entry đề xuất + SL/TP theo đòn bẩy.
 * Entry = limit/vùng chờ, không neo cứng giá thị trường.
 */
function levelsForLeverage(opts: {
  last: number;
  direction: string;
  setupEntry: number | null;
  setupSl: number | null;
  entryZone: [number, number] | null;
  micro: { support: number[]; resistance: number[] };
  pipSize: number;
  atrPips: number | null;
  leverage: number;
}) {
  const { last, direction, setupEntry, setupSl, entryZone, micro, pipSize, atrPips, leverage } = opts;

  const dirLower = (direction || "").toLowerCase();
  const isBuy =
    direction === "watch-long" || direction === "BUY" || dirLower.includes("long") || dirLower === "buy";
  const isSell =
    direction === "watch-short" ||
    direction === "SELL" ||
    dirLower.includes("short") ||
    dirLower === "sell";
  if (!isBuy && !isSell) return null;
  if (!Number.isFinite(last) || last <= 0) return null;

  const atrAbs =
    atrPips != null && atrPips > 0 ? atrPips * pipSize : Math.max(last * 0.001, pipSize * 10);
  const scale = stopScaleForLeverage(leverage);
  const rr = rrForLeverage(leverage);

  let entry: number;
  if (entryZone && entryZone.length === 2 && entryZone[0] > 0 && entryZone[1] > 0) {
    const lo = Math.min(entryZone[0], entryZone[1]);
    const hi = Math.max(entryZone[0], entryZone[1]);
    entry = isBuy ? lo + (hi - lo) * 0.35 : lo + (hi - lo) * 0.65;
  } else if (setupEntry != null && Number.isFinite(setupEntry) && setupEntry > 0) {
    const pull = atrAbs * 0.15 * scale;
    entry = isBuy ? Math.min(setupEntry, last) - pull * 0.25 : Math.max(setupEntry, last) + pull * 0.25;
  } else {
    const pull = atrAbs * 0.2 * Math.min(scale, 1.2);
    entry = isBuy ? last - pull : last + pull;
  }

  if (isBuy && micro.support.length) {
    const near = micro.support.filter((x) => x < last && x > last * 0.98).sort((a, b) => b - a)[0];
    if (near) entry = (entry + near) / 2;
  } else if (isSell && micro.resistance.length) {
    const near = micro.resistance.filter((x) => x > last && x < last * 1.02).sort((a, b) => a - b)[0];
    if (near) entry = (entry + near) / 2;
  }

  let baseStop =
    setupSl != null && setupEntry != null && Number.isFinite(setupSl)
      ? Math.abs(setupEntry - setupSl)
      : atrAbs * 1.0;
  baseStop = Math.max(baseStop, pipSize * 5);

  let stopDist = baseStop * scale;
  const maxStopPct = 0.4 / Math.max(1, leverage);
  stopDist = Math.min(stopDist, entry * maxStopPct);
  stopDist = Math.max(stopDist, pipSize * (leverage >= 50 ? 4 : leverage >= 20 ? 6 : 8));

  const stopLoss = isBuy ? entry - stopDist : entry + stopDist;
  const takeProfit = isBuy ? entry + stopDist * rr : entry - stopDist * rr;
  const stopPips = stopDist / pipSize;

  return {
    entry,
    stopLoss,
    takeProfit,
    stopPips,
    riskReward: rr,
    direction: isBuy ? "BUY" : "SELL",
    scale,
  };
}

export const ForexScalpPanel = memo(function ForexScalpPanel({ pair }: { pair: string }) {
  const { data, meta, isLoading } = useApi<FxScalpResult>(`/api/v1/forex/${encodeURIComponent(pair)}/scalp`, {
    refreshInterval: 90_000,
  });

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Zap className="size-4 text-accent-primary" /> Signal · Forex Scalping
        </span>
      }
      right={meta ? <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} /> : undefined}
    >
      {isLoading && !data ? (
        <Loading rows={6} />
      ) : !data?.signal ? (
        <Unavailable title={`Không có tín hiệu scalp ${pair}`} meta={meta} />
      ) : (
        <View signal={data.signal} meta={meta} />
      )}
    </Panel>
  );
});

const View = memo(function View({ signal: s, meta }: { signal: FxSignal; meta: Meta | null }) {
  const dir = DIR[s.direction] ?? DIR.neutral;
  const digits = s.last >= 100 ? 2 : s.last >= 10 ? 3 : 5;
  const setup = s.primarySetup;
  const conf = Math.max(0, Math.min(100, Math.round(s.strength)));
  const [leverage, setLeverage] = useState(10);
  const capital = 10_000;

  const levels = useMemo(
    () =>
      levelsForLeverage({
        last: s.last,
        direction: setup?.direction ?? s.direction,
        setupEntry: setup?.entry ?? null,
        setupSl: setup?.stopLoss ?? null,
        entryZone: s.entryZone,
        micro: s.micro,
        pipSize: s.pipSize > 0 ? s.pipSize : s.last >= 50 ? 0.01 : 0.0001,
        atrPips: s.atrPips,
        leverage,
      }),
    [s.last, s.direction, s.entryZone, s.micro, s.pipSize, s.atrPips, setup, leverage],
  );

  const entry = levels?.entry ?? null;
  const stopLoss = levels?.stopLoss ?? null;
  const takeProfit = levels?.takeProfit ?? null;
  const stopPips = levels?.stopPips ?? null;
  const riskReward = levels?.riskReward ?? null;

  const levScenario = useMemo(() => {
    if (entry == null || !Number.isFinite(entry) || entry <= 0 || stopLoss == null) return null;
    const notional = capital * leverage;
    const riskPct = Math.abs(entry - stopLoss) / entry;
    const rewardPct =
      takeProfit != null && Number.isFinite(takeProfit) ? Math.abs(takeProfit - entry) / entry : null;
    const tpPnl = rewardPct != null ? notional * rewardPct : null;
    const slPnl = -(notional * riskPct);
    const tier = riskTier(leverage);
    return {
      notional,
      tpPnl,
      slPnl,
      tier,
      riskPct: Number((riskPct * 100).toFixed(3)),
      rewardPct: rewardPct != null ? Number((rewardPct * 100).toFixed(3)) : null,
      wipePct: Number(((1 / leverage) * 100).toFixed(2)),
    };
  }, [entry, stopLoss, takeProfit, leverage]);

  const confBar =
    dir.tone === "up" ? "bg-positive" : dir.tone === "down" ? "bg-negative" : "bg-warning";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Signal · {s.timeframe}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <Badge tone={dir.tone}>
              <span className="text-[13px] font-bold">{dir.label}</span>
            </Badge>
            <span className="num text-[18px] font-semibold text-accent-primary">{conf}%</span>
            <span className="flex items-center gap-1 text-[11px] text-text-muted">
              <Timer className="size-3" /> score {s.score}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={s.filter.eligible ? "up" : "down"}>tier {s.filter.tier}</Badge>
          <Badge tone={s.filter.sessionLabel === "OFF_SESSION" ? "neutral" : "accent"}>
            {s.filter.sessionLabel}
          </Badge>
          <Badge tone="neutral">{s.regime.market}</Badge>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-background-secondary">
        <div className={`h-full ${confBar} transition-all`} style={{ width: `${conf}%` }} />
      </div>

      {levels && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Entry đề xuất"
            value={entry != null ? fmtNum(entry, digits) : "-"}
            tone="up"
            hint="Limit / vùng chờ"
          />
          <Metric
            label="SL"
            value={stopLoss != null ? fmtNum(stopLoss, digits) : "-"}
            tone="down"
            hint={stopPips != null ? `${stopPips.toFixed(1)} pip · ${leverage}x` : undefined}
          />
          <Metric
            label="TP"
            value={takeProfit != null ? fmtNum(takeProfit, digits) : "-"}
            tone="up"
            hint={riskReward != null ? `RR ${riskReward}` : undefined}
          />
          <Metric label="Giá TT" value={fmtNum(s.last, digits)} hint="Tham chiếu" />
        </div>
      )}

      <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[10px]">
          <span className="font-semibold text-text-secondary">Đòn bẩy · SL/TP theo mức</span>
          <span className="num text-text-primary">{leverage}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={200}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-[var(--accent-primary,#00d4ff)]"
          aria-label="Chọn đòn bẩy"
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {LEVERAGES.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setLeverage(x)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                leverage === x
                  ? "bg-accent-primary font-semibold text-background-primary"
                  : "bg-background-secondary text-text-muted hover:bg-background-secondary/80"
              }`}
            >
              {x}x
            </button>
          ))}
        </div>

        <p className="mt-1.5 text-[10px] text-text-muted">
          Mỗi mức đòn bẩy cho SL/TP khác nhau · Entry là mức limit đề xuất (không cố định giá TT).
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
          <div className="panel-inset p-1.5 text-center">
            <div className="text-text-muted">Entry đề xuất</div>
            <div className="num mt-0.5 text-text-primary">{entry != null ? fmtNum(entry, digits) : "—"}</div>
          </div>
          <div className="panel-inset p-1.5 text-center">
            <div className="text-text-muted">SL · {leverage}x</div>
            <div className="num mt-0.5 text-negative">{stopLoss != null ? fmtNum(stopLoss, digits) : "—"}</div>
            {stopPips != null && <div className="text-[9px] text-text-muted">{stopPips.toFixed(1)} pip</div>}
          </div>
          <div className="panel-inset p-1.5 text-center">
            <div className="text-text-muted">TP · RR {riskReward ?? "—"}</div>
            <div className="num mt-0.5 text-positive">
              {takeProfit != null ? fmtNum(takeProfit, digits) : "—"}
            </div>
          </div>
        </div>

        {levScenario && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">Notional</div>
              <div className="num mt-0.5 text-text-primary">${levScenario.notional.toLocaleString()}</div>
            </div>
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">PnL nếu chạm TP</div>
              <div className="num mt-0.5 text-positive">{money(levScenario.tpPnl)}</div>
            </div>
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">PnL nếu chạm SL</div>
              <div className="num mt-0.5 text-negative">{money(levScenario.slPnl)}</div>
            </div>
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">Rủi ro đòn bẩy</div>
              <div className={`num mt-0.5 font-semibold ${tierClass(levScenario.tier)}`}>
                {levScenario.tier}
              </div>
              <div className="text-[9px] text-text-muted">Liquid ~{levScenario.wipePct}% move</div>
            </div>
          </div>
        )}
      </div>

      {s.evidence?.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <Crosshair className="size-3" /> Evidence
          </div>
          <ul className="space-y-0.5 text-[11px] text-text-secondary">
            {s.evidence.slice(0, 6).map((e, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-accent-primary">·</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.riskNotes?.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-text-secondary">
          <div className="mb-1 flex items-center gap-1 font-semibold text-warning">
            <ShieldAlert className="size-3.5" /> Lưu ý rủi ro
          </div>
          <ul className="space-y-0.5">
            {s.riskNotes.slice(0, 4).map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        </div>
      )}

      {meta && <MetaLine meta={meta} />}
    </div>
  );
});

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div className="panel-inset p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div
        className={`num mt-0.5 text-[13px] ${tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary"}`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-text-muted">{hint}</div>}
    </div>
  );
}
