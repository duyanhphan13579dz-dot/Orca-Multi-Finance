import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import {
  getVndCorporateEvents,
  type VndEventsResult,
} from "../providers/vndirect-events";
import type { Meta } from "../types";

const TTL_MS = 30 * 60_000;
const STALE_MS = 6 * 60 * 60_000;

export async function getStockCorporateEvents(
  symbol: string,
  opts?: { size?: number; type?: string },
): Promise<{ data: VndEventsResult; meta: Meta } | null> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return null;
  try {
    const typeKey = opts?.type ?? "all";
    const size = opts?.size ?? 40;
    const result = await cached(`events:vnd:${sym}:${typeKey}:${size}:v1`, {
      ttlMs: TTL_MS,
      staleMs: STALE_MS,
      producer: async () => getVndCorporateEvents(sym, { size, type: opts?.type }),
    });
    const data = result.value;
    const meta = buildMeta({
      source: "vndirect-events",
      sourceTimestampMs: data.sourceTs,
      hasData: data.events.length > 0,
      cached: result.cached,
      stale: result.stale,
      note: "Sự kiện doanh nghiệp / cổ tức từ VNDirect DStock /v4/events (ưu tiên locale VN).",
      slas: {
        liveSlaMs: -1,
        freshSlaMs: TTL_MS,
        delayedSlaMs: STALE_MS,
      },
    });
    return { data, meta };
  } catch {
    return null;
  }
}
