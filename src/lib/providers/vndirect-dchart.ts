import "server-only";
import type { OhlcvBar } from "../types";
import { ProviderError } from "./binance";

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Cùng nguồn biểu đồ https://dchart.vndirect.com.vn — chuẩn nến VNDirect.
 * Ưu tiên dùng cho chart stock để tránh nhảy scale do giá chưa điều chỉnh (split).
 */
export async function fetchVndDchartHistory(
  symbol: string,
  resolution: "D" | "1" | "5" | "15" | "30" | "60" = "D",
  bars = 250,
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const to = Math.floor(Date.now() / 1000);
  const stepSec =
    resolution === "D"
      ? 86_400
      : resolution === "60"
        ? 3_600
        : resolution === "30"
          ? 1_800
          : resolution === "15"
            ? 900
            : resolution === "5"
              ? 300
              : 60;
  const from = to - Math.ceil(bars * stepSec * 1.6);
  const url = `https://dchart-api.vndirect.com.vn/dchart/history?symbol=${encodeURIComponent(sym)}&resolution=${resolution}&from=${from}&to=${to}`;
  const res = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://dchart.vndirect.com.vn",
      Referer: "https://dchart.vndirect.com.vn/",
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new ProviderError(`vndirect dchart HTTP ${res.status}`, "vndirect");
  const data = (await res.json()) as {
    s?: string;
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
  };
  if (data.s && data.s !== "ok") throw new ProviderError(`vndirect dchart status ${data.s}`, "vndirect");
  const ts = data.t ?? [];
  const out: OhlcvBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = num(data.o?.[i]);
    const h = num(data.h?.[i]);
    const l = num(data.l?.[i]);
    const c = num(data.c?.[i]);
    if (o == null || h == null || l == null || c == null || c <= 0) continue;
    const timeMs =
      resolution === "D"
        ? (() => {
            const d = new Date(ts[i]! * 1000);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, "0");
            const day = String(d.getUTCDate()).padStart(2, "0");
            return Date.parse(`${y}-${m}-${day}T15:00:00+07:00`);
          })()
        : ts[i]! * 1000;
    out.push({
      time: timeMs,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: num(data.v?.[i]) ?? 0,
    });
  }
  if (!out.length) throw new ProviderError(`vndirect dchart empty ${sym}`, "vndirect");
  return out.slice(-bars);
}
