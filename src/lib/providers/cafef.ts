import "server-only";
import { httpJson } from "../http";
import { ProviderError } from "./binance";

export const CAFEF = "cafef";

export type CafefPropFlowSummary = {
  sessionDate: string;
  buyVal: number;
  sellVal: number;
  netVal: number;
  buyVol: number;
  sellVol: number;
  sourceTs: number | null;
};

function toCafefDate(iso: string): string {
  // yyyy-MM-dd → dd/MM/yyyy
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Market-wide proprietary (tự doanh) totals from CafeF EOD report.
 * Data published after session close; TradingReport holds market aggregates.
 */
export async function getCafefPropFlow(sessionDate: string): Promise<CafefPropFlowSummary> {
  const d = toCafefDate(sessionDate);
  const url =
    `https://cafef.vn/du-lieu/Ajax/PageNew/DataHistory/GDTuDoanh.ashx` +
    `?Symbol=ALL&StartDate=${encodeURIComponent(d)}&EndDate=${encodeURIComponent(d)}&PageIndex=1&PageSize=5`;

  const res = await httpJson<{
    Success?: boolean;
    Data?: {
      TradingReport?: {
        TongGtMua?: number;
        TongGtBan?: number;
        TongKlMua?: number;
        TongKlBan?: number;
      };
      DateIndex?: string;
    } | null;
  }>(url, {
    provider: CAFEF,
    timeoutMs: 12_000,
    retries: 1,
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; OrcaFinance/1.0)",
    },
  });

  if (!res.ok || res.data == null) {
    throw new ProviderError(`cafef prop: ${res.error ?? "unreachable"}`, CAFEF);
  }
  const tr = res.data.Data?.TradingReport;
  if (!tr) throw new ProviderError("cafef prop: empty TradingReport", CAFEF);

  const buyVal = Number(tr.TongGtMua) || 0;
  const sellVal = Number(tr.TongGtBan) || 0;
  if (buyVal === 0 && sellVal === 0) {
    throw new ProviderError("cafef prop: zero totals", CAFEF);
  }
  const ts = Date.parse(`${sessionDate}T15:00:00+07:00`);

  return {
    sessionDate,
    buyVal,
    sellVal,
    netVal: buyVal - sellVal,
    buyVol: Number(tr.TongKlMua) || 0,
    sellVol: Number(tr.TongKlBan) || 0,
    sourceTs: Number.isFinite(ts) ? ts : null,
  };
}
