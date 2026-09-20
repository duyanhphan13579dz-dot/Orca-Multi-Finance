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

/** Mark giá từ nguồn thật (API nội bộ). Không dùng giá giả. */
export type PortfolioMark = {
  assetType: PortfolioAssetType;
  symbol: string;
  price: number | null;
  changePercent: number | null;
  change?: number | null;
  volume?: number | null;
  high?: number | null;
  low?: number | null;
  updatedAt?: string | number | null;
  source?: string | null;
  fresh?: boolean | null;
};

export type PortfolioPosition = PortfolioTrade & {
  mark: number | null;
  unrealizedPnl: number | null;
  exposure: number;
  riskToStop: number | null;
  distanceToStopPct: number | null;
  distanceToTargetPct: number | null;
  assetStatus?: AssetStatus | null;
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

export type AssetStatusTone = "positive" | "negative" | "neutral" | "unknown";

export type AssetStatus = {
  symbol: string;
  assetType: PortfolioAssetType;
  tone: AssetStatusTone;
  label: string;
  detail: string;
  changePercent: number | null;
  hasMark: boolean;
  fresh: boolean | null;
  source: string | null;
};

export type PortfolioStatus = {
  markedOpenCount: number;
  unmarkedOpenCount: number;
  markCoveragePct: number;
  stockOpenCount: number;
  stockMarkedCount: number;
  cryptoOpenCount: number;
  forexOpenCount: number;
  commodityOpenCount: number;
  totalPnl: number | null;
  statusLabel: string;
  statusTone: AssetStatusTone;
  assetStatuses: AssetStatus[];
  dataGaps: string[];
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
  portfolioStatus: PortfolioStatus;
};

export type PortfolioSymbolBuckets = {
  stock: string[];
  crypto: string[];
  forex: string[];
  commodity: string[];
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

export function collectPortfolioSymbols(
  trades: PortfolioTrade[],
  watchlist: PortfolioWatchItem[],
): PortfolioSymbolBuckets {
  const buckets: PortfolioSymbolBuckets = { stock: [], crypto: [], forex: [], commodity: [] };
  const seen = new Set<string>();
  const push = (assetType: PortfolioAssetType, symbol: string) => {
    const key = `${assetType}:${symbol.toUpperCase()}`;
    if (seen.has(key) || !symbol.trim()) return;
    seen.add(key);
    buckets[assetType].push(symbol.toUpperCase());
  };
  for (const trade of trades) push(trade.assetType, trade.symbol);
  for (const item of watchlist) push(item.assetType, item.symbol);
  return buckets;
}

export function analyzeAssetStatus(
  assetType: PortfolioAssetType,
  symbol: string,
  mark: PortfolioMark | undefined,
): AssetStatus {
  if (!mark || mark.price == null || !Number.isFinite(mark.price)) {
    return {
      symbol,
      assetType,
      tone: "unknown",
      label: "Chưa có giá",
      detail:
        assetType === "stock"
          ? "Chưa kéo được quote cổ phiếu từ VNDirect/SSI/public feed."
          : assetType === "commodity"
            ? "Chưa kéo được giá hàng hóa từ VietnamBiz/Simplize."
            : "Chưa có mark từ nguồn.",
      changePercent: null,
      hasMark: false,
      fresh: null,
      source: null,
    };
  }
  const chg = mark.changePercent;
  let tone: AssetStatusTone = "neutral";
  let label = "Đi ngang";
  if (chg != null && Number.isFinite(chg)) {
    if (chg >= 2) { tone = "positive"; label = "Tăng mạnh"; }
    else if (chg > 0.15) { tone = "positive"; label = "Tăng nhẹ"; }
    else if (chg <= -2) { tone = "negative"; label = "Giảm mạnh"; }
    else if (chg < -0.15) { tone = "negative"; label = "Giảm nhẹ"; }
  }
  const parts: string[] = [];
  if (chg != null && Number.isFinite(chg)) parts.push(`${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`);
  if (mark.volume != null && Number.isFinite(mark.volume) && mark.volume > 0) {
    parts.push(`KL ${Math.round(mark.volume).toLocaleString("vi-VN")}`);
  }
  if (mark.source) parts.push(`nguồn ${mark.source}`);
  if (mark.fresh === false) parts.push("dữ liệu cũ");
  return {
    symbol,
    assetType,
    tone,
    label,
    detail: parts.length ? parts.join(" · ") : `Giá ${mark.price}`,
    changePercent: chg ?? null,
    hasMark: true,
    fresh: mark.fresh ?? null,
    source: mark.source ?? null,
  };
}

function buildPortfolioStatus(
  positions: PortfolioPosition[],
  marks: PortfolioMark[],
  realizedPnl: number,
  unrealizedPnl: number | null,
): PortfolioStatus {
  const markMap = new Map(marks.map((m) => [`${m.assetType}:${m.symbol.toUpperCase()}`, m]));
  const assetStatuses: AssetStatus[] = positions.map((p) =>
    p.assetStatus ??
    analyzeAssetStatus(p.assetType, p.symbol, markMap.get(`${p.assetType}:${p.symbol.toUpperCase()}`)),
  );
  const markedOpenCount = positions.filter((p) => p.mark != null).length;
  const unmarkedOpenCount = positions.length - markedOpenCount;
  const markCoveragePct = positions.length ? (markedOpenCount / positions.length) * 100 : 100;
  const countType = (t: PortfolioAssetType) => positions.filter((p) => p.assetType === t).length;
  const stockOpenCount = countType("stock");
  const stockMarkedCount = positions.filter((p) => p.assetType === "stock" && p.mark != null).length;
  const cryptoOpenCount = countType("crypto");
  const forexOpenCount = countType("forex");
  const commodityOpenCount = countType("commodity");
  const totalPnl =
    unrealizedPnl == null ? (positions.length === 0 ? realizedPnl : null) : realizedPnl + unrealizedPnl;
  const dataGaps: string[] = [];
  if (stockOpenCount > 0 && stockMarkedCount < stockOpenCount) {
    dataGaps.push(`${stockOpenCount - stockMarkedCount}/${stockOpenCount} cổ phiếu mở chưa có mark từ nguồn VN.`);
  }
  if (commodityOpenCount > 0) {
    const commodityMarked = positions.filter((p) => p.assetType === "commodity" && p.mark != null).length;
    if (commodityMarked < commodityOpenCount) {
      dataGaps.push(`${commodityOpenCount - commodityMarked}/${commodityOpenCount} hàng hóa mở chưa có mark.`);
    }
  }
  if (unmarkedOpenCount > 0 && stockOpenCount + commodityOpenCount === 0) {
    dataGaps.push(`${unmarkedOpenCount} vị thế mở chưa gắn được giá mark.`);
  }
  let statusTone: AssetStatusTone = "neutral";
  let statusLabel = "Trung tính";
  if (positions.length === 0) {
    statusLabel =
      realizedPnl > 0 ? "Chỉ có lệnh đóng · đã lãi" : realizedPnl < 0 ? "Chỉ có lệnh đóng · đã lỗ" : "Chưa có vị thế mở";
    statusTone = realizedPnl > 0 ? "positive" : realizedPnl < 0 ? "negative" : "neutral";
  } else if (markCoveragePct < 50) {
    statusTone = "unknown";
    statusLabel = "Thiếu dữ liệu giá";
  } else if (totalPnl != null) {
    if (totalPnl > 0) { statusTone = "positive"; statusLabel = "Danh mục đang lãi"; }
    else if (totalPnl < 0) { statusTone = "negative"; statusLabel = "Danh mục đang lỗ"; }
    else statusLabel = "Hòa vốn";
  }
  return {
    markedOpenCount,
    unmarkedOpenCount,
    markCoveragePct,
    stockOpenCount,
    stockMarkedCount,
    cryptoOpenCount,
    forexOpenCount,
    commodityOpenCount,
    totalPnl,
    statusLabel,
    statusTone,
    assetStatuses,
    dataGaps,
  };
}

const VOL_THRESHOLDS: Record<PortfolioAssetType, { high: number; extreme: number }> = {
  stock: { high: 3, extreme: 5 },
  crypto: { high: 5, extreme: 8 },
  forex: { high: 0.8, extreme: 1.5 },
  commodity: { high: 2.5, extreme: 4 },
};

export function buildPortfolioSnapshot(
  trades: PortfolioTrade[],
  watchlist: PortfolioWatchItem[],
  marks: PortfolioMark[],
): PortfolioSnapshot {
  const markMap = new Map(marks.map((mark) => [`${mark.assetType}:${mark.symbol.toUpperCase()}`, mark]));
  const open = trades.filter((trade) => trade.exit == null);
  const closed = trades.filter((trade) => trade.exit != null);
  const positions: PortfolioPosition[] = open.map((trade) => {
    const markRow = markMap.get(`${trade.assetType}:${trade.symbol.toUpperCase()}`);
    const mark = markRow?.price ?? null;
    const effectiveMark = mark ?? trade.entry;
    const exposure = Math.abs((trade.size ?? 1) * effectiveMark * (trade.leverage ?? 1));
    const riskToStop =
      trade.stopLoss == null
        ? null
        : Math.abs((trade.entry - trade.stopLoss) * (trade.size ?? 1) * (trade.leverage ?? 1));
    const assetStatus = analyzeAssetStatus(trade.assetType, trade.symbol, markRow);
    return {
      ...trade,
      mark,
      unrealizedPnl: mark == null ? null : pnl(trade, mark),
      exposure,
      riskToStop,
      distanceToStopPct:
        trade.stopLoss == null || mark == null ? null : percent(mark, trade.stopLoss, trade.side),
      distanceToTargetPct:
        trade.takeProfit == null || mark == null ? null : percent(mark, trade.takeProfit, trade.side),
      assetStatus,
    };
  });

  const closedPnls = closed.map((trade) => pnl(trade, trade.exit)).filter((value): value is number => value != null);
  const wins = closedPnls.filter((value) => value > 0);
  const losses = closedPnls.filter((value) => value < 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const realizedPnl = closedPnls.reduce((sum, value) => sum + value, 0);
  const unrealizedValues = positions.map((p) => p.unrealizedPnl).filter((v): v is number => v != null);
  const unrealizedPnl = unrealizedValues.length ? unrealizedValues.reduce((s, v) => s + v, 0) : null;
  const totalExposure = positions.reduce((s, p) => s + p.exposure, 0);
  const riskValues = positions.map((p) => p.riskToStop).filter((v): v is number => v != null);
  const totalRisk = riskValues.length ? riskValues.reduce((s, v) => s + v, 0) : null;
  const rValues = closed.map(rMultiple).filter((v): v is number => v != null);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  [...closed]
    .sort((a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? b.openedAt))
    .forEach((trade) => {
      equity += pnl(trade, trade.exit) ?? 0;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    });

  const allocationMap = new Map<string, number>();
  for (const position of positions) {
    allocationMap.set(position.assetType, (allocationMap.get(position.assetType) ?? 0) + position.exposure);
  }
  const allocation = [...allocationMap.entries()]
    .map(([label, value]) => ({
      label,
      value,
      percentage: totalExposure ? (value / totalExposure) * 100 : 0,
    }))
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
    .map(([label, value]) => ({
      label,
      pnl: value.pnl,
      trades: value.trades,
      wins: value.wins,
      winRate: value.trades ? value.wins / value.trades : null,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  const volatilityByAsset: PortfolioVolatilityDatum[] = (
    ["stock", "crypto", "forex", "commodity"] as PortfolioAssetType[]
  ).flatMap((label): PortfolioVolatilityDatum[] => {
      const group = positions.filter((p) => p.assetType === label);
      if (!group.length) return [];
      const marked = group.filter((p) => {
        const m = markMap.get(`${p.assetType}:${p.symbol.toUpperCase()}`);
        return m?.changePercent != null && Number.isFinite(m.changePercent);
      });
      const thresholds = VOL_THRESHOLDS[label];
      const exposurePct = totalExposure
        ? (group.reduce((s, p) => s + p.exposure, 0) / totalExposure) * 100
        : 0;
      if (!marked.length) {
        return [{
          label,
          volatilityPct: null,
          positionCount: group.length,
          markedPositions: 0,
          exposurePct,
          level: "unavailable",
          highThresholdPct: thresholds.high,
          extremeThresholdPct: thresholds.extreme,
        }];
      }
      const avgAbs =
        marked.reduce((sum, p) => {
          const m = markMap.get(`${p.assetType}:${p.symbol.toUpperCase()}`)!;
          return sum + Math.abs(m.changePercent ?? 0);
        }, 0) / marked.length;
      const level: PortfolioVolatilityDatum["level"] =
        avgAbs >= thresholds.extreme
          ? "extreme"
          : avgAbs >= thresholds.high
            ? "high"
            : avgAbs >= thresholds.high * 0.5
              ? "elevated"
              : "low";
      return [{
        label,
        volatilityPct: avgAbs,
        positionCount: group.length,
        markedPositions: marked.length,
        exposurePct,
        level,
        highThresholdPct: thresholds.high,
        extremeThresholdPct: thresholds.extreme,
      }];
    });

  const alerts: PortfolioAlert[] = [];
  for (const position of positions) {
    if (position.stopLoss == null) {
      alerts.push({
        tone: "danger",
        title: "Thiếu stop loss",
        detail: `${position.symbol} (${formatAssetType(position.assetType)}) chưa gắn SL.`,
        symbol: position.symbol,
      });
    }
    if (
      position.mark != null &&
      position.stopLoss != null &&
      position.distanceToStopPct != null &&
      position.distanceToStopPct <= 3
    ) {
      alerts.push({
        tone: "danger",
        title: "Gần stop loss",
        detail: `Giá hiện tại chỉ còn ${Math.abs(position.distanceToStopPct).toFixed(1)}% tới SL.`,
        symbol: position.symbol,
      });
    }
    if (
      position.mark != null &&
      position.takeProfit != null &&
      position.distanceToTargetPct != null &&
      position.distanceToTargetPct >= -2 &&
      position.distanceToTargetPct <= 3
    ) {
      alerts.push({
        tone: "info",
        title: "Gần take profit",
        detail: `Giá đang cách TP khoảng ${Math.abs(position.distanceToTargetPct).toFixed(1)}%.`,
        symbol: position.symbol,
      });
    }
    if (position.assetType === "stock" && position.mark == null) {
      alerts.push({
        tone: "warning",
        title: "Cổ phiếu chưa có mark",
        detail: `${position.symbol} chưa kéo được giá từ nguồn VN — unrealized PnL tạm bỏ qua.`,
        symbol: position.symbol,
      });
    }
  }
  if (allocation[0]?.percentage >= 60) {
    alerts.push({
      tone: "warning",
      title: "Tập trung cao",
      detail: `${allocation[0].label} chiếm ${allocation[0].percentage.toFixed(0)}% exposure.`,
      symbol: allocation[0].label,
    });
  }
  if (positions.length > 0 && totalRisk == null) {
    alerts.push({
      tone: "warning",
      title: "Chưa đo được rủi ro",
      detail: "Thêm stop loss cho vị thế mở để hệ thống tính risk budget.",
    });
  }
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
    open.length ? (open.filter((t) => t.stopLoss != null).length / open.length) * 50 : 50,
    open.length ? (open.filter((t) => t.takeProfit != null).length / open.length) * 25 : 25,
    closed.length ? Math.min(25, (rValues.filter((v) => v >= 0).length / closed.length) * 25) : 25,
  ];
  const disciplineScore = Math.round(
    Math.max(0, Math.min(100, disciplineInputs.reduce((s, v) => s + v, 0))),
  );
  const stopLossCoverage = open.length
    ? (open.filter((t) => t.stopLoss != null).length / open.length) * 100
    : 100;
  const profitFactor = grossLoss > 0 ? wins.reduce((s, v) => s + v, 0) / grossLoss : null;
  const edgeScore = closed.length
    ? Math.max(0, Math.min(100, ((profitFactor == null ? 0 : Math.min(2, profitFactor)) / 2) * 100))
    : 50;
  const riskScore = positions.length
    ? totalRisk == null
      ? 25
      : Math.max(0, 100 - Math.min(100, (totalRisk / Math.max(totalExposure, 1)) * 100))
    : 100;
  const volatilityScore = volatilityByAsset.length
    ? volatilityByAsset.reduce(
        (sum, item) =>
          sum +
          (item.level === "extreme"
            ? 0
            : item.level === "high"
              ? 30
              : item.level === "elevated"
                ? 65
                : item.level === "unavailable"
                  ? 50
                  : 100),
        0,
      ) / volatilityByAsset.length
    : 100;
  const portfolioScore = Math.round(
    disciplineScore * 0.35 + edgeScore * 0.25 + riskScore * 0.2 + volatilityScore * 0.2,
  );

  const portfolioStatus = buildPortfolioStatus(positions, marks, realizedPnl, unrealizedPnl);
  if (portfolioStatus.dataGaps.length) {
    for (const gap of portfolioStatus.dataGaps.slice(0, 2)) {
      alerts.push({ tone: "warning", title: "Thiếu dữ liệu nguồn", detail: gap });
    }
  }

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
    averageR: rValues.length ? rValues.reduce((s, v) => s + v, 0) / rValues.length : null,
    allocation,
    performanceByAsset,
    volatilityByAsset,
    stopLossCoverage,
    portfolioScore,
    alerts: alerts.slice(0, 10),
    disciplineScore,
    portfolioStatus,
  };
}

export function formatAssetType(value: string): string {
  return value === "crypto"
    ? "Crypto"
    : value === "forex"
      ? "Forex"
      : value === "commodity"
        ? "Hàng hóa"
        : "Cổ phiếu";
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
