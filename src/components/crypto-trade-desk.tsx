"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { Badge, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { BookOpen, Activity, Gauge, ArrowUpRight, ArrowDownRight, Zap } from "lucide-react";
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

export function CryptoTradeDesk({
  symbol,
  mode = "all",
}: {
  symbol: string;
  mode?: "all" | "orderflow" | "leverage";
}) {
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

  const title =
    mode === "orderflow" ? (
      <span className="flex items-center gap-2">
        <BookOpen className="size-4 text-accent-primary" /> Sổ lệnh & Dòng tiền trực tiếp
        {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
      </span>
    ) : mode === "leverage" ? (
      <span className="flex items-center gap-2">
        <Gauge className="size-4 text-accent-primary" /> Mô phỏng Đòn bẩy & R:R
      </span>
    ) : (
      <span className="flex items-center gap-2">
        <BookOpen className="size-4 text-accent-primary" /> Trade Desk
        {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
      </span>
    );

  return (
    <Panel title={title} className="h-full overflow-hidden">
      {isLoading && !data ? (
        <Loading rows={mode === "leverage" ? 4 : 8} />
      ) : !data ? (
        <Unavailable title="Không lấy được sổ lệnh Binance" meta={meta} />
      ) : (
        <DeskBody
          data={data}
          plan={plan}
          leverage={leverage}
          setLeverage={setLeverage}
          meta={meta}
          mode={mode}
        />
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
  mode = "all",
}: {
  data: OrderFlowData;
  plan: LeveragePlan | null;
  leverage: number;
  setLeverage: (n: number) => void;
  meta: Meta | null;
  mode?: "all" | "orderflow" | "leverage";
}) {
  const digits = priceDigits(data.mid);
  const maxQty = Math.max(...data.bids.map((b) => b.qty), ...data.asks.map((a) => a.qty), 1e-12);
  const sig = data.signal;
  const sigTone = sig.direction === "BUY" ? "up" : sig.direction === "SELL" ? "down" : "neutral";

  const totalTaker = Math.max(1, data.buyVolumeQuote + data.sellVolumeQuote);
  const buyTakerPct = Math.round((data.buyVolumeQuote / totalTaker) * 100);
  const sellTakerPct = 100 - buyTakerPct;

  const showOrderFlow = mode === "all" || mode === "orderflow";
  const showLeverage = mode === "all" || mode === "leverage";

  return (
    <div className="flex h-full flex-col justify-between space-y-2.5">
      {showOrderFlow && (
        <div className="space-y-2.5">
          {/* Signal & Core metrics grid */}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className="panel-inset p-2">
              <div className="text-[9px] uppercase tracking-wider text-text-muted">Tín hiệu Desk</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Badge tone={sigTone}>
                  <span className="font-bold">{sig.direction}</span>
                </Badge>
                <span className="num text-[12.5px] font-semibold text-text-primary">{sig.confidencePct}%</span>
              </div>
            </div>
            <div className="panel-inset p-2">
              <div className="text-[9px] uppercase tracking-wider text-text-muted">Điểm dòng tiền</div>
              <div className={`num mt-0.5 text-[12.5px] font-semibold ${data.flowScore >= 0 ? "text-positive" : "text-negative"}`}>
                {data.flowScore > 0 ? "+" : ""}
                {data.flowScore}
              </div>
              <div className="truncate text-[9px] text-text-muted">
                B ${fmtCompact(data.buyVolumeQuote)} / S ${fmtCompact(data.sellVolumeQuote)}
              </div>
            </div>
            <div className="panel-inset p-2">
              <div className="text-[9px] uppercase tracking-wider text-text-muted">Độ lệch Sổ lệnh</div>
              <div className={`num mt-0.5 text-[12.5px] font-semibold ${data.imbalance >= 0 ? "text-positive" : "text-negative"}`}>
                {(data.imbalance * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] text-text-muted">spread {data.spreadBps.toFixed(1)} bps</div>
            </div>
            <div className="panel-inset p-2">
              <div className="text-[9px] uppercase tracking-wider text-text-muted">Giá Mid Spot</div>
              <div className="num mt-0.5 text-[12.5px] font-semibold text-text-primary">{fmtNum(data.mid, digits)}</div>
            </div>
          </div>

          {/* Taker Flow Dominance Gauge */}
          <div className="panel-inset px-2.5 py-1.5">
            <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-text-muted">
              <span>Lệnh khớp chủ động (Taker Flow)</span>
              <span className="num font-semibold">
                <strong className="text-positive">{buyTakerPct}% Mua</strong> · <strong className="text-negative">{sellTakerPct}% Bán</strong>
              </span>
            </div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-elevated">
              <div className="bg-positive transition-all duration-300" style={{ width: `${buyTakerPct}%` }} />
              <div className="bg-negative transition-all duration-300" style={{ width: `${sellTakerPct}%` }} />
            </div>
          </div>

          {/* Orderbook Bids/Asks */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[10.5px] font-medium text-text-secondary">
              <span className="flex items-center gap-1.5">
                <BookOpen className="size-3 text-accent-primary" /> Độ sâu sổ lệnh (Depth)
              </span>
              <span className="num text-[9.5px] text-text-muted">
                Bids ${fmtCompact(data.bidTotal)} / Asks ${fmtCompact(data.askTotal)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div>
                <div className="mb-0.5 flex items-center justify-between text-[9px] uppercase tracking-wider text-negative font-medium">
                  <span>Bên Bán (Asks)</span>
                  <span>Khối lượng</span>
                </div>
                <div className="space-y-0.5">
                  {[...data.asks].slice(0, 7).reverse().map((a) => (
                    <Row key={`a${a.price}`} price={a.price} qty={a.qty} max={maxQty} digits={digits} tone="ask" />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-0.5 flex items-center justify-between text-[9px] uppercase tracking-wider text-positive font-medium">
                  <span>Bên Mua (Bids)</span>
                  <span>Khối lượng</span>
                </div>
                <div className="space-y-0.5">
                  {data.bids.slice(0, 7).map((b) => (
                    <Row key={`b${b.price}`} price={b.price} qty={b.qty} max={maxQty} digits={digits} tone="bid" />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Whale Prints */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[10.5px] font-medium text-text-secondary">
              <span className="flex items-center gap-1.5">
                <Activity className="size-3 text-accent-primary" /> Khớp lệnh lớn (Whale Prints)
              </span>
              <span className="text-[9.5px] text-text-muted">Binance aggTrades</span>
            </div>
            <div className="max-h-[140px] space-y-0.5 overflow-y-auto">
              {data.largePrints.slice(0, 7).map((p, i) => (
                <div
                  key={`${p.time}-${i}`}
                  className="flex items-center justify-between rounded px-2 py-0.5 text-[10.5px] hover:bg-surface-elevated transition-colors"
                >
                  <span className="flex items-center gap-1">
                    {p.side === "buy" ? (
                      <ArrowUpRight className="size-3 text-positive" />
                    ) : (
                      <ArrowDownRight className="size-3 text-negative" />
                    )}
                    <span className={`text-[9.5px] font-bold ${p.side === "buy" ? "text-positive" : "text-negative"}`}>
                      {p.side.toUpperCase()}
                    </span>
                    <span className="text-[9px] text-text-muted ml-0.5">{formatTradeTime(p.time)}</span>
                  </span>
                  <span className="num text-text-primary">{fmtNum(p.price, digits)}</span>
                  <span className="num text-[10px] text-text-muted font-medium">${fmtCompact(p.quoteQty)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showLeverage && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
                <Gauge className="size-3.5 text-accent-primary" /> Mức đòn bẩy giao dịch
              </span>
              <span className="num text-[15px] font-bold text-accent-primary">{leverage}x</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-[var(--color-accent-primary,#3b82f6)]"
            />
            <div className="mt-1 flex justify-between text-[9px] text-text-muted">
              {LEVER_MARKS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`transition-colors hover:text-text-primary ${leverage === m ? "font-bold text-accent-primary" : ""}`}
                  onClick={() => setLeverage(m)}
                >
                  {m}x
                </button>
              ))}
            </div>

            {plan && (
              <div className="mt-2 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <Metric label="Điểm Entry" value={fmtNum(plan.entry, digits)} tone="neutral" />
                  <Metric
                    label="Stop Loss"
                    value={fmtNum(plan.stopLoss, digits)}
                    tone="down"
                    hint={`-${plan.stopDistancePct.toFixed(2)}%`}
                  />
                  <Metric
                    label="Take Profit"
                    value={fmtNum(plan.takeProfit, digits)}
                    tone="up"
                    hint={`+${plan.rewardDistancePct.toFixed(2)}%`}
                  />
                  <Metric
                    label="Thanh lý ước tính"
                    value={plan.liquidationEst != null ? fmtNum(plan.liquidationEst, digits) : "—"}
                    tone="down"
                    hint={`R:R 1:${plan.riskReward.toFixed(1)}`}
                  />
                </div>

                {/* Multi-Target Matrix */}
                <div className="grid grid-cols-3 gap-1 pt-1 border-t border-border-subtle/50 text-[9.5px]">
                  <div className="panel-inset p-1.5 text-center">
                    <span className="text-text-muted">TP1 (1:1.5): </span>
                    <strong className="num text-positive">
                      {fmtNum(plan.entry + (plan.takeProfit - plan.entry) * 0.6, digits)}
                    </strong>
                  </div>
                  <div className="panel-inset p-1.5 text-center">
                    <span className="text-text-muted">TP2 (1:2.5): </span>
                    <strong className="num text-positive">{fmtNum(plan.takeProfit, digits)}</strong>
                  </div>
                  <div className="panel-inset p-1.5 text-center">
                    <span className="text-text-muted">TP3 (1:4.0): </span>
                    <strong className="num text-positive">
                      {fmtNum(plan.entry + (plan.takeProfit - plan.entry) * 1.6, digits)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {sig.evidence.length > 0 && (
            <div className="panel-inset p-2">
              <div className="mb-1 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">
                <Zap className="size-3 text-accent-primary" /> Cơ sở phân tích tín hiệu
              </div>
              <ul className="space-y-0.5 text-[10px] text-text-secondary">
                {sig.evidence.slice(0, 3).map((e, i) => (
                  <li key={i} className="line-clamp-1">
                    ▸ {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {mode === "all" && meta && <MetaLine meta={meta} />}
    </div>
  );
}

function formatTradeTime(t: number): string {
  if (!t) return "";
  const d = new Date(t);
  return d.toTimeString().slice(0, 8);
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
  const bg = tone === "bid" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)";
  const color = tone === "bid" ? "text-positive" : "text-negative";
  return (
    <div className="relative flex items-center justify-between overflow-hidden rounded px-1.5 py-0.5">
      <div className="absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: bg }} />
      <span className={`num relative z-[1] text-[11px] font-medium ${color}`}>{fmtNum(price, digits)}</span>
      <span className="num relative z-[1] text-[10px] text-text-muted">{fmtCompact(qty)}</span>
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
    <div className="panel-inset p-1.5">
      <div className="text-[8.5px] uppercase tracking-wider text-text-muted">{label}</div>
      <div
        className={`num mt-0.5 text-[12px] font-semibold ${
          tone === "up" ? "text-positive" : tone === "down" ? "text-negative" : "text-text-primary"
        }`}
      >
        {value}
      </div>
      {hint && <div className="truncate text-[8.5px] text-text-muted">{hint}</div>}
    </div>
  );
}
