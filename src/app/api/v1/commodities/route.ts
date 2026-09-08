import { ok, unavailable } from "@/lib/envelope";
import { getCommodityMarket, GROUP_LABELS } from "@/lib/services/commodities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const r = await getCommodityMarket();
    if (!r) {
      // Đã thử cả VietnamBiz + peekStale + DB đều trống — trả 502 nhưng có header retry để FE tự thử lại
      const res = unavailable(
        "commodity-providers",
        "VietnamBiz Data (data.vietnambiz.vn/goods) tạm không phản hồi và chưa có cache — vui lòng thử lại sau 60s. Xem /system.",
      );
      res.headers.set("Retry-After", "60");
      return res;
    }
    const catalog = r.data.catalog.map((c) => ({
      key: c.key,
      name: c.name,
      nameVi: c.nameVi,
      group: c.group,
      symbol: c.symbol,
      unit: c.unit,
      vnImpact: c.vnImpact ?? null,
    }));
    // Dù là degraded (stale/DB cache) vẫn trả success:true để UI hiển thị dữ liệu + banner cảnh báo thay vì trắng trang
    const response = ok(
      {
        rows: r.data.rows,
        unavailable: r.data.unavailable,
        sourcesUsed: r.data.sourcesUsed,
        errors: r.data.errors,
        catalog,
        groups: GROUP_LABELS,
      },
      r.meta,
    );
    // Cho phép CDN/fetch cache ngắn hạn khi degraded, giảm tải khi nguồn chập chờn
    if (r.meta.freshness === "STALE" || r.meta.freshness === "DELAYED" || r.meta.freshness === "DEGRADED") {
      response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    }
    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const res = unavailable("commodity-providers", `VietnamBiz Data lỗi: ${msg} — thử lại sau.`);
    res.headers.set("Retry-After", "30");
    return res;
  }
}
