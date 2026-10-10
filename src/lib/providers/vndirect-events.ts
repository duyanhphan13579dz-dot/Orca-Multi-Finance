import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

/**
 * VNDirect DStock corporate events — public `/v4/events`.
 * Covers cash dividends, stock dividends, AGM, rights, etc.
 * Prefer locale=VN rows; de-dupe bilingual pairs by newsId+type+effectiveDate.
 */

export const VND_EVENTS = "vndirect-events";

const base = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
};

export type VndEventType =
  | "DIVIDEND"
  | "MEETING"
  | "meetingRight"
  | "STOCK_DIVIDEND"
  | "RIGHTS"
  | "OTHER"
  | string;

export type VndCorporateEvent = {
  id: string;
  code: string;
  type: VndEventType;
  typeDesc: string | null;
  note: string | null;
  /** Cash dividend amount in VND per share when type is DIVIDEND */
  dividend: number | null;
  /** Ratio % when provided by source (e.g. 4.5 = 4.5%) */
  ratio: number | null;
  divYear: number | null;
  disclosureDate: string | null;
  effectiveDate: string | null;
  expiredDate: string | null;
  actualDate: string | null;
  locale: string | null;
  newsId: number | null;
};

type RawEvent = Record<string, unknown>;

type Page = {
  data?: RawEvent[];
  totalElements?: number;
  totalPages?: number;
  size?: number;
  currentPage?: number;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function mapRow(r: RawEvent): VndCorporateEvent | null {
  const code = String(r.code ?? "").toUpperCase();
  if (!code) return null;
  const type = String(r.type ?? "OTHER");
  return {
    id: String(r.id ?? `${code}-${type}-${r.effectiveDate ?? ""}`),
    code,
    type,
    typeDesc: str(r.typeDesc),
    note: str(r.note),
    dividend: num(r.dividend),
    ratio: num(r.ratio),
    divYear: num(r.divYear),
    disclosureDate: str(r.disclosureDate)?.slice(0, 10) ?? null,
    effectiveDate: str(r.effectiveDate)?.slice(0, 10) ?? null,
    expiredDate: str(r.expiredDate)?.slice(0, 10) ?? null,
    actualDate: str(r.actualDate)?.slice(0, 10) ?? null,
    locale: str(r.locale),
    newsId: num(r.newsId),
  };
}

function dedupeKey(e: VndCorporateEvent): string {
  return [
    e.code,
    e.type,
    e.newsId ?? "",
    e.effectiveDate ?? "",
    e.dividend ?? "",
    e.divYear ?? "",
  ].join("|");
}

/** Prefer Vietnamese locale when bilingual duplicates exist. */
function preferLocale(a: VndCorporateEvent, b: VndCorporateEvent): VndCorporateEvent {
  if (a.locale === "VN" && b.locale !== "VN") return a;
  if (b.locale === "VN" && a.locale !== "VN") return b;
  return a;
}

export type VndEventsResult = {
  symbol: string;
  events: VndCorporateEvent[];
  dividends: VndCorporateEvent[];
  totalElements: number | null;
  sourceTs: number | null;
};

/**
 * Fetch corporate events for a symbol.
 * @param typeFilter optional — e.g. "DIVIDEND" to restrict server-side when supported
 */
export async function getVndCorporateEvents(
  symbol: string,
  opts?: { size?: number; type?: string },
): Promise<VndEventsResult> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) {
    return { symbol: "", events: [], dividends: [], totalElements: 0, sourceTs: null };
  }

  const size = Math.min(Math.max(opts?.size ?? 40, 1), 100);
  const qParts = [`code:${sym}`];
  if (opts?.type) qParts.push(`type:${opts.type}`);
  const q = qParts.join("~");
  const url =
    `${base()}/v4/events?q=${encodeURIComponent(q)}` +
    `&size=${size}&sort=effectiveDate:desc`;

  const res = await httpJson<Page>(url, {
    provider: VND_EVENTS,
    timeoutMs: 10_000,
    retries: 1,
    headers: HEADERS,
  });

  if (!res.ok) {
    throw new ProviderError(`vndirect-events: ${res.error ?? "http_error"}`, VND_EVENTS);
  }

  const raw = res.data?.data ?? [];
  const byKey = new Map<string, VndCorporateEvent>();
  let sourceTs: number | null = null;

  for (const row of raw) {
    const mapped = mapRow(row);
    if (!mapped) continue;
    const key = dedupeKey(mapped);
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferLocale(prev, mapped) : mapped);

    for (const d of [mapped.effectiveDate, mapped.disclosureDate, mapped.actualDate]) {
      if (!d) continue;
      const t = Date.parse(`${d}T15:00:00+07:00`);
      if (Number.isFinite(t) && (sourceTs == null || t > sourceTs)) sourceTs = t;
    }
  }

  const events = [...byKey.values()].sort((a, b) => {
    const da = a.effectiveDate ?? "";
    const db = b.effectiveDate ?? "";
    return db.localeCompare(da);
  });

  const dividends = events.filter(
    (e) =>
      e.type === "DIVIDEND" ||
      e.type === "STOCK_DIVIDEND" ||
      /cổ tức|dividend/i.test(e.typeDesc ?? ""),
  );

  return {
    symbol: sym,
    events,
    dividends,
    totalElements: res.data?.totalElements ?? events.length,
    sourceTs,
  };
}
