import "server-only";
import { env } from "../env";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * Forex providers: primary = Biquote (env-configured), real fallbacks =
 * exchangerate-api open endpoint (USD-based live rates) + Frankfurter/ECB for
 * validated daily history. All produce real timestamps; nothing synthetic.
 */

export const BIQUOTE = "biquote-forex";
export const ER_API = "exchangerate-api";
export const FRANKFURTER = "frankfurter-ecb";

export interface FxLatest {
  base: string;
  rates: Record<string, number>;
  ts: number; // source timestamp ms
  source: string;
}

/** Primary: Biquote realtime quotes (requires BIQUOTE_BASE_URL + BIQUOTE_API_KEY). */
export async function getBiquoteQuotes(pairs: string[]): Promise<{ rates: Record<string, number>; ts: number | null }> {
  if (!env.biquoteBaseUrl || !env.biquoteApiKey) throw new ProviderError("Biquote not configured", BIQUOTE);
  const res = await httpJson<unknown>(`${env.biquoteBaseUrl.replace(/\/$/, "")}/v1/quotes?symbols=${pairs.join(",")}`, {
    provider: BIQUOTE,
    headers: { Authorization: `Bearer ${env.biquoteApiKey}`, "x-api-key": env.biquoteApiKey },
    timeoutMs: 7_000,
    retries: 1,
  });
  if (!res.ok || res.data == null) throw new ProviderError(`biquote: ${res.error ?? "unreachable"}`, BIQUOTE);
  const payload = res.data as Record<string, unknown>;
  const container = (payload.data ?? payload.rates ?? payload) as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(container)) {
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const price = Number(rec.price ?? rec.rate ?? rec.last ?? rec.mid);
      if (Number.isFinite(price)) rates[k.toUpperCase().replace("/", "")] = price;
    } else {
      const price = Number(v);
      if (Number.isFinite(price)) rates[k.toUpperCase().replace("/", "")] = price;
    }
  }
  if (!Object.keys(rates).length) throw new ProviderError("biquote: empty payload", BIQUOTE);
  const tsRaw = payload.timestamp ?? payload.time ?? payload.updatedAt;
  const ts = typeof tsRaw === "number" ? (tsRaw > 1e12 ? tsRaw : tsRaw * 1000) : Date.parse(String(tsRaw ?? ""));
  return { rates, ts: Number.isFinite(ts) ? ts : null };
}

type ErApiPayload = {
  result: string;
  time_last_update_unix: number;
  time_last_update_utc: string;
  base_code: string;
  rates: Record<string, number>;
};

/** Real fallback: latest USD-based rates with provider timestamps. */
export async function getErApiLatest(): Promise<FxLatest> {
  const res = await httpJson<ErApiPayload>("https://open.er-api.com/v6/latest/USD", {
    provider: ER_API,
    timeoutMs: 7_000,
    retries: 1,
  });
  if (!res.ok || !res.data || res.data.result !== "success") {
    throw new ProviderError(`exchangerate-api: ${res.error ?? "unreachable"}`, ER_API);
  }
  return {
    base: "USD",
    rates: res.data.rates,
    ts: res.data.time_last_update_unix * 1000,
    source: "exchangerate-api (open)",
  };
}

type FrankfurterSeries = {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
};

/** ECB daily reference history (real central-bank data). */
export async function getFrankfurterSeries(base: string, quote: string, days = 366): Promise<{ date: string; rate: number }[]> {
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const res = await httpJson<FrankfurterSeries>(
    `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(end)}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`,
    { provider: FRANKFURTER, timeoutMs: 9_000, retries: 1 },
  );
  if (!res.ok || !res.data) throw new ProviderError(`frankfurter: ${res.error ?? "unreachable"}`, FRANKFURTER);
  return Object.entries(res.data.rates)
    .map(([date, r]) => ({ date, rate: r[quote] }))
    .filter((x) => Number.isFinite(x.rate))
    .sort((a, b) => a.date.localeCompare(b.date));
}
