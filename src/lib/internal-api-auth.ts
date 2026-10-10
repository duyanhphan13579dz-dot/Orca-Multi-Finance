import { getSessionUser, getUserById } from "@/lib/auth";
import { fail } from "@/lib/envelope";

/**
 * API vận hành (/system/*, /ops/*): cần đăng nhập.
 * Nếu đặt ADMIN_EMAILS (danh sách email, phân tách bằng dấu phẩy) thì chỉ các email đó được truy cập —
 * vì đăng ký đang mở, bất kỳ ai cũng có thể tạo tài khoản.
 */
export async function requireInternalSession(): Promise<Response | null> {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHORIZED", "Đăng nhập để truy cập API vận hành", 401);
  const allow = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.length) {
    if (process.env.NODE_ENV === "production") {
      return fail("FORBIDDEN", "ADMIN_EMAILS chưa được cấu hình trên production. Truy cập bị từ chối.", 403);
    }
    return null;
  }
  const user = await getUserById(session.id).catch(() => null);
  if (!user || !allow.includes(user.email.toLowerCase())) {
    return fail("FORBIDDEN", "Tài khoản không có quyền truy cập API vận hành", 403);
  }
  return null;
}
