import "server-only";
import { getVnOhlcv } from "./stocks";
import type { Meta } from "../types";
import { buildMeta } from "../freshness";

export type JournalTradeBt = {
  symbol: string;
  side: string;
  entry: number;
  exit: number | null;
  size?: number | null;
  leverage?: number | null;
  openedAt?: number;
  closedAt?: number | null;
};

export type EquityPoint = { i: number; equity: number; pnl: number; symbol?: string };

export type BacktestSummary = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxConsecLosses: number;
  finalEquity: number;
  equityCurve: EquityPoint[];
};

function tradePnl(t: JournalTradeBt): number | null {
  if (t.exit == null || !Number.isFinite(t.entry) || !Number.isFinite(t.exit)) return null;
  const dir = t.side === "short" ? -1 : 1;
  return (t.exit - t.entry) * dir * (t.size ?? 1) * (t.leverage ?? 1);
}

/** Backtest từ chuỗi lệnh đã đóng trong nhật ký (không cần OHLCV). */
export function backtestFromJournal(
  trades: JournalTradeBt[],
  startingEquity = 100,
): BacktestSummary {
  const closed = trades
    .filter((t) => t.exit != null)
    .map((t) => ({
      ...t,
      pnl: tradePnl(t),
      ts: t.closedAt ?? t.openedAt ?? 0,
    }))
    .filter((t) => t.pnl != null)
    .sort((a, b) => a.ts - b.ts) as (JournalTradeBt & { pnl: number; ts: number })[];

  let equity = startingEquity;
  let peak = startingEquity;
  let maxDd = 0;
  let maxDdPct = 0;
  let streak = 0;
  let maxConsec = 0;
  let sumWin = 0;
  let sumLossAbs = 0;
  let wins = 0;
  let losses = 0;
  const curve: EquityPoint[] = [{ i: 0, equity, pnl: 0 }];

  closed.forEach((t, i) => {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDd = Math.max(maxDd, dd);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
    if (t.pnl > 0) {
      wins++;
      sumWin += t.pnl;
      streak = 0;
    } else if (t.pnl < 0) {
      losses++;
      sumLossAbs += Math.abs(t.pnl);
      streak++;
      maxConsec = Math.max(maxConsec, streak);
    }
    curve.push({ i: i + 1, equity, pnl: t.pnl, symbol: t.symbol });
  });

  const totalPnl = equity - startingEquity;
  return {
    trades: closed.length,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : null,
    totalPnl,
    avgPnl: closed.length ? totalPnl / closed.length : null,
    profitFactor: sumLossAbs > 1e-12 ? sumWin / sumLossAbs : null,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    maxConsecLosses: maxConsec,
    finalEquity: equity,
    equityCurve: curve,
  };
}

export type StrategyId = "sma_cross" | "buy_hold";

export type SymbolBacktestResult = {
  symbol: string;
  strategy: StrategyId;
  bars: number;
  summary: BacktestSummary;
  params: Record<string, number>;
  meta: Meta;
};

/**
 * Backtest đơn giản trên OHLCV ngày:
 * - sma_cross: long khi SMA(fast) cắt lên SMA(slow), thoát khi cắt xuống
 * - buy_hold: mua đầu kỳ, bán cuối kỳ
 */
export async function backtestSymbolStrategy(
  symbol: string,
  strategy: StrategyId = "sma_cross",
  opts?: { fast?: number; slow?: number; limit?: number },
): Promise<SymbolBacktestResult | null> {
  const fast = opts?.fast ?? 10;
  const slow = opts?.slow ?? 30;
  const limit = opts?.limit ?? 250;
  const ohlcv = await getVnOhlcv(symbol.toUpperCase(), limit);
  if (!ohlcv?.bars?.length || ohlcv.bars.length < slow + 5) return null;

  const bars = ohlcv.bars;
  const closes = bars.map((b) => b.close);

  const sma = (arr: number[], n: number, i: number) => {
    if (i + 1 < n) return null;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += arr[k];
    return s / n;
  };

  const simulated: JournalTradeBt[] = [];

  if (strategy === "buy_hold") {
    simulated.push({
      symbol: symbol.toUpperCase(),
      side: "long",
      entry: closes[0],
      exit: closes[closes.length - 1],
      size: 1,
      leverage: 1,
      openedAt: 0,
      closedAt: closes.length,
    });
  } else {
    let inPos = false;
    let entry = 0;
    let entryI = 0;
    for (let i = slow; i < closes.length; i++) {
      const f = sma(closes, fast, i);
      const s = sma(closes, slow, i);
      const fp = sma(closes, fast, i - 1);
      const sp = sma(closes, slow, i - 1);
      if (f == null || s == null || fp == null || sp == null) continue;
      const crossUp = fp <= sp && f > s;
      const crossDown = fp >= sp && f < s;
      if (!inPos && crossUp) {
        inPos = true;
        entry = closes[i];
        entryI = i;
      } else if (inPos && crossDown) {
        simulated.push({
          symbol: symbol.toUpperCase(),
          side: "long",
          entry,
          exit: closes[i],
          size: 1,
          leverage: 1,
          openedAt: entryI,
          closedAt: i,
        });
        inPos = false;
      }
    }
    if (inPos) {
      simulated.push({
        symbol: symbol.toUpperCase(),
        side: "long",
        entry,
        exit: closes[closes.length - 1],
        size: 1,
        leverage: 1,
        openedAt: entryI,
        closedAt: closes.length - 1,
      });
    }
  }

  const summary = backtestFromJournal(simulated, 100);
  return {
    symbol: symbol.toUpperCase(),
    strategy,
    bars: bars.length,
    summary,
    params: strategy === "sma_cross" ? { fast, slow } : {},
    meta: buildMeta({
      source: ohlcv.meta.source,
      sourceTimestampMs: Date.now(),
      note: `backtest ${strategy} · ${simulated.length} trades`,
    }),
  };
}
