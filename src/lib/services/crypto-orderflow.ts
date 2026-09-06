import "server-only";
import { buildMeta } from "../freshness";
import * as binance from "../providers/binance";
import { analyzeScalp } from "../engines/scalp";
import type { Meta } from "../types";

export interface OrderFlowLevel {
  price: number;
  qty: number;
  total: number;
}

export interface LargePrint {
  price: number;
  qty: number;
  quoteQty: number;
  time: number;
  side: "buy" | "sell";
}

export interface LeveragePlan {
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

export interface CryptoOrderFlow {
  symbol: string;
  mid: number;
  spread: number;
  spreadBps: number;
  bids: OrderFlowLevel[];
  asks: OrderFlowLevel[];
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

function buildLeveragePlans(
  direction: "BUY" | "SELL" | "NEUTRAL",
  entry: number,
  baseSl: number | null,
  baseTp: number | null,
): LeveragePlan[] {
  const levers = [0, 1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125, 150, 175, 200];
  const isLong = direction !== "SELL";
  const plans: LeveragePlan[] = [];

  for (const L of levers) {
    const scale = L <= 1 ? 1 : Math.max(0.15, 1 / Math.sqrt(L));
    const baseStopDist = baseSl != null ? Math.abs(entry - baseSl) : entry * 0.012;
    const baseTpDist = baseTp != null ? Math.abs(baseTp - entry) : entry * 0.018;
    const stopDist = baseStopDist * scale;
    const tpDist = baseTpDist * Math.max(0.35, scale * 1.15);
    const stopLoss = isLong ? entry - stopDist : entry + stopDist;
    const takeProfit = isLong ? entry + tpDist : entry - tpDist;
    const stopDistancePct = (stopDist / entry) * 100;
    const rewardDistancePct = (tpDist / entry) * 100;
    const rr = stopDist > 0 ? tpDist / stopDist : 0;
    const liq =
      L <= 1 ? null : isLong ? entry * (1 - 0.9 / L) : entry * (1 + 0.9 / L);
    plans.push({
      leverage: L,
      entry: Number(entry.toPrecision(8)),
      stopLoss: Number(stopLoss.toPrecision(8)),
      takeProfit: Number(takeProfit.toPrecision(8)),
      stopDistancePct: Number(stopDistancePct.toFixed(3)),
      rewardDistancePct: Number(rewardDistancePct.toFixed(3)),
      liquidationEst: liq != null ? Number(liq.toPrecision(8)) : null,
      riskReward: Number(rr.toFixed(2)),
      note:
        L === 0
          ? "Spot (0x) — không đòn bẩy"
          : L === 1
            ? "1x — gần như spot, SL theo setup gốc"
            : `~${L}x — SL thu hẹp ×${scale.toFixed(2)}, ước tính thanh lý`,
    });
  }
  return plans;
}

export async function getCryptoOrderFlow(symbolRaw: string): Promise<{ data: CryptoOrderFlow; meta: Meta } | null> {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return null;

  try {
    const [book, trades, klines, ticker] = await Promise.all([
      binance.getOrderBook(symbol, 20),
      binance.getAggTrades(symbol, 100),
      binance.getKlines(symbol, "5m", 120).catch(() => null),
      binance.getSpotTicker(symbol).catch(() => null),
    ]);

    let bidTotal = 0;
    let askTotal = 0;
    const bids: OrderFlowLevel[] = [];
    const asks: OrderFlowLevel[] = [];
    for (const b of book.bids) {
      bidTotal += b.qty;
      bids.push({ price: b.price, qty: b.qty, total: bidTotal });
    }
    for (const a of book.asks) {
      askTotal += a.qty;
      asks.push({ price: a.price, qty: a.qty, total: askTotal });
    }

    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : ticker ? Number(ticker.lastPrice) : bestBid || bestAsk;
    const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
    const spreadBps = mid > 0 ? (spread / mid) * 10_000 : 0;
    const imbalance = bidTotal + askTotal > 0 ? (bidTotal - askTotal) / (bidTotal + askTotal) : 0;

    // AggTrade has price+qty only — quote notional = price * qty
    const withQuote = trades.map((t) => ({ ...t, quoteQty: t.price * t.qty }));
    const sorted = [...withQuote].sort((a, b) => b.quoteQty - a.quoteQty).slice(0, 15);
    const largePrints: LargePrint[] = sorted.map((t) => ({
      price: t.price,
      qty: t.qty,
      quoteQty: t.quoteQty,
      time: t.time,
      side: t.isBuyerMaker ? "sell" : "buy",
    }));

    let buyVolumeQuote = 0;
    let sellVolumeQuote = 0;
    for (const t of withQuote) {
      if (t.isBuyerMaker) sellVolumeQuote += t.quoteQty;
      else buyVolumeQuote += t.quoteQty;
    }
    const flowTotal = buyVolumeQuote + sellVolumeQuote;
    const flowScore = flowTotal > 0 ? Math.round(((buyVolumeQuote - sellVolumeQuote) / flowTotal) * 100) : 0;
    const flowBias: "buy" | "sell" | "neutral" =
      flowScore >= 12 ? "buy" : flowScore <= -12 ? "sell" : "neutral";

    let direction: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
    let confidencePct = 40;
    let strength = 0;
    let entry: number | null = mid;
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;
    const evidence: string[] = [];

    if (klines && klines.length >= 60) {
      const scalp = analyzeScalp(klines, {
        timeframe: "5m",
        symbol,
        quoteVolume24h: ticker ? Number(ticker.quoteVolume) : null,
      });
      if (scalp) {
        strength = scalp.strength;
        if (scalp.direction === "watch-long") direction = "BUY";
        else if (scalp.direction === "watch-short") direction = "SELL";
        entry = scalp.primarySetup?.entry ?? scalp.entryZone?.[0] ?? mid;
        stopLoss = scalp.primarySetup?.stopLoss ?? scalp.invalidation;
        takeProfit = scalp.primarySetup?.takeProfit ?? null;
        confidencePct = Math.round(
          Math.min(
            95,
            Math.max(
              8,
              scalp.strength * 0.55 +
                (direction === "BUY" && flowBias === "buy"
                  ? 18
                  : direction === "SELL" && flowBias === "sell"
                    ? 18
                    : 0) +
                Math.abs(imbalance) * 20 +
                (scalp.filter?.eligible ? 8 : -12),
            ),
          ),
        );
        evidence.push(...(scalp.evidence ?? []).slice(0, 3));
      }
    }

    if (direction === "NEUTRAL") {
      if (imbalance > 0.25 && flowBias === "buy") {
        direction = "BUY";
        confidencePct = Math.round(35 + imbalance * 40);
      } else if (imbalance < -0.25 && flowBias === "sell") {
        direction = "SELL";
        confidencePct = Math.round(35 + Math.abs(imbalance) * 40);
      }
    }

    evidence.push(
      `Book imbalance ${(imbalance * 100).toFixed(0)}% (bid ${bidTotal.toFixed(3)} / ask ${askTotal.toFixed(3)})`,
      `Agg flow ${flowScore > 0 ? "+" : ""}${flowScore} (buy $${buyVolumeQuote.toFixed(0)} / sell $${sellVolumeQuote.toFixed(0)})`,
      `Spread ${spreadBps.toFixed(1)} bps`,
    );

    if (entry == null || !Number.isFinite(entry) || entry <= 0) entry = mid;
    const leveragePlans = buildLeveragePlans(direction, entry, stopLoss, takeProfit);

    const data: CryptoOrderFlow = {
      symbol,
      mid,
      spread,
      spreadBps,
      bids,
      asks,
      bidTotal,
      askTotal,
      imbalance,
      largePrints,
      buyVolumeQuote,
      sellVolumeQuote,
      flowBias,
      flowScore,
      signal: {
        direction,
        confidencePct,
        strength,
        entry,
        stopLoss,
        takeProfit,
        evidence,
      },
      leveragePlans,
    };

    const meta = buildMeta({
      source: "binance-spot depth+aggTrades+klines",
      sourceTimestampMs: trades[trades.length - 1]?.time ?? Date.now(),
      note: "Sổ lệnh + dòng tiền lớn từ Binance REST; SL/TP theo đòn bẩy là ước tính mô phỏng",
    });
    return { data, meta };
  } catch {
    return null;
  }
}
