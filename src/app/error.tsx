"use client";

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
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-medium text-background-primary"
      >
        Thử lại
      </button>
    </div>
  );
}
