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

export const ForexScalpPanel = memo(function ForexScalpPanel({ pair }: { pair: string }) {
  const { data, meta, isLoading } = useApi<FxScalpResult>(`/api/v1/forex/${encodeURIComponent(pair)}/scalp`, {
    refreshInterval: 90_000,
  });

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Zap className="size-4 text-accent-primary" /> Signal · Forex Scalping
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      {isLoading && !data ? (
        <Loading rows={4} />
      ) : !data ? (
        <Unavailable title="Chua du du lieu M15/M5 (Yahoo FX)" meta={meta} />
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

  const entry = setup?.entry ?? null;
  const stopLoss = setup?.stopLoss ?? null;
  const takeProfit = setup?.takeProfit ?? null;

  const levScenario = useMemo(() => {
    if (entry == null || !Number.isFinite(entry) || entry <= 0) return null;
    const notional = capital * leverage;
    const riskPct =
      stopLoss != null && Number.isFinite(stopLoss) ? Math.abs(entry - stopLoss) / entry : null;
    const rewardPct =
      takeProfit != null && Number.isFinite(takeProfit) ? Math.abs(takeProfit - entry) / entry : null;
    const tpPnl = rewardPct != null ? notional * rewardPct : null;
    const slPnl = riskPct != null ? -(notional * riskPct) : null;
    const tier = riskTier(leverage);
    return {
      notional,
      tpPnl,
      slPnl,
      tier,
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
          <Badge tone="neutral">{s.filter.sessionLabel}</Badge>
          <Badge tone="neutral">{s.regime.market}</Badge>
          {setup && (
            <Badge tone={setup.status === "TRIGGERED" ? "up" : "neutral"}>
              {setup.strategy}:{setup.status}
            </Badge>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
          <span>Độ tin cậy (strength)</span>
          <span className="num text-text-secondary">{conf}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-background-secondary">
          <div className={`h-full rounded-full transition-all ${confBar}`} style={{ width: `${conf}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Last" value={fmtNum(s.last, digits)} />
        <Metric
          label="Spread"
          value={
            s.filter.spreadPips != null
              ? `${s.filter.spreadPips.toFixed(1)} / ${s.filter.maxSpreadPips} pip`
              : `max ${s.filter.maxSpreadPips} pip`
          }
        />
        <Metric label="ATR" value={s.atrPips != null ? `${s.atrPips.toFixed(1)} pip` : "-"} />
        <Metric
          label="Risk / trade"
          value={`${s.riskHint.recommendedRiskPct}%`}
          hint={s.riskHint.stopPips != null ? `SL ~ ${s.riskHint.stopPips.toFixed(1)} pip` : undefined}
        />
      </div>

      {setup && (setup.entry != null || setup.stopLoss != null) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Entry" value={setup.entry != null ? fmtNum(setup.entry, digits) : "-"} tone="up" />
          <Metric label="Stop" value={setup.stopLoss != null ? fmtNum(setup.stopLoss, digits) : "-"} tone="down" />
          <Metric
            label="TP"
            value={setup.takeProfit != null ? fmtNum(setup.takeProfit, digits) : "-"}
            tone="up"
            hint={setup.riskReward != null ? `RR ${setup.riskReward}` : undefined}
          />
          <Metric label="Stop pips" value={setup.stopPips != null ? `${setup.stopPips.toFixed(1)}` : "-"} />
        </div>
      )}

      <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[10px]">
          <span className="font-semibold text-text-secondary">Đòn bẩy · kịch bản (minh họa)</span>
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

        <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[10px]">
          <div className="panel-inset p-1.5 text-center">
            <div className="text-text-muted">Entry</div>
            <div className="num mt-0.5 text-text-primary">{entry != null ? fmtNum(entry, digits) : "—"}</div>
          </div>
          <div className="panel-inset p-1.5 text-center">
            <div className="text-text-muted">SL</div>
            <div className="num mt-0.5 text-negative">{stopLoss != null ? fmtNum(stopLoss, digits) : "—"}</div>
          </div>
          <div className="panel-inset p-1.5 text-center">
            <div className="text-text-muted">TP</div>
            <div className="num mt-0.5 text-positive">{takeProfit != null ? fmtNum(takeProfit, digits) : "—"}</div>
          </div>
        </div>

        {levScenario && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">Notional</div>
              <div className="num mt-0.5 text-text-primary">${levScenario.notional.toLocaleString()}</div>
            </div>
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">TP PnL</div>
              <div className="num mt-0.5 text-positive">{money(levScenario.tpPnl)}</div>
            </div>
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">SL PnL</div>
              <div className="num mt-0.5 text-negative">{money(levScenario.slPnl)}</div>
            </div>
            <div className="panel-inset p-1.5">
              <div className="text-text-muted">Rủi ro</div>
              <div className={`mt-0.5 font-semibold ${tierClass(levScenario.tier)}`}>{levScenario.tier}</div>
            </div>
          </div>
        )}

        {levScenario && leverage >= 20 && (
          <p className="mt-1.5 text-[9px] leading-snug text-warning">
            ~{levScenario.wipePct}% biến động ngược ≈ rủi ro vốn (minh họa, không phải thanh lý thực tế). Vốn giả định ${
            capital.toLocaleString()}.
          </p>
        )}
      </div>

      {(s.micro?.support?.length ?? 0) + (s.micro?.resistance?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Crosshair className="size-3.5 text-text-muted" />
          {(s.micro.support ?? []).slice(0, 2).map((v) => (
            <span key={`s${v}`} className="num rounded bg-positive/10 px-1.5 py-0.5 text-positive">
              {fmtNum(v, digits)}
            </span>
          ))}
          <span className="text-text-muted">·</span>
          {(s.micro.resistance ?? []).slice(0, 2).map((v) => (
            <span key={`r${v}`} className="num rounded bg-negative/10 px-1.5 py-0.5 text-negative">
              {fmtNum(v, digits)}
            </span>
          ))}
        </div>
      )}

      <ul className="space-y-1">
        {(s.evidence ?? []).map((e, i) => (
          <li key={i} className="text-[12px] text-text-secondary">
            ▸ {e}
          </li>
        ))}
      </ul>

      {(s.riskNotes ?? []).length > 0 && (
        <div className="space-y-1 rounded-lg border border-warning/25 bg-warning/5 p-2.5">
          {s.riskNotes.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-text-secondary">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {r}
            </div>
          ))}
        </div>
      )}

      <p className="text-[10.5px] text-text-muted">
        Module A/C M15→M5→M1 · Session/Spread filter bat buoc · Module B ORDER_FLOW_UNAVAILABLE (OTC). Risk mac dinh
        0.25%/lenh. Khong phai khuyen nghi.
      </p>
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
