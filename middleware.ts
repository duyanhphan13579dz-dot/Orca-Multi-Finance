import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Các nhóm tính năng bắt buộc đăng nhập theo yêu cầu: AI Agent, Journal, Watchlist, Settings, Crypto, Forex
const PROTECTED_PAGE_PREFIXES = ["/agent", "/journal", "/watchlist", "/settings", "/crypto", "/forex"];
const PROTECTED_API_PREFIXES = ["/api/v1/agent", "/api/v1/crypto", "/api/v1/forex"];
const AUTH_COOKIE = "orca_session";
const LOGIN_PATH = "/login";

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = !!request.cookies.get(AUTH_COOKIE)?.value;

  // Bảo vệ API: trả 401 JSON thay vì redirect
  if (isProtectedApi(pathname)) {
    if (!hasSession) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHENTICATED", message: "Đăng nhập để sử dụng tính năng này — vui lòng đăng nhập." },
          meta: { source: "orca-auth", freshness: "UNAVAILABLE" as const },
        },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.next();
  }

  // Bảo vệ trang: redirect về /login?next=...
  if (isProtectedPage(pathname)) {
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = LOGIN_PATH;
      // giữ destination để quay lại sau khi đăng nhập
      url.searchParams.set("next", pathname + search);
      // Xóa các param cũ không liên quan (tránh lặp)
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// Chạy cho tất cả trừ static, image optimization, favicon
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
