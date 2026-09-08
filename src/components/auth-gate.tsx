"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, ShieldCheck, ArrowRight } from "lucide-react";
import { useApi } from "@/lib/hooks";

interface Props {
  children: React.ReactNode;
  feature: string;
  description?: string;
}

export function AuthGate({ children, feature, description }: Props) {
  const pathname = usePathname();
  // Chỉ dùng pathname để tránh yêu cầu Suspense cho useSearchParams — middleware đã xử lý query ?next đầy đủ khi redirect server.
  const next = pathname || "/";
  const loginHref = `/login?next=${encodeURIComponent(next)}`;
  const registerHref = `/register?next=${encodeURIComponent(next)}`;

  const { data: me, isLoading, error } = useApi<{ user: { email: string; name: string | null } }>("/api/v1/auth/me");

  // Đang kiểm tra phiên
  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 px-4 py-14 text-center">
        <span className="size-2 animate-pulse rounded-full bg-accent" />
        <p className="text-[13px] text-ink-3">Đang kiểm tra phiên đăng nhập…</p>
      </div>
    );
  }

  // Chưa đăng nhập — chặn mềm
  const isAuthed = !!me?.user;
  if (!isAuthed || error) {
    return (
      <div className="mx-auto max-w-lg px-3 py-6 md:py-10">
        <div className="panel overflow-hidden">
          <div className="bg-gradient-to-br from-accent/10 via-accent/5 to-transparent px-6 py-6 md:px-8 md:py-8">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/20">
              <Lock className="size-6 text-accent" />
            </div>
            <h1 className="mt-4 text-center text-[18px] font-semibold leading-tight md:text-xl">
              {feature} — yêu cầu đăng nhập
            </h1>
            <p className="mx-auto mt-2 max-w-[36ch] text-center text-[13px] leading-relaxed text-ink-3">
              {description ??
                `Tính năng ${feature} chứa dữ liệu cá nhân & chi phí AI/market realtime. Vui lòng đăng nhập để tiếp tục — dữ liệu local của bạn sẽ được giữ và đồng bộ sau khi đăng nhập.`}
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <Link
                href={loginHref}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-sm active:scale-[0.98] md:rounded-lg md:py-2.5"
              >
                Đăng nhập <ArrowRight className="size-4" />
              </Link>
              <Link
                href={registerHref}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-panel-2 px-5 py-3 text-[14px] font-medium text-ink active:scale-[0.98] md:rounded-lg md:py-2.5"
              >
                Tạo tài khoản miễn phí
              </Link>
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-3">
              <ShieldCheck className="size-3.5 text-up" /> Phiên JWT httpOnly — không lộ khóa API
            </p>
          </div>
          <div className="border-t border-line bg-panel-2/60 px-5 py-3 text-[11px] leading-relaxed text-ink-3 md:px-6">
            <span className="font-medium text-ink">Mẹo:</span> Bạn vẫn có thể xem Tổng quan, Cổ phiếu VN, Hàng hóa, Tin tức, Heatmap, Screener (chế độ xem) mà không cần đăng nhập. Chỉ các tính năng cá nhân & chi phí cao mới khóa sau đăng nhập.
          </div>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="text-[12px] text-ink-3 hover:text-ink hover:underline">
            ← Về Tổng quan
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
