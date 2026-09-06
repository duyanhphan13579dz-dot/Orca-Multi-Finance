"use client";

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

export function ForexScalpPanel({ pair }: { pair: string }) {
  const { data, meta, isLoading } = useApi<FxScalpResult>(`/api/v1/forex/${encodeURIComponent(pair)}/scalp`, {
    refreshInterval: 45_000,
  });

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Zap className="size-4 text-accent-primary" /> Forex Scalping
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
}

function View({ signal: s, meta }: { signal: FxSignal; meta: Meta | null }) {
  const dir = DIR[s.direction] ?? DIR.neutral;
  const digits = s.last >= 100 ? 2 : s.last >= 10 ? 3 : 5;
  const setup = s.primarySetup;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={dir.tone}>
          <span className="text-[12px] font-bold">{dir.label}</span>
        </Badge>
        <span className="num text-[12px] text-text-secondary">
          strength <b className="text-text-primary">{s.strength}</b>/100
        </span>
        <span className="flex items-center gap-1 text-[11px] text-text-muted">
          <Timer className="size-3" /> {s.timeframe}
        </span>
        <Badge tone={s.filter.eligible ? "up" : "down"}>tier {s.filter.tier}</Badge>
        <Badge tone="neutral">{s.filter.sessionLabel}</Badge>
        <Badge tone="neutral">{s.regime.market}</Badge>
        {setup && (
          <Badge tone={setup.status === "TRIGGERED" ? "up" : "neutral"}>
            {setup.strategy}:{setup.status}
          </Badge>
        )}
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
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Entry" value={setup.entry != null ? fmtNum(setup.entry, digits) : "-"} tone="up" />
          <Metric label="Stop" value={setup.stopLoss != null ? fmtNum(setup.stopLoss, digits) : "-"} tone="down" />
          <Metric
            label="TP"
            value={setup.takeProfit != null ? fmtNum(setup.takeProfit, digits) : "-"}
            hint={setup.riskReward != null ? `RR ${setup.riskReward}` : undefined}
          />
        </div>
      )}

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
}

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
