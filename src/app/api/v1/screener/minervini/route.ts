import { badRequest } from "@/lib/envelope";
import { screenMinervini, type MinerviniScreenRow } from "@/lib/services/minervini-screener";
import { safeApi } from "@/lib/safe-api";
import { WORKERS_BUDGET } from "@/lib/data-engine/workers-budget";
import { readLatestMarketScan } from "@/lib/services/market-screener-snapshots";
import { getHot, putHot } from "@/lib/hot-snapshot";
import { buildMeta } from "@/lib/freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 25;

/** GET /api/v1/screener/minervini — Mark Minervini Trend Template */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolsRaw = url.searchParams.get("symbols");
  const symbols = symbolsRaw
    ? symbolsRaw
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined;
  const minPass = Number(url.searchParams.get("minPass") ?? "6");
  const onlyPassAll =
    url.searchParams.get("onlyPassAll") === "1" || url.searchParams.get("onlyPassAll") === "true";
  const minRs = Number(url.searchParams.get("minRs") ?? "0");
  const sector = url.searchParams.get("sector")?.trim() || undefined;
  const limit = Number(url.searchParams.get("limit") ?? "40");
  const defaultScan = !symbols?.length && !sector && minPass === 6 && minRs === 70 && !onlyPassAll && limit === 40 &&
    [...url.searchParams.keys()].every((key) => ["minPass", "minRs", "limit", "_"].includes(key));

  if (Number.isNaN(minPass) || minPass < 0 || minPass > 8) {
    return badRequest("minPass must be 0–8");
  }

  return safeApi({
    label: "screener-minervini",
    guard: { wallMs: WORKERS_BUDGET.techScreenWallMs, maxSubrequests: 24, maxConcurrent: 3 },
    produce: async () => {
      const fullMarket = !symbols?.length
        ? await readLatestMarketScan<MinerviniScreenRow>("minervini")
        : null;
      if (fullMarket) {
        const ranked = fullMarket.rows
          .map((row) => ({ row, ret: row.metrics.ret252 ?? row.metrics.ret126 }))
          .filter((item): item is { row: MinerviniScreenRow; ret: number } => item.ret != null && Number.isFinite(item.ret))
          .sort((a, b) => a.ret - b.ret || a.row.symbol.localeCompare(b.row.symbol));
        const rsMap = new Map<string, number>();
        if (ranked.length >= 3) {
          ranked.forEach(({ row }, index) => rsMap.set(row.symbol, Math.round((index / (ranked.length - 1)) * 100)));
        }
        const rows = fullMarket.rows.map((row) => {
          const rs = rsMap.get(row.symbol) ?? null;
          const criteria = { ...row.criteria, rsAtLeast70: rs != null && rs >= 70 };
          const passCount = row.passCount - (row.criteria.rsAtLeast70 ? 1 : 0) + (criteria.rsAtLeast70 ? 1 : 0);
          const notes = row.notes.filter((note) => note !== "Chưa xếp được RS proxy");
          if (rs == null) notes.push("Chưa xếp được RS proxy");
          return {
            ...row,
            criteria,
            passCount,
            passAll: passCount === 8,
            stage2: passCount === 8,
            metrics: { ...row.metrics, rsRating: rs },
            notes,
          };
        }).filter((row) => {
          if (onlyPassAll && !row.passAll) return false;
          if (row.passCount < Math.floor(minPass)) return false;
          const rs = row.metrics.rsRating;
          if (minRs > 0 && (rs == null || rs < minRs)) return false;
          if (sector && row.sector !== sector) return false;
          return true;
        }).sort((a, b) => b.passCount - a.passCount || (b.metrics.rsRating ?? 0) - (a.metrics.rsRating ?? 0) || (b.volume ?? 0) - (a.volume ?? 0));

        const response = {
          data: {
            rows: rows.slice(0, Number.isFinite(limit) ? Math.min(80, Math.max(1, limit)) : 40),
            scanned: fullMarket.scanned,
            skipped: fullMarket.skipped,
          },
          meta: buildMeta({
            source: "minervini-market-snapshot",
            cached: true,
            stale: fullMarket.ageMs > 24 * 60 * 60_000,
            partial: fullMarket.skipped > 0,
            note: `Minervini toàn thị trường · ${fullMarket.scanned} mã · cycle ${fullMarket.cycle} · RS xếp lại trên universe tổng hợp`,
          }),
        };
        if (defaultScan) putHot("screener-minervini", response.data, response.meta);
        return response;
      }

      const r = await screenMinervini({
        symbols,
        minPass: Math.min(8, Math.max(0, Math.floor(minPass))),
        onlyPassAll,
        minRs: Number.isFinite(minRs) ? minRs : 0,
        sector,
        limit: Number.isFinite(limit) ? Math.min(80, Math.max(1, limit)) : 40,
      });
      if (!r) return null;
      const response = {
        data: { rows: r.rows, scanned: r.scanned, skipped: r.skipped },
        meta: r.meta,
      };
      if (defaultScan) putHot("screener-minervini", response.data, response.meta);
      return response;
    },
    fallback: async () => {
      if (defaultScan) {
        const last = await getHot<{ rows: MinerviniScreenRow[]; scanned: number; skipped: number }>("screener-minervini");
        if (last) return {
          data: last.data,
          meta: buildMeta({
            source: "minervini-last-good",
            cached: true,
            partial: true,
            stale: true,
            note: "Phục vụ last-good Minervini snapshot trong khi OHLCV đang phục hồi",
          }),
        };
      }
      return {
        data: { rows: [] as MinerviniScreenRow[], scanned: 0, skipped: 0 },
        meta: buildMeta({
          source: "minervini-shell",
          partial: true,
          stale: true,
          note: "OHLCV tạm lỗi — thử lại sau",
        }),
      };
    },
    unavailableSource: "minervini-screener",
    unavailableNote: "Minervini screener tạm không khả dụng",
  });
}
