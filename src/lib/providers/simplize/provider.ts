import type { Candle, MarketIndex, Recommendation, StockProfile, StockQuote, VnDataResult } from "../vn-data-model";
import { unavailable } from "../vn-data-model";
import { SimplizeClient } from "./client";
import { getCapability, SIMPLIZE_DECISION } from "./capabilities";
import type { SimplizeEmbedDescriptor, VnDataType } from "./types";

/**
 * SimplizeProvider — implements the ORCA VnDataProvider contract for the
 * Simplize source. Verdict (Phase 12): OPTION_C_EMBED_ONLY.
 *
 * Every DATA getter returns UNAVAILABLE with an explicit rights reason, so:
 *  - the existing VNDirect pipeline is untouched (no data loss);
 *  - no mock/fake numbers ever leave this provider;
 *  - callers can safely try Simplize first (fail-fast) and fall back.
 * The only functional surface is `embed()` — the sanctioned visualization.
 */
export class SimplizeProvider {
  readonly id = "simplize" as const;
  readonly client: SimplizeClient;
  private readonly rightsReason = `Simplize không có official public API (api.simplize.vn = 404 verified; llms.txt/terms yêu cầu phê duyệt bằng văn bản cho API/dataset). Backend scraping/redistribution bị cấm (terms Điều 1 + robots 'không cho phép sử dụng thương mại'). ORCA giữ VNDirect; xem /api/v1/providers/vn cho capability matrix.`;

  constructor(client?: SimplizeClient) {
    this.client = client ?? new SimplizeClient();
  }

  get verdict() {
    return SIMPLIZE_DECISION.verdict;
  }

  capability(dataType: VnDataType) {
    return getCapability(dataType);
  }

  /* ------------------- DATA GETTERS — UNAVAILABLE BY DESIGN ------------------- */

  quote(_symbol: string): Promise<VnDataResult<StockQuote>> {
    return Promise.resolve(unavailable(this.rightsReason));
  }

  indices(): Promise<VnDataResult<MarketIndex[]>> {
    return Promise.resolve(unavailable(this.rightsReason));
  }

  candles(_symbol: string, _timeframe = "1d", _limit = 250): Promise<VnDataResult<Candle[]>> {
    return Promise.resolve(unavailable(this.rightsReason));
  }

  profile(_symbol: string): Promise<VnDataResult<StockProfile>> {
    return Promise.resolve(unavailable(this.rightsReason));
  }

  financials(_symbol: string): Promise<VnDataResult<Record<string, unknown>[]>> {
    return Promise.resolve(unavailable(this.rightsReason));
  }

  orderBook(_symbol: string): Promise<VnDataResult<never>> {
    // Phase 7 — Simplize hiển thị 5 mức bid/ask trên trang, nhưng page-only.
    // Tuyệt đối không fake depth. ORCA giữ VNDirect cho order book.
    return Promise.resolve(unavailable(`${this.rightsReason} Order book: trang Simplize có 5 mức bid/ask nhưng không phải API; không tạo dữ liệu giả.`));
  }

  recommendations(_symbol: string): Promise<VnDataResult<Recommendation[]>> {
    // Phase 8 — không tự quy đổi 'Đánh giá 360' của Simplize thành BUY/HOLD/SELL
    return Promise.resolve(unavailable(`${this.rightsReason} Khuyến nghị: 'Đánh giá 360' là scoring riêng của Simplize, không phải BROKER_RECOMMENDATION; không tự chuyển thành BUY/HOLD/SELL.`));
  }

  /* ---------------------------- EMBED (sanctioned) ---------------------------- */

  async embed(symbol: string, timeframe = "1Y"): Promise<{ ok: boolean; descriptor?: SimplizeEmbedDescriptor; reason?: string }> {
    const r = this.client.buildEmbedUrl(symbol, timeframe);
    if (!r.ok || !r.url) return { ok: false, reason: r.reason };
    const desc = await import("./adapter").then((m) => m.normalizeEmbedDescriptor(symbol, r.url!, timeframe));
    if (!desc) return { ok: false, reason: "descriptor không hợp lệ" };
    return { ok: true, descriptor: desc };
  }
}

/** singleton — one client per process (no per-request provider state) */
export const simplizeProvider = new SimplizeProvider();
