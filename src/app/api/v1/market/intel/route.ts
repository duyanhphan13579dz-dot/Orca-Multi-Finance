import { ok } from "@/lib/envelope";
import { buildMarketIntel } from "@/lib/services/market-intel";
import { buildMeta } from "@/lib/freshness";
import { getVnSession } from "@/lib/vn/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** MARKET INTELLIGENCE — never hard-blank the homepage. */
export async function GET() {
  try {
    const { intel, meta } = await buildMarketIntel();
    return ok(intel, meta);
  } catch (e1) {
    try {
      const { intel, meta } = await buildMarketIntel();
      return ok(intel, meta);
    } catch (e2) {
      const session = getVnSession();
      const intel = {
        session,
        sessionHint: "Kết nối intel suy giảm — đang thử lại",
        indices: null,
        indicesAvailable: false,
        breadth: {
          advancers: 0,
          decliners: 0,
          unchanged: 0,
          source: "degraded",
          available: false,
        },
        liquidity: {
          valueTraded: null,
          baseline: null,
          available: false,
          note: "degraded",
        },
        flow: {
          foreignNet: null,
          propNet: null,
          etfNet: null,
          source: "degraded",
          available: false,
          note: e2 instanceof Error ? e2.message : "degraded",
        },
        crossAsset: [],
        condition: {
          rating: "NEUTRAL" as const,
          score: 50,
          confidence: "LOW" as const,
          components: [],
          drivers: [],
          risks: ["Intel tạm gián đoạn"],
          crossAssetState: "NEUTRAL" as const,
          coverage: 0,
        },
        contributors: {
          positive: [],
          negative: [],
          hasWeights: false,
          note: "Chưa có dữ liệu đóng góp.",
        },
        news: [],
        sections: {
          indices: "UNAVAILABLE" as const,
          breadth: "UNAVAILABLE" as const,
          liquidity: "UNAVAILABLE" as const,
          flow: "UNAVAILABLE" as const,
          crossAsset: "UNAVAILABLE" as const,
          news: "UNAVAILABLE" as const,
        },
        vnDataNote: "Payload suy giảm — dashboard dùng board public nếu có.",
      };
      return ok(
        intel,
        buildMeta({
          source: "degraded",
          sourceTimestampMs: Date.now(),
          note: e1 instanceof Error ? e1.message : "intel_failed",
          degraded: true,
          hasData: false,
        }),
      );
    }
  }
}
