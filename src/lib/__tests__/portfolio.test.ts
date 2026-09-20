import assert from "node:assert/strict";
import test from "node:test";
import { buildPortfolioSnapshot, type PortfolioTrade } from "@/lib/portfolio";

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
});

test("open positions without stop loss create a discipline alert", () => {
  const snapshot = buildPortfolioSnapshot([baseTrade({ stopLoss: null })], [], []);
  assert.equal(snapshot.alerts.some((alert) => alert.title === "Thiếu stop loss"), true);
  assert.equal(snapshot.totalRisk, null);
});
