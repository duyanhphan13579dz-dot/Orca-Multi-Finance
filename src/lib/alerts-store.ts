/** Client-side price alert store (localStorage). */

export type AlertDirection = "above" | "below" | "cross";

export type PriceAlertStatus = "active" | "triggered" | "dismissed";

export interface PriceAlert {
  id: string;
  symbol: string;
  /** Mức giá kích hoạt */
  targetPrice: number;
  /** above = giá >= target; below = giá <= target; cross = chạm từ hai phía */
  direction: AlertDirection;
  reason: string;
  status: PriceAlertStatus;
  createdAt: number;
  triggeredAt: number | null;
  triggeredPrice: number | null;
}

const KEY = "orca.price-alerts.v1";

export function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PriceAlert[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: PriceAlert[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(alerts));
  window.dispatchEvent(new CustomEvent("orca-alerts-changed"));
}

export function addAlert(input: {
  symbol: string;
  targetPrice: number;
  direction: AlertDirection;
  reason: string;
}): PriceAlert {
  const alert: PriceAlert = {
    id: crypto.randomUUID(),
    symbol: input.symbol.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    targetPrice: input.targetPrice,
    direction: input.direction,
    reason: input.reason.trim().slice(0, 280),
    status: "active",
    createdAt: Date.now(),
    triggeredAt: null,
    triggeredPrice: null,
  };
  const next = [alert, ...loadAlerts()];
  saveAlerts(next);
  return alert;
}

export function removeAlert(id: string): void {
  saveAlerts(loadAlerts().filter((a) => a.id !== id));
}

export function markTriggered(id: string, price: number): PriceAlert | null {
  const list = loadAlerts();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  if (list[idx].status !== "active") return list[idx];
  list[idx] = {
    ...list[idx],
    status: "triggered",
    triggeredAt: Date.now(),
    triggeredPrice: price,
  };
  saveAlerts(list);
  return list[idx];
}

export function activeSymbols(alerts: PriceAlert[] = loadAlerts()): string[] {
  return [...new Set(alerts.filter((a) => a.status === "active").map((a) => a.symbol))];
}

export function shouldTrigger(alert: PriceAlert, price: number, prevPrice: number | null): boolean {
  if (alert.status !== "active") return false;
  const t = alert.targetPrice;
  if (alert.direction === "above") return price >= t;
  if (alert.direction === "below") return price <= t;
  // cross: đi qua mức target so với giá trước
  if (prevPrice == null) return price === t;
  const wasBelow = prevPrice < t;
  const wasAbove = prevPrice > t;
  if (wasBelow && price >= t) return true;
  if (wasAbove && price <= t) return true;
  return false;
}
