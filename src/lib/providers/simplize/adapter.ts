import type { SimplizeEmbedDescriptor } from "./types";
import { SIMPLIZE_PROVIDER } from "./types";

/**
 * SimplizeAdapter — PURE normalization/validation of the ONLY sanctioned
 * access surface (widget embed descriptor). No DOM parsing, no scraping.
 *
 * Page schemas are deliberately NOT mapped here: harvesting Simplize page
 * content into the ORCA model is exactly what terms/llms prohibit. When (and
 * only when) an official data API is granted in writing, this adapter is the
 * place to add normalizers — today it stays embed-only.
 */

export const EMBED_TIMEFRAMES = ["1D", "1W", "1M", "3M", "1Y", "5Y", "ALL"] as const;

export function normalizeEmbedDescriptor(
  symbol: string,
  url: string,
  timeframe = "1Y",
): SimplizeEmbedDescriptor | null {
  const clean = symbol.toUpperCase().trim();
  if (!/^[A-Z0-9]{1,10}$/.test(clean)) return null;
  const tf = timeframe.toUpperCase();
  if (!(EMBED_TIMEFRAMES as readonly string[]).includes(tf)) return null;
  try {
    const parsed = new URL(url);
    if (!/^https:$/.test(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return {
    kind: "stock-chart",
    symbol: clean,
    url,
    timeframe: tf,
    allowedUse: "embed-visualization",
    source: SIMPLIZE_PROVIDER,
    note: "Widget nhúng biểu đồ Simplize — chỉ dùng cho hiển thị (visualization); dữ liệu được Simplize render trực tiếp, ORCA không lưu/cache OHLC từ widget.",
  };
}

export function validateEmbedDescriptor(desc: SimplizeEmbedDescriptor): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (desc.kind !== "stock-chart") errors.push("kind phải là stock-chart");
  if (!/^[A-Z0-9]{1,10}$/.test(desc.symbol)) errors.push("symbol không hợp lệ");
  if (!desc.url.startsWith("https://")) errors.push("url phải là https");
  if (desc.allowedUse !== "embed-visualization") errors.push("only allowedUse: embed-visualization");
  if (desc.source !== "simplize") errors.push("source metadata phải là simplize");
  return { ok: errors.length === 0, errors };
}
