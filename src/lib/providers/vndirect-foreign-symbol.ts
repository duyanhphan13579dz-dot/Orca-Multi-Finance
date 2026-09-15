import "server-only";
import { httpJson } from "../http";

const VND = "vndirect";
const base = () =>
  (process.env.VNDIRECT_BASE_URL ?? "https://api-finfo.vndirect.com.vn").replace(/\/$/, "");

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://dstock.vndirect.com.vn",
  Referer: "https://dstock.vndirect.com.vn/",
};

export type VndSymbolForeignDay = {
  tradingDate: string;
  buyVal: number;
  sellVal: number;
  netVal: number;
  buyVol: number;
  sellVol: number;
  netVol: number;
  totalRoom: number | null;
  currentRoom: number | null;
  floor: string | null;
};

/** Dòng tiền khối ngoại theo mã — `/v4/foreigns?q=code:XXX` */
export async function getVndSymbolForeignFlow(
  symbol: string,
  size = 15,
): Promise<{ latest: VndSymbolForeignDay | null; history: VndSymbolForeignDay[]; sourceTs: number | null }> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return { latest: null, history: [], sourceTs: null };
  const res = await httpJson<{ data?: Record<string, unknown>[] }>(
    `${base()}/v4/foreigns?q=code:${sym}&size=${Math.min(size, 60)}&sort=tradingDate:desc`,
    { provider: VND, timeoutMs: 12_000, retries: 1, headers: HEADERS },
  );
  if (!res.ok || !res.data?.data?.length) {
    return { latest: null, history: [], sourceTs: null };
  }
  const history: VndSymbolForeignDay[] = [];
  let sourceTs: number | null = null;
  for (const r of res.data.data) {
    const tradingDate = String(r.tradingDate ?? "").slice(0, 10);
    if (!tradingDate) continue;
    const buyVal = Number(r.buyVal) || 0;
    const sellVal = Number(r.sellVal) || 0;
    const netVal = Number(r.netVal);
    const buyVol = Number(r.buyVol) || 0;
    const sellVol = Number(r.sellVol) || 0;
    const netVol = Number(r.netVol);
    const totalRoom = Number(r.totalRoom);
    const currentRoom = Number(r.currentRoom);
    const t = Date.parse(`${tradingDate}T15:00:00+07:00`);
    if (Number.isFinite(t) && (sourceTs == null || t > sourceTs)) sourceTs = t;
    history.push({
      tradingDate,
      buyVal,
      sellVal,
      netVal: Number.isFinite(netVal) ? netVal : buyVal - sellVal,
      buyVol,
      sellVol,
      netVol: Number.isFinite(netVol) ? netVol : buyVol - sellVol,
      totalRoom: Number.isFinite(totalRoom) ? totalRoom : null,
      currentRoom: Number.isFinite(currentRoom) ? currentRoom : null,
      floor: typeof r.floor === "string" ? r.floor : null,
    });
  }
  return { latest: history[0] ?? null, history, sourceTs };
}
