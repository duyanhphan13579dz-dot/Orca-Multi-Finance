import "server-only";
import type { Quote } from "../types";
import * as vndirect from "../providers/vndirect";
import { getVpsQuotes } from "../providers/vps";
import { getVietcapQuotes } from "../providers/vietcap";
import { getSsiIboardQuotes } from "../providers/ssi-iboard";
import { getSsiQuotes, ssiFcConfigured } from "../providers/ssi-fcdata";

export type MultiQuoteResult = {
  quotes: Quote[];
  sources: string[];
  sourceTs: number | null;
};

/**
 * Kéo quote đa nguồn: VNDirect → VPS → SSI iBoard → SSI FC → Vietcap.
 * Merge theo symbol; nguồn đầu tiên có giá thắng, các field null được điền từ nguồn sau.
 */
export async function getMultiQuotes(symbols: string[]): Promise<MultiQuoteResult> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 40);
  if (!uniq.length) return { quotes: [], sources: [], sourceTs: null };

  const sources: string[] = [];
  const bySym = new Map<string, Quote>();

  const merge = (list: Quote[], src: string) => {
    if (!list.length) return;
    sources.push(src);
    for (const q of list) {
      const prev = bySym.get(q.symbol);
      if (!prev) {
        bySym.set(q.symbol, q);
        continue;
      }
      // fill missing fields
      bySym.set(q.symbol, {
        ...q,
        ...prev,
        price: prev.price ?? q.price,
        change: prev.change ?? q.change,
        changePercent: prev.changePercent ?? q.changePercent,
        open: prev.open ?? q.open,
        high: prev.high ?? q.high,
        low: prev.low ?? q.low,
        volume: prev.volume ?? q.volume,
        quoteVolume: prev.quoteVolume ?? q.quoteVolume,
        referencePrice: prev.referencePrice ?? q.referencePrice,
        ceilingPrice: prev.ceilingPrice ?? q.ceilingPrice,
        floorPrice: prev.floorPrice ?? q.floorPrice,
        name: prev.name ?? q.name,
      });
    }
  };

  const tasks: Promise<void>[] = [
    vndirect
      .getVndQuotes(uniq)
      .then((r) => merge(r.quotes, "vndirect"))
      .catch(() => undefined),
    getVpsQuotes(uniq)
      .then((r) => merge(r.quotes, "vps"))
      .catch(() => undefined),
    getSsiIboardQuotes(uniq)
      .then((r) => merge(r.quotes, "ssi-iboard"))
      .catch(() => undefined),
    getVietcapQuotes(uniq)
      .then((r) => merge(r.quotes, "vietcap"))
      .catch(() => undefined),
  ];

  if (ssiFcConfigured()) {
    tasks.push(
      getSsiQuotes(uniq)
        .then((r) => merge(r.quotes, "ssi-fcdata"))
        .catch(() => undefined),
    );
  }

  await Promise.all(tasks);

  return {
    quotes: [...bySym.values()],
    sources: [...new Set(sources)],
    sourceTs: bySym.size ? Date.now() : null,
  };
}
