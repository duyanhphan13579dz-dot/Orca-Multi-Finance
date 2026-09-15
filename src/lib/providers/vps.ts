import "server-only";
import { httpJson } from "../http";
import type { Quote } from "../types";

/**
 * VPS public datafeed — bảng giá realtime HOSE/HNX/UPCOM (không cần API key).
 * Endpoint: https://bgapidatafeed.vps.com.vn/getliststockdata/SYM1,SYM2
 * Giá thường ở đơn vị nghìn đồng (lastPrice 26.85 = 26,850 VND).
 */

const BASE = "https://bgapidatafeed.vps.com.vn";

type VpsRow = {
  sym?: string;
  lastPrice?: number | string;
  openPrice?: number | string;
  highPrice?: number | string;
  lowPrice?: number | string;
  avePrice?: number | string;
  changePc?: number | string;
  ot?: number | string; // absolute change
  lot?: number | string; // volume (lots?)
  r?: number | string; // reference
  c?: number | string; // ceiling
  f?: number | string; // floor
  closePrice?: number | string; // sometimes full VND
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** VPS lastPrice thường là nghìn đồng; nếu < 1000 scale *1000 */
function toVnd(price: number | null): number | null {
  if (price == null) return null;
  if (price > 0 && price < 500) return Math.round(price * 1000);
  return price;
}

export async function getVpsQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  sourceTs: number | null;
}> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  if (!uniq.length) return { quotes: [], sourceTs: null };

  const res = await httpJson<VpsRow[]>(`${BASE}/getliststockdata/${uniq.join(",")}`, {
    provider: "vps",
    timeoutMs: 8_000,
    retries: 1,
    headers: {
      Accept: "application/json",
      "User-Agent": "Orca-Multi-Finance/1.0",
    },
  });

  if (!res.ok || !Array.isArray(res.data)) {
    throw new Error(`vps: ${res.error ?? "empty"}`);
  }

  const quotes: Quote[] = [];
  for (const r of res.data) {
    const symbol = String(r.sym ?? "").toUpperCase();
    if (!symbol) continue;
    const rawLast = num(r.lastPrice) ?? num(r.avePrice);
    // closePrice đôi khi đã là VND đầy đủ (26700)
    const closeFull = num(r.closePrice);
    let price = toVnd(rawLast);
    if (closeFull != null && closeFull > 1000) {
      // ưu tiên closePrice nếu scale khớp
      if (price == null || Math.abs(closeFull - price) / closeFull > 0.5) price = closeFull;
      else price = closeFull; // prefer official close if present
    }
    if (price == null || price <= 0) continue;

    const ref = toVnd(num(r.r));
    const chgAbs = num(r.ot);
    const chgPct = num(r.changePc);
    quotes.push({
      symbol,
      assetClass: "stock",
      price,
      change: chgAbs != null ? (Math.abs(chgAbs) < 500 ? chgAbs * 1000 : chgAbs) : ref != null ? price - ref : null,
      changePercent: chgPct,
      open: toVnd(num(r.openPrice)),
      high: toVnd(num(r.highPrice)),
      low: toVnd(num(r.lowPrice)),
      volume: num(r.lot) != null ? Math.round(Number(r.lot) * 100) : null, // lot * 100 shares approx
      quoteVolume: null,
      referencePrice: ref,
      ceilingPrice: toVnd(num(r.c)),
      floorPrice: toVnd(num(r.f)),
      updatedAt: new Date().toISOString(),
    });
  }

  if (!quotes.length) throw new Error("vps: no quotes mapped");
  return { quotes, sourceTs: Date.now() };
}
