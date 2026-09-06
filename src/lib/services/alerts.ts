/**
 * ALERTS SERVICE — DB-backed alert CRUD + snapshot-backed evaluation.
 *
 * The evaluation core is `src/lib/engines/alerts.ts` (pure). This module:
 *  - manages per-user alert rows (create/list/update/delete)
 *  - resolves live snapshots from the same provider services the UI uses
 *  - marks `triggeredAt` when a condition fires (idempotent per crossing)
 *  - exposes `pollActiveAlerts()` for the realtime scheduler
 */

import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { evaluateAlert, ALERT_CONDITIONS, type AlertCondition, type AlertSnapshot } from "../engines/alerts";
import { getCryptoMarkets, getCryptoKlines } from "./crypto";
import { getForexMarkets } from "./forex";
import { getCommodityMarket } from "./commodities";
import { getVnQuotes, getVnOhlcv } from "./stocks";
import { rsi as rsiSeries, sma } from "../technical";
import type { OhlcvBar } from "../types";

export type AssetType = "stock" | "crypto" | "forex" | "commodity";
const ASSET_TYPES: AssetType[] = ["stock", "crypto", "forex", "commodity"];

export interface AlertRow {
  id: string;
  userId: string | null;
  assetType: AssetType;
  symbol: string;
  condition: AlertCondition;
  threshold: number | null;
  active: boolean;
  triggeredAt: string | null;
  createdAt: string;
}

const rowFrom = (r: typeof alerts.$inferSelect): AlertRow => ({
  id: r.id,
  userId: r.userId,
  assetType: r.assetType as AssetType,
  symbol: r.symbol.toUpperCase(),
  condition: r.condition as AlertCondition,
  threshold: r.threshold != null ? Number(r.threshold) : null,
  active: r.active ?? true,
  triggeredAt: r.triggeredAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export function validateAlertInput(input: {
  assetType?: unknown;
  symbol?: unknown;
  condition?: unknown;
  threshold?: unknown;
}): { ok: boolean; error?: string; value?: { assetType: AssetType; symbol: string; condition: AlertCondition; threshold: number | null } } {
  const assetType = input.assetType as AssetType;
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  const condition = input.condition as AlertCondition;
  const threshold = input.threshold == null || input.threshold === "" ? null : Number(input.threshold);
  if (!ASSET_TYPES.includes(assetType)) return { ok: false, error: "assetType phải là stock|crypto|forex|commodity" };
  if (!/^[A-Z0-9._-]{2,20}$/.test(symbol)) return { ok: false, error: "symbol không hợp lệ" };
  if (!ALERT_CONDITIONS.includes(condition)) return { ok: false, error: `condition phải là ${ALERT_CONDITIONS.join("|")}` };
  if (threshold == null || !Number.isFinite(threshold)) return { ok: false, error: "threshold bắt buộc và phải là số" };
  return { ok: true, value: { assetType, symbol, condition, threshold } };
}

/* --------------------------------- CRUD ----------------------------------- */

export async function listAlerts(userId: string): Promise<AlertRow[]> {
  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.active, true)))
    .orderBy(alerts.createdAt);
  return rows.map(rowFrom);
}

export async function createAlert(userId: string, input: { assetType: AssetType; symbol: string; condition: AlertCondition; threshold: number }): Promise<AlertRow> {
  const [row] = await db
    .insert(alerts)
    .values({ userId, assetType: input.assetType, symbol: input.symbol, condition: input.condition, threshold: String(input.threshold) })
    .returning();
  return rowFrom(row);
}

export async function updateAlert(userId: string, id: string, patch: { active?: boolean; threshold?: number | null }): Promise<AlertRow | null> {
  const set: Record<string, unknown> = {};
  if (patch.active != null) set.active = patch.active;
  if (patch.threshold !== undefined) set.threshold = patch.threshold == null ? null : String(patch.threshold);
  const [row] = await db
    .update(alerts)
    .set({ ...set, triggeredAt: patch.threshold !== undefined ? null : undefined })
    .where(and(eq(alerts.id, id), eq(alerts.userId, userId)))
    .returning();
  return row ? rowFrom(row) : null;
}

export async function deleteAlert(userId: string, id: string): Promise<boolean> {
  const res = await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, userId)));
  return (res.rowCount ?? 0) > 0;
}

/* ------------------------------- snapshots --------------------------------- */

function volumeRatioFromBars(bars: OhlcvBar[]): number | null {
  if (bars.length < 21) return null;
  const vols = bars.slice(-21, -1).map((b) => b.volume);
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  if (avg <= 0) return null;
  return bars[bars.length - 1].volume / avg;
}

function rsiFromBars(bars: OhlcvBar[]): number | null {
  const closes = bars.map((b) => b.close);
  const series = rsiSeries(closes, 14);
  return series[series.length - 1];
}

async function snapshotFor(assetType: AssetType, symbol: string): Promise<AlertSnapshot> {
  const s: AlertSnapshot = {};
  try {
    if (assetType === "crypto") {
      const m = await getCryptoMarkets();
      const row = m?.rows.find((r) => r.symbol === symbol);
      if (row) {
        s.price = row.price;
        s.changePercent = row.changePercent;
      }
      const k = await getCryptoKlines(symbol, "1h", 200);
      if (k?.bars.length) {
        s.rsi = rsiFromBars(k.bars);
        s.volumeRatio = volumeRatioFromBars(k.bars);
      }
    } else if (assetType === "stock") {
      const q = await getVnQuotes([symbol]);
      const row = q?.quotes[0];
      if (row) {
        s.price = row.price;
        s.changePercent = row.changePercent;
      }
      const k = await getVnOhlcv(symbol, 200);
      if (k?.bars.length) {
        s.rsi = rsiFromBars(k.bars);
        s.volumeRatio = volumeRatioFromBars(k.bars);
      }
    } else if (assetType === "forex") {
      const m = await getForexMarkets();
      const row = m?.data.rows.find((r) => r.pair === symbol || r.symbol === symbol);
      if (row) {
        s.price = row.price;
        s.changePercent = row.changePercent;
      }
    } else {
      const m = await getCommodityMarket();
      const row = m?.data.rows.find((r) => r.symbol === symbol || r.commodity === symbol);
      if (row) {
        s.price = row.price;
        s.changePercent = row.changePercent;
      }
    }
  } catch {
    // snapshot stays partial; evaluation reports missing fields per condition
  }
  return s;
}

/* ------------------------------- evaluation -------------------------------- */

export interface EvaluationResult {
  alert: AlertRow;
  triggered: boolean;
  value: number | null;
  reason: string | null;
}

/** CRITICAL PATH: fetch once per symbol, evaluate every alert on it. */
export async function checkUserAlerts(userId: string): Promise<EvaluationResult[]> {
  const rows = await listAlerts(userId);
  const results: EvaluationResult[] = [];
  const seen = new Map<string, AlertSnapshot>();
  for (const alert of rows) {
    if (alert.threshold == null) continue;
    const key = `${alert.assetType}:${alert.symbol}`;
    let snap = seen.get(key);
    if (!snap) {
      snap = await snapshotFor(alert.assetType, alert.symbol);
      seen.set(key, snap);
    }
    const ev = evaluateAlert(alert.condition, alert.threshold, snap);
    results.push({ alert, ...ev });
  }
  return results;
}

/** Mark freshly-triggered alerts; returns the ones that fired this run. */
export async function persistTriggers(userId: string, evaluated: EvaluationResult[]): Promise<AlertRow[]> {
  const fired: AlertRow[] = [];
  for (const e of evaluated) {
    if (!e.triggered || e.alert.triggeredAt) continue;
    const [row] = await db
      .update(alerts)
      .set({ triggeredAt: new Date() })
      .where(and(eq(alerts.id, e.alert.id), isNull(alerts.triggeredAt)))
      .returning();
    if (row) fired.push(rowFrom(row));
  }
  return fired;
}

/**
 * Scheduler hook — evaluate every active alert of every user.
 * Best-effort: DB/provider failures never crash the report loop.
 */
export async function pollActiveAlerts(): Promise<number> {
  try {
    const rows = await db.select({ userId: alerts.userId }).from(alerts).where(eq(alerts.active, true));
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => x != null))];
    let fired = 0;
    for (const uid of userIds) {
      const evaluated = await checkUserAlerts(uid);
      fired += (await persistTriggers(uid, evaluated)).length;
    }
    return fired;
  } catch {
    return 0;
  }
}
