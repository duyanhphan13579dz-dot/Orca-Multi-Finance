import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * SWISSQUOTE PUBLIC QUOTE FEED — real BBO (best bid/offer), no key.
 *
 * `GET https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/{BASE}/{QUOTE}`
 * Trả JSON array (mỗi entry là một venue/platform) với `spreadProfilePrices[]`
 * (bid/ask theo spread profile) + `ts` (epoch ms). Đây là nguồn DIRECT realtime
 * cho FX majors/crosses VÀ kim loại (XAU/XAG/XPT/XPD theo USD) — verified live
 * 2026-09-06 (EUR/USD 1.1612x, XAU/USD ~4430.6, XPT/USD ~1819, XPD/USD ~1383).
 *
 * Quy tắc:
 *  - Chọn profile có spread nhỏ nhất (elite/prime) trong venue có ts lớn nhất
 *    (nhiều venue trả cùng giá; lấy mức khớp nhất để tránh noise spread wide).
 *  - Tuyệt đối không suy diễn: payload rỗng / bid<=0 / ask<bid → ProviderError.
 *  - Batch theo chunk 6 + allSettled: một instrument lỗi KHÔNG làm hỏng phần còn lại.
 */

export const SWISSQUOTE = "swissquote-public";

export interface SwissQuote {
  mid: number;
  bid: number;
  ask: number;
  /** provider quote timestamp (epoch ms) — null nếu nguồn không gửi */
  ts: number | null;
}

type SqProfile = { spreadProfile?: string; bid?: number | string; ask?: number | string };
type SqVenue = { topo?: unknown; spreadProfilePrices?: SqProfile[]; ts?: number | string };

/** Chọn profile tốt nhất (spread nhỏ nhất) trong một venue. */
export function pickBestSqProfile(arr: SqProfile[]): SqProfile | null {
  let best: SqProfile | null = null;
  let bestSpread = Infinity;
  for (const p of arr) {
    const bid = Number(p.bid);
    const ask = Number(p.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) continue;
    const spread = ask - bid;
    if (spread < bestSpread) {
      best = p;
      bestSpread = spread;
    }
  }
  return best;
}

function toMs(ts: unknown): number | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Swissquote gửi epoch ms (~1.78e12); chấp nhận cả seconds
  return n > 1e12 ? n : n * 1000;
}

/** Parse MỘT venue → quote (null khi venue không có BBO hợp lệ). */
export function parseSqVenue(v: SqVenue | null | undefined): SwissQuote | null {
  const arr = v?.spreadProfilePrices;
  if (!Array.isArray(arr) || !arr.length) return null;
  const best = pickBestSqProfile(arr);
  if (!best) return null;
  const bid = Number(best.bid);
  const ask = Number(best.ask);
  return { mid: (bid + ask) / 2, bid, ask, ts: toMs(v?.ts ?? (best as { ts?: unknown }).ts) };
}

/** Parse toàn bộ payload (array venues) → quote mới nhất hợp lệ. */
export function parseSqBody(payload: unknown): SwissQuote | null {
  if (!Array.isArray(payload) || !payload.length) return null;
  let best: SwissQuote | null = null;
  for (const entry of payload) {
    const q = parseSqVenue(entry as SqVenue);
    if (q && (!best || (q.ts ?? 0) > (best.ts ?? 0))) best = q;
  }
  return best;
}

/** Quote trực tiếp cho một instrument (e.g. base=EUR, quote=USD). */
export async function getSwissquoteQuote(base: string, quote: string): Promise<SwissQuote> {
  const url = `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${encodeURIComponent(
    base.toUpperCase(),
  )}/${encodeURIComponent(quote.toUpperCase())}`;
  const res = await httpJson<unknown>(url, {
    provider: SWISSQUOTE,
    timeoutMs: 7_000,
    retries: 1,
    headers: { Accept: "application/json" },
  });
  if (!res.ok || res.data == null) throw new ProviderError(`swissquote: ${res.error ?? "unreachable"}`, SWISSQUOTE);
  const q = parseSqBody(res.data);
  if (!q) throw new ProviderError(`swissquote: invalid BBO payload for ${base}/${quote}`, SWISSQUOTE);
  return q;
}

/** Batch quotes (chunk 6, partial success preserved). Key = `BASEQUOTE`. */
export async function getSwissquoteQuotes(instruments: { base: string; quote: string }[]): Promise<Map<string, SwissQuote>> {
  const out = new Map<string, SwissQuote>();
  const chunkSize = 6;
  for (let i = 0; i < instruments.length; i += chunkSize) {
    const batch = instruments.slice(i, i + chunkSize);
    const results = await Promise.allSettled(batch.map((x) => getSwissquoteQuote(x.base, x.quote)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") out.set(`${batch[j].base.toUpperCase()}${batch[j].quote.toUpperCase()}`, r.value);
    });
  }
  return out;
}
