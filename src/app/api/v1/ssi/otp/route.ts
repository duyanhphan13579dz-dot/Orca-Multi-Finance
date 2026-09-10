import { fail, ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getSessionUser } from "@/lib/auth";
import { requestFcOtp, ssiTradingConfigured } from "@/lib/providers/ssi-trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/ssi/otp — yêu cầu OTP cho nghiệp vụ giao dịch.
 * - Tài khoản 2FA SMS/Email: OTP gửi về điện thoại/email đã đăng ký.
 * - Tài khoản SmartOTP: trả về transactionId; khách approve trên iBoard rồi
 *   gọi auth/token với transactionId đó (route orders nhận transactionId).
 */
export async function POST() {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để yêu cầu OTP SSI", 401);
  if (!ssiTradingConfigured()) {
    return fail("SSI_NOT_CONFIGURED", "Chưa cấu hình SSI FastConnect (SSI_API_KEY/SECRET)", 503);
  }
  try {
    const res = await requestFcOtp();
    return ok(
      res,
      buildMeta({
        source: "ssi-fastconnect",
        sourceTimestampMs: Date.now(),
        note: res.transactionId
          ? "SmartOTP — approve trên iBoard rồi dùng transactionId khi đặt/sửa/hủy lệnh"
          : "OTP đã gửi — dùng mã OTP khi đặt/sửa/hủy lệnh",
      }),
    );
  } catch (e) {
    return fail("SSI_OTP_ERROR", e instanceof Error ? e.message : "Yêu cầu OTP thất bại", 502);
  }
}
