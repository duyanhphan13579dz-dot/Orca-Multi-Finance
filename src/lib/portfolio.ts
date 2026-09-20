export type PortfolioAssetType = "stock" | "crypto" | "forex" | "commodity";
export type PortfolioSide = "long" | "short";

export type PortfolioTrade = {
  id: string;
  assetType: PortfolioAssetType;
  symbol: string;
  side: PortfolioSide;
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  size: number | null;
  leverage: number | null;
  strategy: string;
  emotion: string;
  notes: string;
  openedAt: number;
  closedAt: number | null;
};

export type PortfolioWatchItem = {
  assetType: PortfolioAssetType;
  symbol: string;
  addedAt: number;
};

export type PortfolioMark = {
  assetType: PortfolioAssetType;
  symbol: string;
  price: number | null;
  changePercent: number | null;
};

export type PortfolioPosition = PortfolioTrade & {
  mark: number | null;
  unrealizedPnl: number | null;
  exposure: number;
  riskToStop: number | null;
  distanceToStopPct: number | null;
  distanceToTargetPct: number | null;
};

export type PortfolioAlert = {
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
  symbol?: string;
};

export type PortfolioPerformanceDatum = {
  label: string;
  pnl: number;
  trades: number;
  wins: number;
  winRate: number | null;
};

export type PortfolioVolatilityDatum = {
  label: PortfolioAssetType;
  volatilityPct: number | null;
  positionCount: number;
  markedPositions: number;
  exposurePct: number;
  level: "low" | "elevated" | "high" | "extreme" | "unavailable";
  highThresholdPct: number;
  extremeThresholdPct: number;
};

export type PortfolioSnapshot = {
  positions: PortfolioPosition[];
  closed: PortfolioTrade[];
  realizedPnl: number;
  unrealizedPnl: number | null;
  totalExposure: number;
  totalRisk: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number;
  averageR: number | null;
  allocation: { label: string; value: number; percentage: number }[];
  performanceByAsset: PortfolioPerformanceDatum[];
  volatilityByAsset: PortfolioVolatilityDatum[];
  stopLossCoverage: number;
  portfolioScore: number;
  alerts: PortfolioAlert[];
  disciplineScore: number;
};

function pnl(trade: PortfolioTrade, price: number | null): number | null {
  if (price == null || !Number.isFinite(price) || !Number.isFinite(trade.entry)) return null;
  const direction = trade.side === "short" ? -1 : 1;
  return (price - trade.entry) * direction * (trade.size ?? 1) * (trade.leverage ?? 1);
}

function percent(from: number, to: number, side: PortfolioSide): number | null {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100 * (side === "short" ? -1 : 1);
}

function rMultiple(trade: PortfolioTrade): number | null {
  if (trade.exit == null || trade.stopLoss == null || trade.entry === trade.stopLoss) return null;
  const direction = trade.side === "short" ? -1 : 1;
  const riskPerUnit = (trade.entry - trade.stopLoss) * direction;
  if (riskPerUnit <= 0) return null;
  return ((trade.exit - trade.entry) * direction) / riskPerUnit;
}

export function buildPortfolioSnapshot(
  trades: PortfolioTrade[],
  watchlist: PortfolioWatchItem[],
  marks: PortfolioMark[],
): PortfolioSnapshot {
  const markMap = new Map(marks.map((mark) => [`${mark.assetType}:${mark.symbol.toUpperCase()}`, mark]));
  const open = trades.filter((trade) => trade.exit == null);
  const closed = trades.filter((trade) => trade.exit != null);
  const positions = open.map((trade) => {
    const mark = markMap.get(`${trade.assetType}:${trade.symbol.toUpperCase()}`)?.price ?? null;
    const effectiveMark = mark ?? trade.entry;
    const exposure = Math.abs((trade.size ?? 1) * effectiveMark * (trade.leverage ?? 1));
    const riskToStop = trade.stopLoss == null ? null : Math.abs((trade.entry - trade.stopLoss) * (trade.size ?? 1) * (trade.leverage ?? 1));
    return {
      ...trade,
      mark,
      unrealizedPnl: mark == null ? null : pnl(trade, mark),
      exposure,
      riskToStop,
      distanceToStopPct: trade.stopLoss == null || mark == null ? null : percent(mark, trade.stopLoss, trade.side),
      distanceToTargetPct: trade.takeProfit == null || mark == null ? null : percent(mark, trade.takeProfit, trade.side),
    };
  });

  const closedPnls = closed.map((trade) => pnl(trade, trade.exit)).filter((value): value is number => value != null);
  const wins = closedPnls.filter((value) => value > 0);
  const losses = closedPnls.filter((value) => value < 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const realizedPnl = closedPnls.reduce((sum, value) => sum + value, 0);
  const unrealizedValues = positions.map((position) => position.unrealizedPnl).filter((value): value is number => value != null);
  const unrealizedPnl = unrealizedValues.length ? unrealizedValues.reduce((sum, value) => sum + value, 0) : null;
  const totalExposure = positions.reduce((sum, position) => sum + position.exposure, 0);
  const riskValues = positions.map((position) => position.riskToStop).filter((value): value is number => value != null);
  const totalRisk = riskValues.length ? riskValues.reduce((sum, value) => sum + value, 0) : null;
  const rValues = closed.map(rMultiple).filter((value): value is number => value != null);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  [...closed].sort((a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? b.openedAt)).forEach((trade) => {
    equity += pnl(trade, trade.exit) ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  });

  const allocationMap = new Map<string, number>();
  for (const position of positions) allocationMap.set(position.assetType, (allocationMap.get(position.assetType) ?? 0) + position.exposure);
  const allocation = [...allocationMap.entries()]
    .map(([label, value]) => ({ label, value, percentage: totalExposure ? (value / totalExposure) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const performanceMap = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const trade of closed) {
    const tradePnl = pnl(trade, trade.exit);
    if (tradePnl == null) continue;
    const current = performanceMap.get(trade.assetType) ?? { pnl: 0, trades: 0, wins: 0 };
    current.pnl += tradePnl;
    current.trades += 1;
    if (tradePnl > 0) current.wins += 1;
    performanceMap.set(trade.assetType, current);
  }
  const performanceByAsset = [...performanceMap.entries()]
    .map(([label, value]) => ({ ...value, label, winRate: value.trades ? value.wins / value.trades : null }))
    .sort((a, b) => b.pnl - a.pnl);

  const volatilityThresholds: Record<PortfolioAssetType, { high: number; extreme: number }> = {
    crypto: { high: 4, extreme: 7 },
    stock: { high: 2.5, extreme: 5 },
    forex: { high: 0.8, extreme: 1.5 },
    commodity: { high: 2, extreme: 4 },
  };
  const volatilityMap = new Map<PortfolioAssetType, { weightedAbsChange: number; exposure: number; marked: number }>();
  for (const position of positions) {
    const mark = markMap.get(`${position.assetType}:${position.symbol.toUpperCase()}`);
    if (!mark || mark.changePercent == null || !Number.isFinite(mark.changePercent)) continue;
    const current = volatilityMap.get(position.assetType) ?? { weightedAbsChange: 0, exposure: 0, marked: 0 };
    current.weightedAbsChange += Math.abs(mark.changePercent) * position.exposure;
    current.exposure += position.exposure;
    current.marked += 1;
    volatilityMap.set(position.assetType, current);
  }
  const volatilityByAsset = (["stock", "crypto", "forex", "commodity"] as PortfolioAssetType[])
    .map((label) => {
      const groupPositions = positions.filter((position) => position.assetType === label);
      const current = volatilityMap.get(label);
      const thresholds = volatilityThresholds[label];
      const volatilityPct = current && current.exposure > 0 ? current.weightedAbsChange / current.exposure : null;
      const level = volatilityPct == null
        ? "unavailable"
        : volatilityPct >= thresholds.extreme
          ? "extreme"
          : volatilityPct >= thresholds.high
            ? "high"
            : volatilityPct >= thresholds.high * 0.6
              ? "elevated"
              : "low";
      return {
        label,
        volatilityPct,
        positionCount: groupPositions.length,
        markedPositions: current?.marked ?? 0,
        exposurePct: totalExposure > 0 ? (groupPositions.reduce((sum, position) => sum + position.exposure, 0) / totalExposure) * 100 : 0,
        level,
        highThresholdPct: thresholds.high,
        extremeThresholdPct: thresholds.extreme,
      } satisfies PortfolioVolatilityDatum;
    })
    .filter((item) => item.positionCount > 0);

  const alerts: PortfolioAlert[] = [];
  for (const position of positions) {
    if (position.stopLoss == null) alerts.push({ tone: "warning", title: "Thiếu stop loss", detail: "Vị thế chưa có mức thoát rủi ro rõ ràng.", symbol: position.symbol });
    if (position.mark != null && position.stopLoss != null && position.distanceToStopPct != null && position.distanceToStopPct <= 3) {
      alerts.push({ tone: "danger", title: "Gần stop loss", detail: `Giá hiện tại chỉ còn ${Math.abs(position.distanceToStopPct).toFixed(1)}% tới SL.`, symbol: position.symbol });
    }
    if (position.mark != null && position.takeProfit != null && position.distanceToTargetPct != null && position.distanceToTargetPct >= -2 && position.distanceToTargetPct <= 3) {
      alerts.push({ tone: "info", title: "Gần take profit", detail: `Giá đang cách TP khoảng ${Math.abs(position.distanceToTargetPct).toFixed(1)}%.`, symbol: position.symbol });
    }
  }
  if (allocation[0]?.percentage >= 60) alerts.push({ tone: "warning", title: "Tập trung cao", detail: `${allocation[0].label} chiếm ${allocation[0].percentage.toFixed(0)}% exposure.`, symbol: allocation[0].label });
  if (positions.length > 0 && totalRisk == null) alerts.push({ tone: "warning", title: "Chưa đo được rủi ro", detail: "Thêm stop loss cho vị thế mở để hệ thống tính risk budget." });
  for (const item of volatilityByAsset) {
    if (item.level === "extreme" || item.level === "high") {
      alerts.push({
        tone: item.level === "extreme" ? "danger" : "warning",
        title: `Biến động ${item.level === "extreme" ? "cực cao" : "cao"}`,
        detail: `${item.label} đang có biến động tức thời ~${item.volatilityPct?.toFixed(2)}% trên ${item.markedPositions}/${item.positionCount} vị thế có mark; ngưỡng cảnh báo ${item.highThresholdPct}%.`,
        symbol: item.label,
      });
    }
  }

  const disciplineInputs = [
    open.length ? (open.filter((trade) => trade.stopLoss != null).length / open.length) * 50 : 50,
    open.length ? (open.filter((trade) => trade.takeProfit != null).length / open.length) * 25 : 25,
    closed.length ? Math.min(25, (rValues.filter((value) => value >= 0).length / closed.length) * 25) : 25,
  ];
  const disciplineScore = Math.round(Math.max(0, Math.min(100, disciplineInputs.reduce((sum, value) => sum + value, 0))));
  const stopLossCoverage = open.length ? (open.filter((trade) => trade.stopLoss != null).length / open.length) * 100 : 100;
  const profitFactor = grossLoss > 0 ? wins.reduce((sum, value) => sum + value, 0) / grossLoss : null;
  const edgeScore = closed.length ? Math.max(0, Math.min(100, (profitFactor == null ? 0 : Math.min(2, profitFactor) / 2) * 100)) : 50;
  const riskScore = positions.length ? (totalRisk == null ? 25 : Math.max(0, 100 - Math.min(100, (totalRisk / Math.max(totalExposure, 1)) * 100))) : 100;
  const volatilityScore = volatilityByAsset.length ? (volatilityByAsset.reduce((sum, item) => sum + (item.level === "extreme" ? 0 : item.level === "high" ? 30 : item.level === "elevated" ? 65 : item.level === "unavailable" ? 50 : 100), 0) / volatilityByAsset.length) : 100;
  const portfolioScore = Math.round((disciplineScore * 0.35) + (edgeScore * 0.25) + (riskScore * 0.2) + (volatilityScore * 0.2));

  return {
    positions,
    closed,
    realizedPnl,
    unrealizedPnl,
    totalExposure,
    totalRisk,
    winRate: closed.length ? wins.length / closed.length : null,
    profitFactor,
    expectancy: closedPnls.length ? realizedPnl / closedPnls.length : null,
    maxDrawdown,
    averageR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    allocation,
    performanceByAsset,
    volatilityByAsset,
    stopLossCoverage,
    portfolioScore,
    alerts: alerts.slice(0, 8),
    disciplineScore,
  };
}

export function formatAssetType(value: string): string {
  return value === "crypto" ? "Crypto" : value === "forex" ? "Forex" : value === "commodity" ? "Hàng hóa" : "Cổ phiếu";
}

export function loadPortfolioTrades(): PortfolioTrade[] {
  try {
    const raw = JSON.parse(localStorage.getItem("orca.journal.v1") ?? "[]") as PortfolioTrade[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function loadPortfolioWatchlist(): PortfolioWatchItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem("orca.watchlist.v1") ?? "[]") as PortfolioWatchItem[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function subscribePortfolioStorage(listener: () => void): () => void {
  const events = ["storage", "orca:watchlist", "orca:journal"] as const;
  events.forEach((event) => window.addEventListener(event, listener));
  return () => events.forEach((event) => window.removeEventListener(event, listener));
}
