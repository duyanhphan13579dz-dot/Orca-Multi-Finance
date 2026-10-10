"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[orca] route error", error?.digest ?? error?.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-[11px] uppercase tracking-wider text-text-muted">Hệ thống</p>
      <h1 className="text-lg font-semibold text-text-primary">Có lỗi tạm thời</h1>
      <p className="text-[13px] leading-relaxed text-text-secondary">
        Module vừa gặp sự cố không mong muốn. Dữ liệu khác vẫn có thể hoạt động bình thường — thử tải lại khung này.
      </p>
      {error?.digest ? (
        <p className="text-[11px] text-text-muted">Mã lỗi: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-medium text-background-primary"
        >
          Thử lại
        </button>
        <Link
          href="/screener"
          className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px] text-text-secondary hover:border-border-default hover:text-text-primary"
        >
          Về bộ lọc
        </Link>
        <Link
          href="/"
          className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px] text-text-secondary hover:border-border-default hover:text-text-primary"
        >
          Tổng quan
        </Link>
      </div>
    </div>
  );
}
