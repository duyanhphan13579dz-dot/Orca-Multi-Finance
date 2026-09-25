/** Client-side price alert store (localStorage). */

export type AlertDirection = "above" | "below" | "cross";

/** price = mức cố định; ceiling/floor = biên độ phiên (từ quote) */
export type AlertKind = "price" | "ceiling" | "floor";

export type PriceAlertStatus = "active" | "triggered" | "dismissed";

export interface PriceAlert {
  id: string;
  symbol: string;
  /** Mức giá kích hoạt (với kind=ceiling/floor có thể = 0 đến khi resolve) */
  targetPrice: number;
  /** above = giá >= target; below = giá <= target; cross = chạm từ hai phía */
  direction: AlertDirection;
  kind?: AlertKind;
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
  kind?: AlertKind;
}): PriceAlert {
  const kind = input.kind ?? "price";
  const alert: PriceAlert = {
    id: crypto.randomUUID(),
    symbol: input.symbol.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    targetPrice: kind === "price" ? input.targetPrice : input.targetPrice || 0,
    direction: kind === "ceiling" ? "above" : kind === "floor" ? "below" : input.direction,
    kind,
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

export function shouldTrigger(
  alert: PriceAlert,
  price: number,
  prevPrice: number | null,
  bands?: { ceiling?: number | null; floor?: number | null },
): boolean {
  if (alert.status !== "active") return false;

  const kind = alert.kind ?? "price";
  if (kind === "ceiling") {
    const ceil = bands?.ceiling;
    if (ceil == null || !Number.isFinite(ceil)) return false;
    return Math.abs(price - ceil) <= 0.051 || price >= ceil;
  }
  if (kind === "floor") {
    const fl = bands?.floor;
    if (fl == null || !Number.isFinite(fl)) return false;
    return Math.abs(price - fl) <= 0.051 || price <= fl;
  }

  const t = alert.targetPrice;
  if (!Number.isFinite(t) || t <= 0) return false;
  if (alert.direction === "above") return price >= t;
  if (alert.direction === "below") return price <= t;
  // cross: đi qua mức target so với giá trước
  if (prevPrice == null) return Math.abs(price - t) <= 0.051;
  const wasBelow = prevPrice < t;
  const wasAbove = prevPrice > t;
  if (wasBelow && price >= t) return true;
  if (wasAbove && price <= t) return true;
  return false;
}
