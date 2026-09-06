import { ok, unavailable } from "@/lib/envelope";
import { getVnFx } from "@/lib/services/vnfx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * VIETNAM FX API — mô hình USD/VND riêng:
 * reference (SBV) / buyCash / buyTransfer / sell / freeSell.
 * GET /api/v1/vn-fx
 */
export async function GET() {
  const model = await getVnFx();
  if (!model.rate && !model.reference && !model.sell) {
    return unavailable(
      "vietcombank-public+vietnambiz-data",
      "Không lấy được tỷ giá USD/VND (Vietcombank + VietnamBiz Data) — xem /system.",
    );
  }
  return ok(model, {
    source: model.source,
    sourceTimestampMs: model.updatedAt,
    note: model.note,
    slas: { liveSlaMs: 12 * 3_600_000, freshSlaMs: 48 * 3_600_000, delayedSlaMs: 96 * 3_600_000 },
  });
}
