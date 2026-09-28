import "server-only";
import type { OhlcvBar } from "../types";
import { ProviderError } from "./binance";

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Map app index codes → dchart.vndirect.com.vn symbols */
const DCHART_SYMBOL_MAP: Record<string, string> = {
  VNINDEX: "VNINDEX",
  VNI: "VNINDEX",
  VN: "VNINDEX",
  VN30: "VN30",
  VN100: "VN100",
  HNX: "HNX",
  HNXINDEX: "HNX",
  HNX30: "HNX30",
  UPCOM: "UPCOM",
  UPCOMINDEX: "UPCOM",
  VNXALL: "VNXALL",
  VNALL: "VNXALL",
};

export function toDchartSymbol(symbol: string): string {
  const raw = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return DCHART_SYMBOL_MAP[raw] ?? raw;
}

const MEMO = new Map<string, { at: number; bars: OhlcvBar[] }>();
const MEMO_TTL_MS = 8_000;

/** Max bars per resolution we request from dchart (API returns within from/to). */
const MAX_BARS: Record<string, number> = {
  D: 2_000,
  "60": 1_500,
  "30": 1_200,
  "15": 1_200,
  "5": 1_000,
  "1": 800,
};

const DCHART_HOSTS = [
  "https://dchart-api.vndirect.com.vn",
  "https://dchart.vndirect.com.vn",
];
let lastGoodHost = 0;

/**
 * Cùng nguồn biểu đồ https://dchart.vndirect.com.vn — chuẩn nến VNDirect.
 * Multi-host + 3 attempts + memo để history/stream không double-fetch.
 */
export async function fetchVndDchartHistory(
  symbol: string,
  resolution: "D" | "1" | "5" | "15" | "30" | "60" = "D",
  bars = 500,
): Promise<OhlcvBar[]> {
  const sym = toDchartSymbol(symbol);
  const cap = MAX_BARS[resolution] ?? 1_000;
  const want = Math.max(20, Math.min(Math.floor(bars), cap));
  const key = `${sym}:${resolution}:${want}`;
  const hit = MEMO.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS && hit.bars.length) return hit.bars;

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

  const calendarPad = resolution === "D" ? 1.65 : 1.35;
  const from = to - Math.ceil(want * stepSec * calendarPad);

  let lastErr: unknown = null;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const hostIdx = (lastGoodHost + attempt) % DCHART_HOSTS.length;
    const host = DCHART_HOSTS[hostIdx]!;
    const url = `${host}/dchart/history?symbol=${encodeURIComponent(sym)}&resolution=${resolution}&from=${from}&to=${to}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "*/*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Origin: "https://dchart.vndirect.com.vn",
          Referer: "https://dchart.vndirect.com.vn/",
        },
        signal: AbortSignal.timeout(attempt === 0 ? 8_000 : attempt === 1 ? 12_000 : 15_000),
        cache: "no-store",
      });
      if (!res.ok) throw new ProviderError(`vndirect dchart HTTP ${res.status} (${sym})`, "vndirect");
      const data = (await res.json()) as {
        s?: string;
        t?: number[];
        o?: number[];
        h?: number[];
        l?: number[];
        c?: number[];
        v?: number[];
      };
      if (data.s && data.s !== "ok") throw new ProviderError(`vndirect dchart status ${data.s} (${sym})`, "vndirect");
      const ts = data.t ?? [];
      const out: OhlcvBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        let o = num(data.o?.[i]);
        let h = num(data.h?.[i]);
        let l = num(data.l?.[i]);
        let c = num(data.c?.[i]);
        if (o == null || h == null || l == null || c == null || c <= 0) continue;
        if (h < l) {
          const tmp = h;
          h = l;
          l = tmp;
        }
        if (o < l) o = l;
        if (o > h) o = h;
        if (c < l) c = l;
        if (c > h) c = h;
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
        if (!Number.isFinite(timeMs) || timeMs <= 0) continue;
        out.push({
          time: timeMs,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: Math.max(0, num(data.v?.[i]) ?? 0),
        });
      }
      if (!out.length) throw new ProviderError(`vndirect dchart empty ${sym}`, "vndirect");
      lastGoodHost = hostIdx;
      const sliced = out.slice(-want);
      MEMO.set(key, { at: Date.now(), bars: sliced });
      if (MEMO.size > 120) {
        const oldest = [...MEMO.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) MEMO.delete(oldest[0]);
      }
      return sliced;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 200 + attempt * 250));
    }
  }
  throw lastErr instanceof ProviderError
    ? lastErr
    : new ProviderError(`vndirect dchart: ${String(lastErr)}`, "vndirect");
}
