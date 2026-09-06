"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { Badge, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { Crosshair, ShieldAlert, Timer, Zap } from "lucide-react";
import type { Meta, QualityStatus } from "@/lib/types";

/** Client-local shapes — never import server-only modules. */
interface ScalpSignalView {
  timeframe: string;
  direction: "watch-long" | "watch-short" | "neutral" | string;
  strength: number;
  score: number;
  last: number;
  atr: number | null;
  entryZone: [number, number] | null;
  invalidation: number | null;
  micro: { support: number[]; resistance: number[] };
  riskNotes: string[];
  evidence: string[];
  primarySetup?: {
    strategy: string;
    status: string;
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    riskReward: number | null;
  } | null;
  regime?: { market: string } | null;
  filter?: { eligible: boolean; tier: string } | null;
}

interface ScalpResult {
  signal: ScalpSignalView;
  quality: QualityStatus;
  wsLive: boolean;
}

const TF = ["1m", "5m", "15m"] as const;

const DIR_UI: Record<string, { label: string; tone: "up" | "down" | "neutral" }> = {
  "watch-long": { label: "WATCH LONG", tone: "up" },
  "watch-short": { label: "WATCH SHORT", tone: "down" },
  neutral: { label: "QUAN SAT", tone: "neutral" },
};

export function ScalpPanel({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<(typeof TF)[number]>("5m");
  const { data, meta, isLoading } = useApi<ScalpResult>(
    `/api/v1/crypto/${encodeURIComponent(symbol)}/scalp?tf=${tf}`,
    { refreshInterval: 20_000 },
  );

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
            <button key={x} type="button" data-active={tf === x} onClick={() => setTf(x)}>
              {x}
            </button>
          ))}
        </div>
      }
    >
      {isLoading && !data ? (
        <Loading rows={4} />
      ) : !data ? (
        <Unavailable title="Chua du du lieu realtime" meta={meta} />
      ) : (
        <ScalpView result={data} meta={meta} />
      )}
    </Panel>
  );
}

function ScalpView({ result, meta }: { result: ScalpResult; meta: Meta | null }) {
  const s = result.signal;
  const digits = priceDigits(s.last);
  const dir = DIR_UI[s.direction] ?? DIR_UI.neutral;
  const setup = s.primarySetup;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={dir.tone}>
          <span className="text-[12px] font-bold">{dir.label}</span>
        </Badge>
        <span className="num text-[12px] text-text-secondary">
          strength <b className="text-text-primary">{s.strength}</b>/100 · score {s.score >= 0 ? "+" : ""}
          {s.score}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-text-muted">
          <Timer className="size-3" /> khung {s.timeframe}
        </span>
        {setup && (
          <Badge tone={setup.status === "TRIGGERED" ? "up" : "neutral"}>
            {setup.strategy}:{setup.status}
          </Badge>
        )}
        {s.regime && <Badge tone="neutral">{s.regime.market}</Badge>}
        {s.filter && <Badge tone={s.filter.eligible ? "up" : "down"}>tier {s.filter.tier}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Last" value={fmtNum(s.last, digits)} />
        <Metric
          label="Entry zone"
          value={s.entryZone ? `${fmtNum(s.entryZone[1], digits)} -> ${fmtNum(s.entryZone[0], digits)}` : "-"}
          tone={dir.tone}
        />
        <Metric
          label="Invalidation"
          value={s.invalidation != null ? fmtNum(s.invalidation, digits) : "-"}
          tone="down"
        />
        <Metric label="Source" value={result.wsLive ? "WS+REST" : "REST"} />
      </div>

      {setup && (setup.entry != null || setup.stopLoss != null) && (
        <div className="grid grid-cols-3 gap-2 text-[11px]">
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
          {(s.micro?.support ?? []).slice(0, 2).map((v) => (
            <span key={`s${v}`} className="num rounded bg-positive/10 px-1.5 py-0.5 text-positive">
              {fmtNum(v, digits)}
            </span>
          ))}
          <span className="text-text-muted">·</span>
          {(s.micro?.resistance ?? []).slice(0, 2).map((v) => (
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
        Signal quant tu nen Binance (REST poll). Khong phai khuyen nghi.
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
