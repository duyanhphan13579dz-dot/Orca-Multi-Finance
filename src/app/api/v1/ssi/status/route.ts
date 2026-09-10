import { ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import {
  probeSsiFastConnect,
  ssiBase,
  ssiFastConfigured,
} from "@/lib/providers/ssi-fastconnect";
import {
  ssiTradingConfigured,
  ssiTradingEnabled,
  ssiTradingSignConfigured,
} from "@/lib/providers/ssi-trading";
import { ssiFcStream } from "@/lib/realtime/ssi-fc-stream";
import { ssiFcConfigured, probeSsiFcData } from "@/lib/providers/ssi-fcdata";
import { ssiWs } from "@/lib/realtime/ssi-ws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ssi/status — tình trạng kết nối SSI FastConnect (v3 + legacy).
 * Không trả secret — chỉ trạng thái cấu hình & health.
 */
export async function GET() {
  const wsDisabled = process.env.SSI_WS_DISABLED === "true";
  const v3Configured = ssiFastConfigured();
  const legacyConfigured = ssiFcConfigured();

  const [v3Probe, legacyProbe] = await Promise.all([
    v3Configured ? probeSsiFastConnect() : null,
    !v3Configured && legacyConfigured ? probeSsiFcData() : null,
  ]);

  const data = {
    docs: "https://developers.ssi.com.vn/docs/api-reference",
    apiBase: ssiBase(),
    wsEnabled: !wsDisabled,
    fastconnectV3: {
      configured: v3Configured,
      auth: v3Probe ?? { configured: false, ok: false, message: "Chưa set SSI_API_KEY / SSI_API_SECRET" },
      streaming: ssiFcStream.getStats(),
      trading: {
        configured: ssiTradingConfigured(),
        privateKeyConfigured: ssiTradingSignConfigured(),
        orderMutationEnabled: ssiTradingEnabled(),
        note: ssiTradingEnabled()
          ? "Đặt/sửa/hủy lệnh BẬT (SSI_TRADING_ENABLED=true)"
          : "Đặt/sửa/hủy lệnh đang TẮT — cần SSI_PRIVATE_KEY + SSI_TRADING_ENABLED=true",
      },
    },
    legacyFcDataV2: {
      configured: legacyConfigured,
      active: legacyConfigured && !v3Configured,
      auth: legacyProbe,
      streaming: legacyConfigured && !v3Configured ? ssiWs.getStats() : null,
    },
    primary: v3Configured ? "ssi-fastconnect" : legacyConfigured ? "ssi-fcdata" : "vndirect",
  };

  return ok(
    data,
    buildMeta({
      source: "ssi-status",
      sourceTimestampMs: Date.now(),
      note: v3Configured
        ? "SSI FastConnect v3 (developers.ssi.com.vn) là PRIMARY cho chứng khoán VN"
        : legacyConfigured
          ? "SSI FC Data v2 legacy đang là PRIMARY — khuyến nghị chuyển sang v3 (SSI_API_KEY/SECRET)"
          : "Chưa cấu hình SSI — VN stocks đang chạy fallback VNDirect",
    }),
  );
}
