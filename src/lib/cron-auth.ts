import "server-only";
import crypto from "crypto";

/**
 * Xác thực chung cho mọi route /api/v1/cron/*.
 *
 *  - Có CRON_SECRET: chấp nhận `Authorization: Bearer <secret>` hoặc `?secret=<secret>`
 *    (cron-job.org không gửi được header thì dùng query). So sánh hằng thời gian.
 *  - Thiếu CRON_SECRET:
 *      · production  → TỪ CHỐI (503). Trước đây route để mở cho bất kỳ ai gọi.
 *      · dev / test  → cho qua để chạy thử cục bộ.
 *
 * Trả về `null` nếu được phép, hoặc một `Response` lỗi để route trả thẳng.
 */

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest();

/** So sánh hằng thời gian, an toàn cả khi hai chuỗi khác độ dài. */
function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function json(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function cronUnauthorized(req: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return json(503, "CRON_NOT_CONFIGURED", "CRON_SECRET chưa được cấu hình trên server");
    }
    return null;
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const query = new URL(req.url).searchParams.get("secret") ?? "";

  if ((bearer && safeEqual(bearer, secret)) || (query && safeEqual(query, secret))) return null;
  return json(401, "UNAUTHORIZED", "Invalid cron secret");
}
