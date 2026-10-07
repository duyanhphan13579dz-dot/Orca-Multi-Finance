/**
 * Stock trade plan — Entry / SL / TP when signal is MUA or BÁN.
 * Mirrors crypto/forex desk: ATR + nearest S/R, R:R targets.
 * Pure (no server-only) so client DecisionStrip can reuse.
 */

export type StockTradeSide = "buy" | "sell";

export interface StockTradePlan {
  side: StockTradeSide;
  sideVi: "MUA" | "BÁN";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  /** Secondary targets for scale-out */
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskReward: number;
  riskPct: number;
  rewardPct: number;
  /** Absolute risk per share (entry − SL) */
  riskPerShare: number;
  invalidation: number;
  basis: string[];
  notes: string[];
}

export interface StockTradePlanInput {
  last: number;
  atr14?: number | null;
  support?: number[] | null;
  resistance?: number[] | null;
  /** Optional volatility (decimal, e.g. 0.25 = 25%) to floor ATR */
  volatility30d?: number | null;
}

/** VN-ish tick rounding */
function tickRound(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (price < 10) return Math.round(price * 100) / 100; // 0.01
  if (price < 50) return Math.round(price * 20) / 20; // 0.05
  if (price < 100) return Math.round(price * 10) / 10; // 0.1
  return Math.round(price * 2) / 2; // 0.5
}

function nearestBelow(levels: number[], ref: number): number | null {
  const below = levels.filter((l) => Number.isFinite(l) && l > 0 && l < ref * 0.999);
  if (!below.length) return null;
  return Math.max(...below);
}

function nearestAbove(levels: number[], ref: number): number | null {
  const above = levels.filter((l) => Number.isFinite(l) && l > ref * 1.001);
  if (!above.length) return null;
  return Math.min(...above);
}

/**
 * Build Entry/SL/TP for a clear MUA or BÁN signal.
 * Returns null if price invalid — never invents a plan for "watch".
 */
export function buildStockTradePlan(
  side: StockTradeSide,
  input: StockTradePlanInput,
): StockTradePlan | null {
  const last = input.last;
  if (!Number.isFinite(last) || last <= 0) return null;

  const supports = (input.support ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const resistances = (input.resistance ?? []).filter((n) => Number.isFinite(n) && n > 0);

  const atrRaw = input.atr14 != null && input.atr14 > 0 ? input.atr14 : null;
  const volFloor =
    input.volatility30d != null && input.volatility30d > 0
      ? (last * input.volatility30d) / Math.sqrt(252)
      : null;
  const atr = Math.max(atrRaw ?? 0, volFloor ?? 0, last * 0.008);
  const minStop = Math.max(atr * 0.7, last * 0.012);

  const basis: string[] = [];
  const notes: string[] = [
    "Mức giá tham khảo kỹ thuật — không phải lệnh khuyến nghị tuyệt đối.",
    "Kiểm tra thanh khoản, biên độ sàn/trần và tin tức trước khi vào.",
  ];

  let entry = last;
  let stopLoss: number;
  let takeProfit: number;

  if (side === "buy") {
    const sup = nearestBelow(supports, last);
    const res = nearestAbove(resistances, last);

    if (sup != null && last - sup >= minStop * 0.5 && last - sup <= atr * 3.5) {
      stopLoss = sup - atr * 0.15;
      basis.push(`SL dưới hỗ trợ ${tickRound(sup)}`);
    } else {
      stopLoss = last - minStop;
      basis.push(`SL theo ATR ×0.7–1.2 (~${((minStop / last) * 100).toFixed(1)}%)`);
    }

    if (last - stopLoss < minStop * 0.85) {
      stopLoss = last - minStop;
    }

    const risk = last - stopLoss;
    if (risk <= 0) return null;

    const target2r = last + risk * 2;
    if (res != null && res > last + risk * 1.2) {
      takeProfit = res;
      basis.push(`TP tại kháng cự ${tickRound(res)}`);
      if ((res - last) / risk < 1.4) {
        takeProfit = target2r;
        basis.push("Kháng cự gần — TP mở rộng 2R");
      }
    } else {
      takeProfit = target2r;
      basis.push("TP theo R:R 1:2 (ATR)");
    }

    entry = tickRound(last);
    stopLoss = tickRound(stopLoss);
    takeProfit = tickRound(takeProfit);

    const risk2 = entry - stopLoss;
    if (risk2 <= 0) return null;
    const reward = takeProfit - entry;
    const rr = reward / risk2;

    const tp1 = tickRound(entry + risk2 * 1.5);
    const tp2 = tickRound(entry + risk2 * 2.5);
    const tp3 = tickRound(entry + risk2 * 4);

    return {
      side,
      sideVi: "MUA",
      entry,
      stopLoss,
      takeProfit: tickRound(Math.max(takeProfit, tp1)),
      takeProfit1: tp1,
      takeProfit2: Math.max(tp2, tickRound(takeProfit)),
      takeProfit3: tp3,
      riskReward: Math.round(rr * 100) / 100,
      riskPct: Math.round((risk2 / entry) * 1000) / 10,
      rewardPct: Math.round(((Math.max(takeProfit, tp1) - entry) / entry) * 1000) / 10,
      riskPerShare: Math.round(risk2 * 100) / 100,
      invalidation: stopLoss,
      basis,
      notes,
    };
  }

  const res = nearestAbove(resistances, last);
  const sup = nearestBelow(supports, last);

  if (res != null && res - last >= minStop * 0.5 && res - last <= atr * 3.5) {
    stopLoss = res + atr * 0.15;
    basis.push(`SL trên kháng cự ${tickRound(res)}`);
  } else {
    stopLoss = last + minStop;
    basis.push(`SL theo ATR ×0.7–1.2 (~${((minStop / last) * 100).toFixed(1)}%)`);
  }

  if (stopLoss - last < minStop * 0.85) {
    stopLoss = last + minStop;
  }

  const risk = stopLoss - last;
  if (risk <= 0) return null;

  const target2r = last - risk * 2;
  if (sup != null && sup < last - risk * 1.2) {
    takeProfit = sup;
    basis.push(`TP tại hỗ trợ ${tickRound(sup)}`);
    if ((last - sup) / risk < 1.4) {
      takeProfit = target2r;
      basis.push("Hỗ trợ gần — TP mở rộng 2R");
    }
  } else {
    takeProfit = target2r;
    basis.push("TP theo R:R 1:2 (ATR)");
  }

  entry = tickRound(last);
  stopLoss = tickRound(stopLoss);
  takeProfit = tickRound(Math.max(0.01, takeProfit));

  const risk2 = stopLoss - entry;
  if (risk2 <= 0) return null;
  const reward = entry - takeProfit;
  const rr = reward / risk2;

  const tp1 = tickRound(entry - risk2 * 1.5);
  const tp2 = tickRound(entry - risk2 * 2.5);
  const tp3 = tickRound(Math.max(0.01, entry - risk2 * 4));

  notes.push("Thị trường cơ sở VN: tín hiệu BÁN ưu tiên chốt lời / giảm tỷ trọng hơn là short.");

  return {
    side,
    sideVi: "BÁN",
    entry,
    stopLoss,
    takeProfit: tickRound(Math.min(takeProfit, tp1)),
    takeProfit1: Math.max(0.01, tp1),
    takeProfit2: Math.max(0.01, Math.min(tp2, takeProfit)),
    takeProfit3: Math.max(0.01, tp3),
    riskReward: Math.round(rr * 100) / 100,
    riskPct: Math.round((risk2 / entry) * 1000) / 10,
    rewardPct: Math.round(((entry - Math.min(takeProfit, tp1)) / entry) * 1000) / 10,
    riskPerShare: Math.round(risk2 * 100) / 100,
    invalidation: stopLoss,
    basis,
    notes,
  };
}
