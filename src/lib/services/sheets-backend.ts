import "server-only";
import {
  ensureSheetWithHeaders,
  getSheetsConfig,
  isSheetsConfigured,
  readRange,
  writeRange,
} from "@/lib/providers/google-sheets";
import type { PortfolioTrade, PortfolioWatchItem } from "@/lib/portfolio";
import type { PriceAlert } from "@/lib/alerts-store";

export { isSheetsConfigured };

const TRADES_SHEET = "Trades";
const WATCH_SHEET = "Watchlist";
const ALERTS_SHEET = "Alerts";

const TRADE_HEADERS = [
  "id", "assetType", "symbol", "side", "entry", "exit", "stopLoss", "takeProfit",
  "size", "leverage", "strategy", "emotion", "notes", "openedAt", "closedAt",
];
const WATCH_HEADERS = ["assetType", "symbol", "addedAt"];
const ALERT_HEADERS = [
  "id", "symbol", "kind", "direction", "targetPrice", "status", "reason",
  "createdAt", "triggeredAt", "triggeredPrice",
];

function numOrNull(s: string): number | null {
  if (s === "" || s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function initSheetsSchema(): Promise<{ ok: boolean; sheets: string[] }> {
  if (!isSheetsConfigured()) return { ok: false, sheets: [] };
  await ensureSheetWithHeaders(TRADES_SHEET, TRADE_HEADERS);
  await ensureSheetWithHeaders(WATCH_SHEET, WATCH_HEADERS);
  await ensureSheetWithHeaders(ALERTS_SHEET, ALERT_HEADERS);
  return { ok: true, sheets: [TRADES_SHEET, WATCH_SHEET, ALERTS_SHEET] };
}

export async function pullTrades(): Promise<PortfolioTrade[]> {
  if (!isSheetsConfigured()) return [];
  const rows = await readRange(`${TRADES_SHEET}!A2:O`);
  const out: PortfolioTrade[] = [];
  for (const r of rows) {
    if (!r[0]) continue;
    out.push({
      id: r[0],
      assetType: (r[1] as PortfolioTrade["assetType"]) || "stock",
      symbol: r[2] || "",
      side: (r[3] as PortfolioTrade["side"]) || "long",
      entry: Number(r[4]) || 0,
      exit: numOrNull(r[5] ?? ""),
      stopLoss: numOrNull(r[6] ?? ""),
      takeProfit: numOrNull(r[7] ?? ""),
      size: numOrNull(r[8] ?? ""),
      leverage: numOrNull(r[9] ?? ""),
      strategy: r[10] || "",
      emotion: r[11] || "",
      notes: r[12] || "",
      openedAt: Number(r[13]) || Date.now(),
      closedAt: numOrNull(r[14] ?? ""),
    });
  }
  return out;
}

export async function pushTrades(trades: PortfolioTrade[]): Promise<void> {
  if (!isSheetsConfigured()) throw new Error("Sheets not configured");
  await ensureSheetWithHeaders(TRADES_SHEET, TRADE_HEADERS);
  const values: (string | number | null)[][] = [
    TRADE_HEADERS,
    ...trades.map((t) => [
      t.id, t.assetType, t.symbol, t.side, t.entry, t.exit, t.stopLoss, t.takeProfit,
      t.size, t.leverage, t.strategy, t.emotion, t.notes, t.openedAt, t.closedAt,
    ]),
  ];
  await writeRange(`${TRADES_SHEET}!A1:O${Math.max(trades.length + 1, 2)}`, values);
}

export async function pullWatchlist(): Promise<PortfolioWatchItem[]> {
  if (!isSheetsConfigured()) return [];
  const rows = await readRange(`${WATCH_SHEET}!A2:C`);
  const out: PortfolioWatchItem[] = [];
  for (const r of rows) {
    if (!r[1]) continue;
    out.push({
      assetType: (r[0] as PortfolioWatchItem["assetType"]) || "stock",
      symbol: r[1],
      addedAt: Number(r[2]) || Date.now(),
    });
  }
  return out;
}

export async function pushWatchlist(items: PortfolioWatchItem[]): Promise<void> {
  if (!isSheetsConfigured()) throw new Error("Sheets not configured");
  await ensureSheetWithHeaders(WATCH_SHEET, WATCH_HEADERS);
  const values: (string | number | null)[][] = [
    WATCH_HEADERS,
    ...items.map((i) => [i.assetType, i.symbol, i.addedAt]),
  ];
  await writeRange(`${WATCH_SHEET}!A1:C${Math.max(items.length + 1, 2)}`, values);
}

export async function pullAlerts(): Promise<PriceAlert[]> {
  if (!isSheetsConfigured()) return [];
  const rows = await readRange(`${ALERTS_SHEET}!A2:J`);
  const out: PriceAlert[] = [];
  for (const r of rows) {
    if (!r[0]) continue;
    out.push({
      id: r[0],
      symbol: r[1] || "",
      kind: (r[2] as PriceAlert["kind"]) || "price",
      direction: (r[3] as PriceAlert["direction"]) || "above",
      targetPrice: Number(r[4]) || 0,
      status: (r[5] as PriceAlert["status"]) || "active",
      reason: r[6] || "",
      createdAt: Number(r[7]) || Date.now(),
      triggeredAt: numOrNull(r[8] ?? ""),
      triggeredPrice: numOrNull(r[9] ?? ""),
    });
  }
  return out;
}

export async function pushAlerts(alerts: PriceAlert[]): Promise<void> {
  if (!isSheetsConfigured()) throw new Error("Sheets not configured");
  await ensureSheetWithHeaders(ALERTS_SHEET, ALERT_HEADERS);
  const values: (string | number | null)[][] = [
    ALERT_HEADERS,
    ...alerts.map((a) => [
      a.id, a.symbol, a.kind ?? "price", a.direction, a.targetPrice, a.status,
      a.reason ?? "", a.createdAt, a.triggeredAt, a.triggeredPrice,
    ]),
  ];
  await writeRange(`${ALERTS_SHEET}!A1:J${Math.max(alerts.length + 1, 2)}`, values);
}

export function sheetsStatus() {
  const cfg = getSheetsConfig();
  return {
    configured: Boolean(cfg),
    spreadsheetId: cfg?.spreadsheetId ?? null,
    serviceEmail: cfg?.email ?? null,
  };
}
