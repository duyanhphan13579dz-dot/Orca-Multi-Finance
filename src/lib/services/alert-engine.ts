import "server-only";
import { shouldTrigger, type PriceAlert } from "@/lib/alerts-store";
import { postGlobalDiscord } from "@/lib/services/discord-notify";
import { getVnQuotes } from "@/lib/services/stocks";
import {
  isSheetsConfigured,
  pullAlerts,
  pullTrades,
  pushAlerts,
} from "@/lib/services/sheets-backend";

const g = globalThis as typeof globalThis & {
  __orcaAlertPrev?: Record<string, number>;
  __orcaAlertFired?: Set<string>;
};

function prevMap() {
  if (!g.__orcaAlertPrev) g.__orcaAlertPrev = {};
  return g.__orcaAlertPrev;
}

function firedSet() {
  if (!g.__orcaAlertFired) g.__orcaAlertFired = new Set();
  return g.__orcaAlertFired;
}

function alertTitle(alert: PriceAlert): string {
  const kind = alert.kind ?? "price";
  if (kind === "ceiling") return `Chạm trần · ${alert.symbol}`;
  if (kind === "floor") return `Chạm sàn · ${alert.symbol}`;
  return `Cảnh báo ${alert.symbol}`;
}

function alertBody(alert: PriceAlert, price: number): string {
  const kind = alert.kind ?? "price";
  if (kind === "ceiling") {
    return `Giá ${price.toLocaleString("vi-VN")} chạm trần phiên${alert.reason ? `\nLý do: ${alert.reason}` : ""}`;
  }
  if (kind === "floor") {
    return `Giá ${price.toLocaleString("vi-VN")} chạm sàn phiên${alert.reason ? `\nLý do: ${alert.reason}` : ""}`;
  }
  return (
    `Giá ${price.toLocaleString("vi-VN")} đã chạm mức ${alert.targetPrice.toLocaleString("vi-VN")}` +
    (alert.reason ? `\nLý do: ${alert.reason}` : "")
  );
}

function colorFor(alert: PriceAlert): number {
  const kind = alert.kind ?? "price";
  if (kind === "ceiling") return 0xa78bfa;
  if (kind === "floor") return 0x38bdf8;
  return 0x22c55e;
}

export type AlertMonitorResult = {
  source: "sheets" | "none";
  active: number;
  checked: number;
  triggered: { id: string; symbol: string; price: number }[];
  discordOk: number;
  error?: string;
};

/** Server-side alert monitor — runs without any browser tab. */
export async function runServerAlertMonitor(): Promise<AlertMonitorResult> {
  if (!isSheetsConfigured()) {
    return {
      source: "none",
      active: 0,
      checked: 0,
      triggered: [],
      discordOk: 0,
      error: "Sheets not configured — push alerts from Portfolio → Sheets once",
    };
  }

  let alerts: PriceAlert[];
  try {
    alerts = await pullAlerts();
  } catch (e) {
    return {
      source: "sheets",
      active: 0,
      checked: 0,
      triggered: [],
      discordOk: 0,
      error: e instanceof Error ? e.message : "pullAlerts failed",
    };
  }

  const active = alerts.filter((a) => a.status === "active");

  let trades: Awaited<ReturnType<typeof pullTrades>> = [];
  try {
    trades = await pullTrades();
  } catch {
    trades = [];
  }
  const openStock = trades.filter(
    (t) => (t.assetType ?? "stock") === "stock" && t.exit == null && t.symbol,
  );

  const symbols = [
    ...new Set([
      ...active.map((a) => a.symbol.toUpperCase()),
      ...openStock.map((t) => String(t.symbol).toUpperCase()),
    ]),
  ].slice(0, 80);

  if (symbols.length === 0) {
    return { source: "sheets", active: 0, checked: 0, triggered: [], discordOk: 0 };
  }

  const board = await getVnQuotes(symbols);
  const quotes = board?.quotes ?? [];
  const prev = prevMap();
  const fired = firedSet();
  const triggered: AlertMonitorResult["triggered"] = [];
  let discordOk = 0;
  let changed = false;

  for (const q of quotes) {
    if (!q?.symbol || !Number.isFinite(q.price)) continue;
    const sym = String(q.symbol).toUpperCase();
    const prevPx = prev[sym] ?? null;

    for (const a of active.filter((x) => x.symbol.toUpperCase() === sym)) {
      if (fired.has(a.id)) continue;
      const hit = shouldTrigger(a, q.price, prevPx, {
        ceiling: (q as { ceilingPrice?: number | null }).ceilingPrice,
        floor: (q as { floorPrice?: number | null }).floorPrice,
      });
      if (!hit) continue;

      fired.add(a.id);
      const idx = alerts.findIndex((x) => x.id === a.id);
      if (idx >= 0) {
        alerts[idx] = {
          ...alerts[idx],
          status: "triggered",
          triggeredAt: Date.now(),
          triggeredPrice: q.price,
        };
        changed = true;
      }
      triggered.push({ id: a.id, symbol: sym, price: q.price });

      const sent = await postGlobalDiscord({
        title: alertTitle(a),
        description: alertBody(a, q.price),
        color: colorFor(a),
        username: "ORCA Alerts",
        fields: [
          { name: "Mã", value: "`" + sym + "`", inline: true },
          { name: "Giá", value: q.price.toLocaleString("vi-VN"), inline: true },
          ...(a.targetPrice
            ? [{ name: "Mức", value: a.targetPrice.toLocaleString("vi-VN"), inline: true }]
            : []),
        ],
      });
      if (sent.ok) discordOk += 1;
    }

    for (const pos of openStock.filter((p) => String(p.symbol).toUpperCase() === sym)) {
      const keySl = `pos-sl-${pos.id}`;
      const keyTp = `pos-tp-${pos.id}`;
      if (pos.stopLoss != null && Number.isFinite(pos.stopLoss)) {
        const hit = pos.side === "long" ? q.price <= pos.stopLoss : q.price >= pos.stopLoss;
        if (hit && !fired.has(keySl)) {
          fired.add(keySl);
          triggered.push({ id: keySl, symbol: sym, price: q.price });
          const sent = await postGlobalDiscord({
            title: `SL · ${sym}`,
            description: `Giá ${q.price.toLocaleString("vi-VN")} chạm Stop Loss ${pos.stopLoss.toLocaleString("vi-VN")} (${pos.side})`,
            color: 0xef4444,
            username: "ORCA Portfolio",
          });
          if (sent.ok) discordOk += 1;
        }
      }
      if (pos.takeProfit != null && Number.isFinite(pos.takeProfit)) {
        const hit = pos.side === "long" ? q.price >= pos.takeProfit : q.price <= pos.takeProfit;
        if (hit && !fired.has(keyTp)) {
          fired.add(keyTp);
          triggered.push({ id: keyTp, symbol: sym, price: q.price });
          const sent = await postGlobalDiscord({
            title: `TP · ${sym}`,
            description: `Giá ${q.price.toLocaleString("vi-VN")} chạm Take Profit ${pos.takeProfit.toLocaleString("vi-VN")} (${pos.side})`,
            color: 0x22c55e,
            username: "ORCA Portfolio",
          });
          if (sent.ok) discordOk += 1;
        }
      }
    }

    prev[sym] = q.price;
  }

  if (changed) {
    try {
      await pushAlerts(alerts);
    } catch {
      /* non-fatal */
    }
  }

  if (fired.size > 500) {
    g.__orcaAlertFired = new Set([...fired].slice(-200));
  }

  return {
    source: "sheets",
    active: active.length,
    checked: symbols.length,
    triggered,
    discordOk,
  };
}
