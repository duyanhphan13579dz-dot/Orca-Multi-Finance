import "server-only";
import type { NewsArticle } from "../types";
import type { MarketSnapshot } from "./market";
import {
  hubNews,
  hubCommodityMarket,
  hubForexDetail,
  hubPrefetch,
  runInDataHub,
} from "../data-engine/hub";
import { mergeNewsArticles } from "./report-data";

/**
 * Report ↔ Data Hub pipeline
 *
 * Bản tin hằng ngày lấy dữ liệu qua cùng hub với journal / portfolio / agent:
 * singleflight + request-scope cache. Prefetch: tin, hàng hóa, forex majors.
 */

const FOREX_MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCNH"] as const;

export type ReportHubPack = {
  news: NewsArticle[];
  commodities: NonNullable<MarketSnapshot["commodities"]>;
  forexRows: NonNullable<NonNullable<MarketSnapshot["forex"]>["rows"]>;
  usdStrengthNote: string | undefined;
  sourcesLive: number;
  sourcesTotal: number;
  hubNote: string;
  ms: number;
};

function normalizeNews(raw: unknown): NewsArticle[] {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items as unknown[])
      : Array.isArray((raw as { articles?: unknown }).articles)
        ? ((raw as { articles: unknown[] }).articles as unknown[])
        : [];
  return list.filter((n) => n && typeof n === "object") as NewsArticle[];
}

function normalizeCommodities(raw: unknown): NonNullable<MarketSnapshot["commodities"]> {
  if (!raw || typeof raw !== "object") return [];
  const items =
    (raw as { items?: unknown[] }).items ?? (Array.isArray(raw) ? (raw as unknown[]) : []);
  const out: NonNullable<MarketSnapshot["commodities"]> = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const row = it as Record<string, unknown>;
    const def = (row.def as Record<string, unknown> | undefined) ?? row;
    const quote = (row.quote as Record<string, unknown> | undefined) ?? row;
    const symbol = String(def.symbol ?? def.id ?? quote.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const price =
      typeof quote.price === "number"
        ? quote.price
        : typeof quote.last === "number"
          ? quote.last
          : null;
    const changePercent =
      typeof quote.changePercent === "number"
        ? quote.changePercent
        : typeof quote.changePct === "number"
          ? quote.changePct
          : null;
    out.push({
      symbol,
      name: String(def.name ?? def.label ?? symbol),
      price: price ?? undefined,
      changePercent,
    });
  }
  return out;
}

async function loadForexViaHub(): Promise<{
  rows: NonNullable<NonNullable<MarketSnapshot["forex"]>["rows"]>;
  note?: string;
}> {
  const settled = await Promise.allSettled(FOREX_MAJORS.map((p) => hubForexDetail(p)));
  const rows: NonNullable<NonNullable<MarketSnapshot["forex"]>["rows"]> = [];
  for (let i = 0; i < FOREX_MAJORS.length; i++) {
    const r = settled[i];
    if (r.status !== "fulfilled" || !r.value) continue;
    const v = r.value as Record<string, unknown>;
    const rate =
      typeof v.rate === "number" ? v.rate : typeof v.price === "number" ? v.price : null;
    if (rate == null || !Number.isFinite(rate)) continue;
    const ch =
      typeof v.changePercent === "number"
        ? v.changePercent
        : typeof v.changePct === "number"
          ? v.changePct
          : null;
    rows.push({
      pair: FOREX_MAJORS[i],
      symbol: FOREX_MAJORS[i],
      price: rate,
      changePercent: ch,
      group: "major",
    });
  }
  if (!rows.length) return { rows: [] };
  const usdUp = rows.filter((x) => x.pair?.startsWith("USD") && (x.changePercent ?? 0) > 0).length;
  const usdDown = rows.filter((x) => x.pair?.startsWith("USD") && (x.changePercent ?? 0) < 0).length;
  const note =
    usdUp + usdDown > 0
      ? `USD majors (hub): ${usdUp} tăng / ${usdDown} giảm — theo dõi DXY/USDVND.`
      : `Majors hub: ${rows.slice(0, 3).map((x) => x.pair).join(", ")}.`;
  return { rows, note };
}

export async function loadReportHubPack(): Promise<ReportHubPack> {
  const t0 = performance.now();
  return runInDataHub(async () => {
    await hubPrefetch({ commodity: true }).catch(() => null);

    const [newsRes, commodityRes, forexRes] = await Promise.all([
      hubNews({ limit: 24 }).catch(() => null),
      hubCommodityMarket("all").catch(() => null),
      loadForexViaHub().catch(() => ({
        rows: [] as ReportHubPack["forexRows"],
        note: undefined as string | undefined,
      })),
    ]);

    const news = normalizeNews(newsRes);
    const commodities = normalizeCommodities(commodityRes);
    const forexRows = forexRes.rows ?? [];
    const usdStrengthNote = forexRes.note;

    const sourcesLive =
      (news.length ? 1 : 0) + (commodities.length ? 1 : 0) + (forexRows.length ? 1 : 0);
    const sourcesTotal = 3;
    const ms = Math.round(performance.now() - t0);

    return {
      news,
      commodities,
      forexRows,
      usdStrengthNote,
      sourcesLive,
      sourcesTotal,
      hubNote: `data-hub · tin ${news.length} · HH ${commodities.length} · FX ${forexRows.length} · ${ms}ms`,
      ms,
    };
  });
}

export function mergeSnapshotWithHub(
  snap: MarketSnapshot,
  pack: ReportHubPack,
): MarketSnapshot {
  const news = mergeNewsArticles(
    pack.news as NewsArticle[],
    (snap.news as NewsArticle[] | undefined) ?? [],
  ).slice(0, 30);

  const commodities =
    pack.commodities.length > 0 ? pack.commodities : snap.commodities ?? [];

  let forex = snap.forex;
  if (pack.forexRows.length) {
    forex = {
      rows: pack.forexRows,
      usdStrengthNote: pack.usdStrengthNote ?? snap.forex?.usdStrengthNote,
    };
  } else if (pack.usdStrengthNote && snap.forex) {
    forex = { ...snap.forex, usdStrengthNote: pack.usdStrengthNote };
  }

  return {
    ...snap,
    news: news.length ? news : snap.news,
    commodities: commodities.length ? commodities : snap.commodities,
    forex,
  };
}
