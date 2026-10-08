import { getSessionUser } from "@/lib/auth";
import { fail } from "@/lib/envelope";

export async function requireInternalSession(): Promise<Response | null> {
  return (await getSessionUser()) ? null : fail("UNAUTHORIZED", "Đăng nhập để truy cập API vận hành", 401);
}
