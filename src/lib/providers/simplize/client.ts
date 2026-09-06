import "server-only";
import { env } from "../../env";
import { httpText } from "../../http";
import { ProviderError } from "../binance";
import { SIMPLIZE_EVIDENCE, SIMPLIZE_PROVIDER } from "./types";

/**
 * SimplizeClient — access layer cho các phương thức ĐƯỢC CẤP PHÉP.
 *
 * QUY TẮC PHẦN CỨNG:
 *  - KHÔNG có method nào fetch /co-phieu/*, /chi-so/*, /chart, /news/*, /screener/*
 *    hay bất kỳ endpoint nội bộ nào (api.simplize.vn = 404 verified) để lấy dữ
 *    liệu. Việc đó vi phạm terms Điều 1 + llms.txt (cần phê duyệt bằng văn bản).
 *  - `probeWidgetTool()` chỉ gọi ĐÚNG 1 trang công khai được cấp phép để embed:
 *    /widget-embed — mục đích kiểm tra tính sẵn sàng (audit), không thu thập data.
 *  - `buildEmbedUrl()` trả URL nhúng từ template cấu hình; nếu template chưa được
 *    cung cấp/xác minh → trả null với lý do rõ ràng (KHÔNG hard-code URL chưa xác minh).
 */

export interface WidgetProbe {
  reachable: boolean;
  supportsStockChart: boolean;
  note: string;
  probedAt: string | null;
}

export interface EmbedUrlResult {
  ok: boolean;
  url: string | null;
  reason?: string;
}

export class SimplizeClient {
  constructor(
    private readonly baseUrl: string = env.simplizeBaseUrl,
    private readonly widgetUrlTemplate: string | undefined = env.simplizeWidgetUrlTemplate,
  ) {}

  get provider() {
    return SIMPLIZE_PROVIDER;
  }

  /** audit probe — sanctioned public embed page only (no data harvesting) */
  async probeWidgetTool(): Promise<WidgetProbe> {
    try {
      const res = await httpText(`${this.baseUrl.replace(/\/$/, "")}/widget-embed`, {
        provider: SIMPLIZE_PROVIDER,
        timeoutMs: 8_000,
        retries: 0,
      });
      const text = res.text ?? "";
      const supportsStockChart = /Mã giao dịch|Nhúng widget biểu đồ chứng khoán/i.test(text);
      return {
        reachable: res.ok,
        supportsStockChart,
        note: res.ok
          ? "Trang /widget-embed khả dụng — công cụ nhúng biểu đồ cổ phiếu miễn phí chính thức."
          : `Trang /widget-embed không khả dụng (${res.error ?? `http_${res.status}`})`,
        probedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        reachable: false,
        supportsStockChart: false,
        note: `Probe lỗi: ${e instanceof Error ? e.message : String(e)} — không kết luận được; widget chỉ là tùy chọn visualization.`,
        probedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Build the embed URL for a stock chart visualization.
   * Template (env SIMPLIZE_WIDGET_URL_TEMPLATE) must contain {symbol};
   * iff the literal iframe src is unverified (script-rendered generator),
   * we refuse to fabricate one — return {ok:false, reason}.
   */
  buildEmbedUrl(symbol: string, timeframe = "1Y"): EmbedUrlResult {
    const clean = symbol.toUpperCase().trim();
    if (!/^[A-Z0-9]{1,10}$/.test(clean)) {
      return { ok: false, url: null, reason: `symbol không hợp lệ cho widget: "${symbol}"` };
    }
    if (!this.widgetUrlTemplate || !this.widgetUrlTemplate.includes("{symbol}")) {
      return {
        ok: false,
        url: null,
        reason:
          "Template widget chưa được xác minh. Trang /widget-embed sinh iframe bằng script — literal src chưa thể xác nhận; vui lòng lấy mã nhúng từ trang đó hoặc cấu hình SIMPLIZE_WIDGET_URL_TEMPLATE (chứa {symbol}) sau khi Simplize xác nhận. Không hard-code URL chưa xác minh.",
      };
    }
    const url = this.widgetUrlTemplate
      .replace("{symbol}", encodeURIComponent(clean))
      .replace("{timeframe}", encodeURIComponent(timeframe));
    return { ok: true, url };
  }
}

/** thin guard so callers can still surface provider errors distinctly */
export function simplizeProviderError(message: string): ProviderError {
  return new ProviderError(`simplize: ${message}`, SIMPLIZE_PROVIDER);
}

export { SIMPLIZE_EVIDENCE };
