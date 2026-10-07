import assert from "node:assert/strict";
import test from "node:test";
import { buildPortfolioSnapshot, collectPortfolioSymbols, type PortfolioTrade } from "@/lib/portfolio";

const baseTrade = (overrides: Partial<PortfolioTrade> = {}): PortfolioTrade => ({
  id: crypto.randomUUID(),
  assetType: "crypto",
  symbol: "BTCUSDT",
  side: "long",
  entry: 100,
  exit: null,
  stopLoss: 90,
  takeProfit: 120,
  size: 2,
  leverage: 1,
  strategy: "breakout",
  emotion: "calm",
  notes: "",
  openedAt: Date.now(),
  closedAt: null,
  ...overrides,
});

test("buildPortfolioSnapshot computes open exposure, unrealized pnl and allocation", () => {
  const snapshot = buildPortfolioSnapshot(
    [baseTrade()],
    [{ assetType: "crypto", symbol: "BTCUSDT", addedAt: Date.now() }],
    [{ assetType: "crypto", symbol: "BTCUSDT", price: 110, changePercent: 2 }],
  );

  assert.equal(snapshot.positions.length, 1);
  assert.equal(snapshot.positions[0]?.unrealizedPnl, 20);
  assert.equal(snapshot.positions[0]?.exposure, 220);
  assert.equal(snapshot.unrealizedPnl, 20);
  assert.equal(snapshot.allocation[0]?.percentage, 100);
  assert.equal(snapshot.portfolioStatus.markedOpenCount, 1);
  assert.equal(snapshot.portfolioStatus.markCoveragePct, 100);
  assert.ok(snapshot.positions[0]?.assetStatus?.hasMark);
});

test("buildPortfolioSnapshot measures closed performance and drawdown", () => {
  const snapshot = buildPortfolioSnapshot(
    [
      baseTrade({ id: "win", exit: 120, closedAt: 2 }),
      baseTrade({ id: "loss", entry: 100, exit: 90, closedAt: 3 }),
    ],
    [],
    [],
  );

  assert.equal(snapshot.realizedPnl, 20);
  assert.equal(snapshot.winRate, 0.5);
  assert.equal(snapshot.profitFactor, 2);
  assert.equal(snapshot.maxDrawdown, 20);
  assert.equal(snapshot.performanceByAsset[0]?.label, "crypto");
  assert.equal(snapshot.performanceByAsset[0]?.pnl, 20);
});

test("open positions without stop loss create a discipline alert", () => {
  const snapshot = buildPortfolioSnapshot([baseTrade({ stopLoss: null })], [], []);
  assert.equal(snapshot.alerts.some((alert) => alert.title === "Thiếu stop loss"), true);
  assert.equal(snapshot.totalRisk, null);
});

test("high asset volatility creates an automatic risk alert", () => {
  const snapshot = buildPortfolioSnapshot(
    [baseTrade({ id: "volatile", stopLoss: 90 })],
    [],
    [{ assetType: "crypto", symbol: "BTCUSDT", price: 110, changePercent: 8 }],
  );

  assert.equal(snapshot.volatilityByAsset[0]?.level, "extreme");
  assert.equal(snapshot.alerts.some((alert) => alert.title === "Biến động cực cao"), true);
});

test("stock marks from source feed portfolio status and asset status", () => {
  const snapshot = buildPortfolioSnapshot(
    [
      {
        id: "vcb-1",
        assetType: "stock",
        symbol: "VCB",
        side: "long",
        entry: 90_000,
        exit: null,
        stopLoss: 85_000,
        takeProfit: 100_000,
        size: 100,
        leverage: 1,
        strategy: "swing",
        emotion: "calm",
        notes: "",
        openedAt: Date.now(),
        closedAt: null,
      },
    ],
    [{ assetType: "stock", symbol: "VCB", addedAt: Date.now() }],
    [{ assetType: "stock", symbol: "VCB", price: 92_500, changePercent: 1.2, source: "vndirect", fresh: true }],
  );

  assert.equal(snapshot.portfolioStatus.stockOpenCount, 1);
  assert.equal(snapshot.portfolioStatus.stockMarkedCount, 1);
  assert.equal(snapshot.positions[0]?.assetStatus?.label, "Tăng nhẹ");
  assert.equal(snapshot.positions[0]?.unrealizedPnl, 250_000);
});

test("collectPortfolioSymbols buckets by asset class", () => {
  const buckets = collectPortfolioSymbols(
    [
      {
        id: "1",
        assetType: "stock",
        symbol: "FPT",
        side: "long",
        entry: 1,
        exit: null,
        stopLoss: null,
        takeProfit: null,
        size: 1,
        leverage: 1,
        strategy: "",
        emotion: "",
        notes: "",
        openedAt: 1,
        closedAt: null,
      },
    ],
    [{ assetType: "crypto", symbol: "BTCUSDT", addedAt: 1 }],
  );
  assert.deepEqual(buckets.stock, ["FPT"]);
  assert.deepEqual(buckets.crypto, ["BTCUSDT"]);
});
