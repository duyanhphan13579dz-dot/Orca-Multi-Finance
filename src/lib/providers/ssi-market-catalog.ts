import "server-only";
import { httpJson } from "../http";
import type { IndexQuote, OhlcvBar } from "../types";
import { ProviderError } from "./binance";
import {
  getSsiAccessToken,
  invalidateSsiToken,
  ssiFcConfigured,
  ssiToday,
  SSI_FCDATA,
} from "./ssi-fcdata";

/**
 * SSI FastConnect — endpoints bổ sung theo danh mục Market Data.
 * Spec: https://guide.ssi.com.vn/ssi-products/fastconnect-data/api-specs
 * Credentials: SSI_API_KEY + SSI_API_SECRET (đã alias qua ssi-credentials).
 */

const DEFAULT_BASE = "https://fc-data.ssi.com.vn";
function baseUrl(): string {
  return (process.env.SSI_FC_DATA_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function formatSsiDate(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

function parseSsiDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const m = String(d).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const t = Date.parse(d);
    return Number.isFinite(t) ? t : null;
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const t = Date.parse(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T15:00:00+07:00`,
  );
  return Number.isFinite(t) ? t : null;
}

type SsiEnvelope<T> = {
  status?: number | string;
  message?: string;
  totalRecord?: number;
  data?: T;
};

async function ssiGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  timeoutMs = 14_000,
): Promise<T> {
  const token = await getSsiAccessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${baseUrl()}${path}${qs.toString() ? `?${qs}` : ""}`;
  const res = await httpJson<T>(url, {
    provider: SSI_FCDATA,
    timeoutMs,
    retries: 0,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok && (res.status === 401 || String(res.error).includes("401"))) {
    invalidateSsiToken();
    const token2 = await getSsiAccessToken();
    const res2 = await httpJson<T>(url, {
      provider: SSI_FCDATA,
      timeoutMs,
      retries: 0,
      headers: { Accept: "application/json", Authorization: `Bearer ${token2}` },
    });
    if (!res2.ok || res2.data == null) {
      throw new ProviderError(`ssi-fcdata: ${res2.error ?? "unauthorized"}`, SSI_FCDATA);
    }
    return res2.data;
  }
  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-fcdata: ${res.error ?? "unreachable"}`, SSI_FCDATA);
  }
  return res.data;
}

export type SsiSecurityDetail = {
  symbol: string;
  nameVi: string | null;
  nameEn: string | null;
  exchange: string | null;
  secType: string | null;
  isin: string | null;
  lotSize: number | null;
  listedShares: number | null;
  underlying: string | null;
  exercisePrice: number | null;
  exerciseRatio: string | null;
  firstTradingDate: string | null;
  lastTradingDate: string | null;
  maturityDate: string | null;
  issuer: string | null;
};

type SecuritiesDetailsRow = {
  Symbol?: string;
  symbol?: string;
  SymbolName?: string;
  SymbolEngName?: string;
  SecType?: string;
  Exchange?: string;
  Isin?: string;
  LotSize?: string | number;
  ListedShare?: string | number;
  Underlying?: string;
  ExercisePrice?: string | number;
  ExcerciseRatio?: string;
  ExerciseRatio?: string;
  FirstTradingDate?: string;
  LastTradingDate?: string;
  MaturityDate?: string;
  Issuer?: string;
  repeatedinfoList?: SecuritiesDetailsRow[];
  RepeatedInfo?: SecuritiesDetailsRow[];
};

function mapSecurityDetail(r: SecuritiesDetailsRow): SsiSecurityDetail | null {
  const symbol = String(r.Symbol ?? r.symbol ?? "").toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    nameVi: r.SymbolName ?? null,
    nameEn: r.SymbolEngName ?? null,
    exchange: r.Exchange ? String(r.Exchange).toUpperCase() : null,
    secType: r.SecType ?? null,
    isin: r.Isin ?? null,
    lotSize: num(r.LotSize),
    listedShares: num(r.ListedShare),
    underlying: r.Underlying ?? null,
    exercisePrice: num(r.ExercisePrice),
    exerciseRatio: r.ExcerciseRatio ?? r.ExerciseRatio ?? null,
    firstTradingDate: r.FirstTradingDate ?? null,
    lastTradingDate: r.LastTradingDate ?? null,
    maturityDate: r.MaturityDate ?? null,
    issuer: r.Issuer ?? null,
  };
}

/** SecuritiesDetails — thông tin CK (lô, niêm yết, CW, …). */
export async function getSsiSecuritiesDetails(opts?: {
  symbol?: string;
  market?: string;
  pageIndex?: number;
  pageSize?: number;
}): Promise<SsiSecurityDetail[]> {
  const body = await ssiGet<
    SsiEnvelope<SecuritiesDetailsRow[] | { repeatedinfoList?: SecuritiesDetailsRow[] }>
  >("/api/v2/Market/SecuritiesDetails", {
    Market: opts?.market,
    market: opts?.market,
    Symbol: opts?.symbol?.toUpperCase(),
    symbol: opts?.symbol?.toUpperCase(),
    PageIndex: opts?.pageIndex ?? 1,
    pageIndex: opts?.pageIndex ?? 1,
    PageSize: opts?.pageSize ?? 100,
    pageSize: opts?.pageSize ?? 100,
  });
  let rows: SecuritiesDetailsRow[] = [];
  if (Array.isArray(body.data)) {
    rows = body.data;
    const nested = rows.flatMap((r) => r.repeatedinfoList ?? r.RepeatedInfo ?? []);
    if (nested.length) rows = nested;
  } else if (body.data && typeof body.data === "object") {
    const d = body.data as {
      repeatedinfoList?: SecuritiesDetailsRow[];
      RepeatedInfo?: SecuritiesDetailsRow[];
    };
    rows = d.repeatedinfoList ?? d.RepeatedInfo ?? [];
  }
  const out = rows.map(mapSecurityDetail).filter((x): x is SsiSecurityDetail => x != null);
  if (!out.length && opts?.symbol) {
    throw new ProviderError(`ssi-fcdata: empty SecuritiesDetails for ${opts.symbol}`, SSI_FCDATA);
  }
  return out;
}

export type SsiIndexMeta = { code: string; name: string | null; exchange: string | null };

/** IndexList */
export async function getSsiIndexList(
  exchange: "HOSE" | "HNX" | "UPCOM" = "HOSE",
): Promise<SsiIndexMeta[]> {
  const out: SsiIndexMeta[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = await ssiGet<
      SsiEnvelope<{ IndexCode?: string; IndexName?: string; Exchange?: string }[]>
    >("/api/v2/Market/IndexList", {
      Exchange: exchange,
      exchange,
      PageIndex: page,
      pageIndex: page,
      PageSize: 1000,
      pageSize: 1000,
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      const code = String(r.IndexCode ?? "").toUpperCase();
      if (!code) continue;
      out.push({
        code,
        name: r.IndexName ?? null,
        exchange: r.Exchange ? String(r.Exchange).toUpperCase() : exchange,
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

/** IndexComponents */
export async function getSsiIndexComponents(indexCode: string): Promise<{
  indexCode: string;
  indexName: string | null;
  exchange: string | null;
  symbols: string[];
}> {
  const code = indexCode.toUpperCase();
  const symbols: string[] = [];
  let indexName: string | null = null;
  let exchange: string | null = null;
  const body = await ssiGet<
    SsiEnvelope<
      {
        IndexCode?: string;
        IndexName?: string;
        Exchange?: string;
        IndexComponent?: { StockSymbol?: string }[];
        indexComponent?: { StockSymbol?: string }[];
      }[]
    >
  >("/api/v2/Market/IndexComponents", {
    IndexCode: code,
    indexCode: code,
    PageIndex: 1,
    pageIndex: 1,
    PageSize: 1000,
    pageSize: 1000,
  });
  const rows = Array.isArray(body.data) ? body.data : [];
  for (const r of rows) {
    indexName = indexName ?? r.IndexName ?? null;
    exchange = exchange ?? (r.Exchange ? String(r.Exchange).toUpperCase() : null);
    for (const c of r.IndexComponent ?? r.indexComponent ?? []) {
      const s = String(c.StockSymbol ?? "").toUpperCase();
      if (s) symbols.push(s);
    }
  }
  return { indexCode: code, indexName, exchange, symbols: [...new Set(symbols)] };
}

type OhlcRow = {
  Symbol?: string;
  TradingDate?: string;
  Time?: string | null;
  Open?: string | number;
  High?: string | number;
  Low?: string | number;
  Close?: string | number;
  Volume?: string | number;
  Value?: string | number;
};

/** IntradayOhlc — resolution phút: 1, 3, 5, 15, 30, 60 */
export async function getSsiIntradayOhlc(
  symbol: string,
  opts?: {
    fromDate?: string;
    toDate?: string;
    resolution?: number;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<OhlcvBar[]> {
  const sym = symbol.toUpperCase();
  const fromDate = opts?.fromDate ?? formatSsiDate();
  const toDate = opts?.toDate ?? formatSsiDate();
  const resolution = opts?.resolution ?? 1;
  const pageSize = opts?.pageSize ?? 1000;
  const maxPages = opts?.maxPages ?? 10;
  const bars: OhlcvBar[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const body = await ssiGet<SsiEnvelope<OhlcRow[]>>("/api/v2/Market/IntradayOhlc", {
      Symbol: sym,
      symbol: sym,
      FromDate: fromDate,
      fromDate,
      ToDate: toDate,
      toDate,
      PageIndex: page,
      pageIndex: page,
      PageSize: pageSize,
      pageSize,
      Ascending: true,
      ascending: true,
      Resolution: resolution,
      resolution,
      resollution: resolution,
    });
    const rows = Array.isArray(body.data) ? body.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      const datePart = r.TradingDate ?? null;
      const timePart = r.Time ? String(r.Time) : null;
      let t: number | null = null;
      if (datePart && timePart) {
        const m = String(datePart).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          const day = Number(m[1]);
          const month = Number(m[2]);
          const year = Number(m[3]);
          const tm = String(timePart).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
          const hh = tm ? Number(tm[1]) : 0;
          const mm = tm ? Number(tm[2]) : 0;
          const ss = tm && tm[3] ? Number(tm[3]) : 0;
          t = Date.parse(
            `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}+07:00`,
          );
          if (!Number.isFinite(t)) t = null;
        }
      }
      if (t == null) t = parseSsiDate(datePart);
      const o = num(r.Open);
      const h = num(r.High);
      const l = num(r.Low);
      const c = num(r.Close);
      if (t == null || o == null || h == null || l == null || c == null) continue;
      bars.push({ time: t, open: o, high: h, low: l, close: c, volume: num(r.Volume) ?? 0 });
    }
    if (rows.length < pageSize) break;
  }
  bars.sort((a, b) => a.time - b.time);
  if (!bars.length) throw new ProviderError(`ssi-fcdata: empty IntradayOhlc for ${sym}`, SSI_FCDATA);
  return bars;
}

export type SsiIndexSummary = IndexQuote & {
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  ceiling: number | null;
  floor: number | null;
  totalTrade: number | null;
  totalMatchValue: number | null;
  totalDealVol: number | null;
  totalDealVal: number | null;
  tradingSession: string | null;
  exchange: string | null;
};

type DailyIndexRow = {
  IndexCode?: string;
  Indexcode?: string;
  IndexName?: string;
  IndexValue?: string | number;
  Change?: string | number;
  RatioChange?: string | number;
  Totalmatchvol?: string | number;
  Totalvol?: string | number;
  TotalQtty?: string | number;
  TotalTrade?: string | number;
  Totalmatchval?: string | number;
  Totalval?: string | number;
  Advances?: string | number;
  Nochanges?: string | number;
  Declines?: string | number;
  Ceiling?: string | number;
  Floor?: string | number;
  Totaldealvol?: string | number;
  Totaldealval?: string | number;
  TradingSession?: string;
  Market?: string;
  Exchange?: string;
  TradingDate?: string;
  "Trading Date"?: string;
};

/** Index Summary (DailyIndex + breadth). */
export async function getSsiIndexHistory(
  indexId: string,
  opts?: { fromDate?: string; toDate?: string; pageSize?: number },
): Promise<{ time: number; open: number; high: number; low: number; close: number; volume?: number }[]> {
  const code = indexId.toUpperCase();
  const fromDate = opts?.fromDate ?? formatSsiDate(new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000));
  const toDate = opts?.toDate ?? formatSsiDate();
  const body = await ssiGet<SsiEnvelope<DailyIndexRow[]>>("/api/v2/Market/DailyIndex", {
    IndexId: code, indexId: code, FromDate: fromDate, fromDate, ToDate: toDate, toDate,
    PageIndex: 1, pageIndex: 1, PageSize: opts?.pageSize ?? 2000, pageSize: opts?.pageSize ?? 2000,
    Ascending: true, ascending: true,
  });
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.flatMap((row) => {
    const close = num(row.IndexValue);
    const rawDate = row.TradingDate ?? row["Trading Date"];
    const dateText = rawDate ? String(rawDate).trim() : "";
    const dateMatch = dateText.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    const isoDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}` : dateText;
    const time = isoDate ? Date.parse(`${isoDate}T15:00:00+07:00`) : NaN;
    if (close == null || !Number.isFinite(time)) return [];
    const previous = num(row.Change) != null ? close - (num(row.Change) ?? 0) : close;
    return [{ time, open: previous, high: Math.max(previous, close), low: Math.min(previous, close), close, volume: num(row.Totalmatchvol) ?? num(row.Totalvol) ?? undefined }];
  });
}

/** Index Summary (DailyIndex + breadth). */
export async function getSsiIndexSummary(
  indexId: string,
  opts?: { fromDate?: string; toDate?: string },
): Promise<SsiIndexSummary> {
  const code = indexId.toUpperCase();
  const fromDate = opts?.fromDate ?? formatSsiDate();
  const toDate = opts?.toDate ?? formatSsiDate();
  const body = await ssiGet<SsiEnvelope<DailyIndexRow[]>>("/api/v2/Market/DailyIndex", {
    IndexId: code,
    indexId: code,
    FromDate: fromDate,
    fromDate,
    ToDate: toDate,
    toDate,
    PageIndex: 1,
    pageIndex: 1,
    PageSize: 5,
    pageSize: 5,
    Ascending: false,
    ascending: false,
  });
  const rows = Array.isArray(body.data) ? body.data : [];
  const r = rows[0];
  if (!r) throw new ProviderError(`ssi-fcdata: empty DailyIndex summary for ${code}`, SSI_FCDATA);
  const value = num(r.IndexValue);
  if (value == null) throw new ProviderError(`ssi-fcdata: invalid IndexValue for ${code}`, SSI_FCDATA);
  const updated = r.TradingDate ?? r["Trading Date"] ?? toDate;
  return {
    code: String(r.IndexCode ?? r.Indexcode ?? code).toUpperCase(),
    name: r.IndexName ?? code,
    value,
    change: num(r.Change) ?? 0,
    changePercent: num(r.RatioChange) ?? 0,
    volume: num(r.Totalmatchvol) ?? num(r.Totalvol) ?? num(r.TotalQtty),
    updatedAt: updated,
    advances: num(r.Advances),
    declines: num(r.Declines),
    unchanged: num(r.Nochanges),
    ceiling: num(r.Ceiling),
    floor: num(r.Floor),
    totalTrade: num(r.TotalTrade),
    totalMatchValue: num(r.Totalmatchval) ?? num(r.Totalval),
    totalDealVol: num(r.Totaldealvol),
    totalDealVal: num(r.Totaldealval),
    tradingSession: r.TradingSession ?? null,
    exchange: r.Exchange
      ? String(r.Exchange).toUpperCase()
      : r.Market
        ? String(r.Market).toUpperCase()
        : null,
  };
}

export type SsiStockSummary = {
  symbol: string;
  tradingDate: string | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  average: number | null;
  change: number | null;
  changePercent: number | null;
  ceiling: number | null;
  floor: number | null;
  ref: number | null;
  totalMatchVol: number | null;
  totalMatchVal: number | null;
  totalDealVol: number | null;
  totalDealVal: number | null;
  foreignBuyVol: number | null;
  foreignSellVol: number | null;
  foreignBuyVal: number | null;
  foreignSellVal: number | null;
  foreignRoom: number | null;
  netForeignVol: number | null;
  netForeignVal: number | null;
  totalBuyTrade: number | null;
  totalSellTrade: number | null;
  totalBuyTradeVol: number | null;
  totalSellTradeVol: number | null;
};

/** Securities Summary — DailyStockPrice enriched (NN, deal, buy/sell). */
export async function getSsiStockSummary(
  symbol: string,
  opts?: { fromDate?: string; toDate?: string; market?: string },
): Promise<SsiStockSummary> {
  const sym = symbol.toUpperCase();
  const fromDate = opts?.fromDate ?? formatSsiDate();
  const toDate = opts?.toDate ?? formatSsiDate();
  const body = await ssiGet<
    SsiEnvelope<
      {
        TradingDate?: string;
        Tradingdate?: string;
        Symbol?: string;
        Price?: string | number;
        OpenPrice?: string | number;
        Openprice?: string | number;
        HighestPrice?: string | number;
        Highestprice?: string | number;
        LowestPrice?: string | number;
        Lowestprice?: string | number;
        ClosePrice?: string | number;
        Closeprice?: string | number;
        AveragePrice?: string | number;
        TotalVol?: string | number;
        Totalmatchvol?: string | number;
        TotalVal?: string | number;
        Totalmatchval?: string | number;
        Change?: string | number;
        Pricechange?: string | number;
        PerChange?: string | number;
        Perpricechange?: string | number;
        CeilingPrice?: string | number;
        Ceilingprice?: string | number;
        FloorPrice?: string | number;
        Floorprice?: string | number;
        RefPrice?: string | number;
        Refprice?: string | number;
        BasicPrice?: string | number;
        Foreignbuyvoltotal?: string | number;
        Foreignsellvoltotal?: string | number;
        Foreignbuyvaltotal?: string | number;
        Foreignsellvaltotal?: string | number;
        Toreignsellvaltotal?: string | number;
        Foreigncurrentroom?: string | number;
        Netforeivol?: string | number;
        Netforeignval?: string | number;
        Totaldealvol?: string | number;
        Totaldealval?: string | number;
        Totalbuytrade?: string | number;
        Totalselltrade?: string | number;
        Totalbuytradevol?: string | number;
        Totalselltradevol?: string | number;
      }[]
    >
  >("/api/v2/Market/DailyStockPrice", {
    Symbol: sym,
    symbol: sym,
    FromDate: fromDate,
    fromDate,
    ToDate: toDate,
    toDate,
    PageIndex: 1,
    pageIndex: 1,
    PageSize: 5,
    pageSize: 5,
    Market: opts?.market,
    market: opts?.market,
  });
  const rows = Array.isArray(body.data) ? body.data : [];
  const r = rows[0];
  if (!r) throw new ProviderError(`ssi-fcdata: empty stock summary for ${sym}`, SSI_FCDATA);
  return {
    symbol: String(r.Symbol ?? sym).toUpperCase(),
    tradingDate: r.TradingDate ?? r.Tradingdate ?? null,
    close: num(r.ClosePrice) ?? num(r.Closeprice) ?? num(r.Price),
    open: num(r.OpenPrice) ?? num(r.Openprice),
    high: num(r.HighestPrice) ?? num(r.Highestprice),
    low: num(r.LowestPrice) ?? num(r.Lowestprice),
    average: num(r.AveragePrice),
    change: num(r.Change) ?? num(r.Pricechange),
    changePercent: num(r.PerChange) ?? num(r.Perpricechange),
    ceiling: num(r.CeilingPrice) ?? num(r.Ceilingprice),
    floor: num(r.FloorPrice) ?? num(r.Floorprice),
    ref: num(r.RefPrice) ?? num(r.Refprice) ?? num(r.BasicPrice),
    totalMatchVol: num(r.TotalVol) ?? num(r.Totalmatchvol),
    totalMatchVal: num(r.TotalVal) ?? num(r.Totalmatchval),
    totalDealVol: num(r.Totaldealvol),
    totalDealVal: num(r.Totaldealval),
    foreignBuyVol: num(r.Foreignbuyvoltotal),
    foreignSellVol: num(r.Foreignsellvoltotal),
    foreignBuyVal: num(r.Foreignbuyvaltotal),
    foreignSellVal: num(r.Foreignsellvaltotal) ?? num(r.Toreignsellvaltotal),
    foreignRoom: num(r.Foreigncurrentroom),
    netForeignVol: num(r.Netforeivol),
    netForeignVal: num(r.Netforeignval),
    totalBuyTrade: num(r.Totalbuytrade),
    totalSellTrade: num(r.Totalselltrade),
    totalBuyTradeVol: num(r.Totalbuytradevol),
    totalSellTradeVol: num(r.Totalselltradevol),
  };
}

export async function getSsiMarketDataCatalog(): Promise<{
  configured: boolean;
  endpoints: { name: string; path: string; implemented: boolean }[];
}> {
  return {
    configured: ssiFcConfigured(),
    endpoints: [
      { name: "AccessToken", path: "/api/v2/Market/AccessToken", implemented: true },
      { name: "Securities", path: "/api/v2/Market/Securities", implemented: true },
      { name: "SecuritiesDetails", path: "/api/v2/Market/SecuritiesDetails", implemented: true },
      { name: "IndexList", path: "/api/v2/Market/IndexList", implemented: true },
      { name: "IndexComponents", path: "/api/v2/Market/IndexComponents", implemented: true },
      { name: "DailyOhlc", path: "/api/v2/Market/DailyOhlc", implemented: true },
      { name: "IntradayOhlc", path: "/api/v2/Market/IntradayOhlc", implemented: true },
      { name: "DailyIndex", path: "/api/v2/Market/DailyIndex", implemented: true },
      { name: "DailyStockPrice", path: "/api/v2/Market/DailyStockPrice", implemented: true },
      { name: "Realtime WS STOCK/INDEX", path: "wss://fc-datahub.ssi.com.vn", implemented: true },
    ],
  };
}

export { ssiFcConfigured, ssiToday };
