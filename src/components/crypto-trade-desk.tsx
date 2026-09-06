"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { Badge, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { BookOpen, Activity, Gauge, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Meta } from "@/lib/types";

interface Level {
  price: number;
  qty: number;
  total: number;
}

interface LargePrint {
  price: number;
  qty: number;
  quoteQty: number;
  time: number;
  side: "buy" | "sell";
}

interface LeveragePlan {
  leverage: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePct: number;
  rewardDistancePct: number;
  liquidationEst: number | null;
  riskReward: number;
  note: string;
}

interface OrderFlowData {
  symbol: string;
  mid: number;
  spread: number;
  spreadBps: number;
  bids: Level[];
  asks: Level[];
  bidTotal: number;
  askTotal: number;
  imbalance: number;
  largePrints: LargePrint[];
  buyVolumeQuote: number;
  sellVolumeQuote: number;
  flowBias: "buy" | "sell" | "neutral";
  flowScore: number;
  signal: {
    direction: "BUY" | "SELL" | "NEUTRAL";
    confidencePct: number;
    strength: number;
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    evidence: string[];
  };
  leveragePlans: LeveragePlan[];
}

const LEVER_MARKS = [0, 1, 2, 5, 10, 20, 50, 100, 150, 200];

export function CryptoTradeDesk({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<OrderFlowData>(
    `/api/v1/crypto/${encodeURIComponent(symbol)}/orderflow`,
    { refreshInterval: 5_000 },
  );
  const [leverage, setLeverage] = useState(10);

  const plan = useMemo(() => {
    if (!data?.leveragePlans?.length) return null;
    const sorted = [...data.leveragePlans].sort((a, b) => a.leverage - b.leverage);
    let lo = sorted[0];
    let hi = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].leverage <= leverage && sorted[i + 1].leverage >= leverage) {
        lo = sorted[i];
        hi = sorted[i + 1];
        break;
      }
    }
    if (lo.leverage === hi.leverage) return { ...lo, leverage };
    const t = (leverage - lo.leverage) / (hi.leverage - lo.leverage);
    const lerp = (a: number, b: number) => a + (b - a) * t;
    return {
      leverage,
      entry: lerp(lo.entry, hi.entry),
      stopLoss: lerp(lo.stopLoss, hi.stopLoss),
      takeProfit: lerp(lo.takeProfit, hi.takeProfit),
      stopDistancePct: lerp(lo.stopDistancePct, hi.stopDistancePct),
      rewardDistancePct: lerp(lo.rewardDistancePct, hi.rewardDistancePct),
      liquidationEst:
        lo.liquidationEst != null && hi.liquidationEst != null
          ? lerp(lo.liquidationEst, hi.liquidationEst)
          : lo.liquidationEst ?? hi.liquidationEst,
      riskReward: lerp(lo.riskReward, hi.riskReward),
      note: leverage <= 1 ? lo.note : `Đòn bẩy ${leverage}x (nội suy)`,
    } satisfies LeveragePlan;
  }, [data, leverage]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <BookOpen className="size-4 text-accent-primary" /> Trade Desk
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      {isLoading && !data ? (
        <Loading rows={8} />
      ) : !data ? (
        <Unavailable title="Không lấy được sổ lệnh Binance" meta={meta} />
      ) : (
        <DeskBody data={data} plan={plan} leverage={leverage} setLeverage={setLeverage} meta={meta} />
      )}
    </Panel>
  );
}

function DeskBody({
  data,
  plan,
  leverage,
  setLeverage,
  meta,
}: {
  data: OrderFlowData;
  plan: LeveragePlan | null;
  leverage: number;
  setLeverage: (n: number) => void;
  meta: Meta | null;
}) {
  const digits = priceDigits(data.mid);
  const maxQty = Math.max(...data.bids.map((b) => b.qty), ...data.asks.map((a) => a.qty), 1e-12);
  const sig = data.signal;
  const sigTone = sig.direction === "BUY" ? "up" : sig.direction === "SELL" ? "down" : "neutral";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="panel-inset p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Signal</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Badge tone={sigTone}>
              <span className="font-bold">{sig.direction}</span>
            </Badge>
            <span className="num text-[15px] font-semibold text-text-primary">{sig.confidencePct}%</span>
          </div>
        </div>
        <div className="panel-inset p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Dòng tiền</div>
          <div className={`num mt-0.5 text-[15px] font-semibold ${data.flowScore >= 0 ? "text-positive" : "text-negative"}`}>
            {data.flowScore > 0 ? "+" : ""}
            {data.flowScore}
          </div>
          <div className="text-[10px] text-text-muted">
            buy ${fmtCompact(data.buyVolumeQuote)} / sell ${fmtCompact(data.sellVolumeQuote)}
          </div>
        </div>
        <div className="panel-inset p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Book imbalance</div>
          <div className={`num mt-0.5 text-[15px] font-semibold ${data.imbalance >= 0 ? "text-positive" : "text-negative"}`}>
            {(data.imbalance * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] text-text-muted">spread {data.spreadBps.toFixed(1)} bps</div>
        </div>
        <div className="panel-inset p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Mid</div>
          <div className="num mt-0.5 text-[15px] font-semibold">{fmtNum(data.mid, digits)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
            <BookOpen className="size-3.5" /> Sổ lệnh (Binance)
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-negative">Asks</div>
              <div className="max-h-[180px] space-y-0.5 overflow-y-auto">
                {[...data.asks].reverse().map((a) => (
                  <Row key={`a${a.price}`} price={a.price} qty={a.qty} max={maxQty} digits={digits} tone="ask" />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-positive">Bids</div>
              <div className="max-h-[180px] space-y-0.5 overflow-y-auto">
                {data.bids.map((b) => (
                  <Row key={`b${b.price}`} price={b.price} qty={b.qty} max={maxQty} digits={digits} tone="bid" />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
            <Activity className="size-3.5" /> Dòng tiền lớn (aggTrades)
          </div>
          <div className="max-h-[200px] space-y-1 overflow-y-auto">
            {data.largePrints.slice(0, 12).map((p, i) => (
              <div
                key={`${p.time}-${i}`}
                className="flex items-center justify-between rounded px-1.5 py-1 text-[11px] hover:bg-background-secondary/60"
              >
                <span className="flex items-center gap-1">
                  {p.side === "buy" ? (
                    <ArrowUpRight className="size-3 text-positive" />
                  ) : (
                    <ArrowDownRight className="size-3 text-negative" />
                  )}
                  <span className={p.side === "buy" ? "text-positive" : "text-negative"}>{p.side.toUpperCase()}</span>
                </span>
                <span className="num text-text-primary">{fmtNum(p.price, digits)}</span>
                <span className="num text-text-muted">${fmtCompact(p.quoteQty)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
            <Gauge className="size-3.5" /> Đòn bẩy
          </span>
          <span className="num text-[16px] font-bold text-accent-primary">{leverage}x</span>
        </div>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-[var(--accent-primary,#4c8dff)]"
        />
        <div className="mt-1 flex justify-between text-[9px] text-text-muted">
          {LEVER_MARKS.map((m) => (
            <button key={m} type="button" className="hover:text-text-primary" onClick={() => setLeverage(m)}>
              {m}x
            </button>
          ))}
        </div>

        {plan && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Entry" value={fmtNum(plan.entry, digits)} tone="neutral" />
            <Metric label="Stop Loss" value={fmtNum(plan.stopLoss, digits)} tone="down" hint={`${plan.stopDistancePct.toFixed(2)}%`} />
            <Metric label="Take Profit" value={fmtNum(plan.takeProfit, digits)} tone="up" hint={`RR ${plan.riskReward}`} />
            <Metric
              label="Thanh lý (ước tính)"
              value={plan.liquidationEst != null ? fmtNum(plan.liquidationEst, digits) : "—"}
              tone="down"
              hint={plan.note}
            />
          </div>
        )}
      </div>

      <ul className="space-y-0.5">
        {sig.evidence.slice(0, 4).map((e, i) => (
          <li key={i} className="text-[11px] text-text-muted">
            ▸ {e}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-text-muted">
        Chart + sổ lệnh + aggTrades từ Binance Spot. SL/TP theo đòn bẩy là mô phỏng — không phải khuyến nghị.
      </p>
      {meta && <MetaLine meta={meta} />}
    </div>
  );
}

function Row({
  price,
  qty,
  max,
  digits,
  tone,
}: {
  price: number;
  qty: number;
  max: number;
  digits: number;
  tone: "bid" | "ask";
}) {
  const pct = Math.min(100, (qty / max) * 100);
  const bg = tone === "bid" ? "rgba(46,194,126,0.12)" : "rgba(238,95,117,0.12)";
  const color = tone === "bid" ? "text-positive" : "text-negative";
  return (
    <div className="relative flex items-center justify-between overflow-hidden rounded px-1 py-0.5">
      <div className="absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: bg }} />
      <span className={`num relative z-[1] ${color}`}>{fmtNum(price, digits)}</span>
      <span className="num relative z-[1] text-text-muted">{fmtCompact(qty)}</span>
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
  tone: "up" | "down" | "neutral";
}) {
  return (
    <div className="panel-inset p-2">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div
        className={`num mt-0.5 text-[13px] font-semibold ${
          tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary"
        }`}
      >
        {value}
      </div>
      {hint && <div className="truncate text-[9px] text-text-muted">{hint}</div>}
    </div>
  );
}
