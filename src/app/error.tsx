"use client";

import { useEffect } from "react";

/**
 * App-Router error boundary (Phase 6).
 * Guarantees a provider/data failure or an unexpected client exception can
 * never be replaced by Next's generic "Failed to load page" — the shell
 * (sidebar/nav) stays mounted and the user sees a styled, actionable panel
 * with a retry button. UI styling follows existing panel tokens.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[orca-error-boundary]", error?.message ?? error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-line-2 bg-panel-2/50 p-6">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-1">
          <span className="inline-block size-2.5 rounded-full bg-warn" />
          Một thành phần đã gặp lỗi tạm thời
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          Trang vẫn hiển thị khung điều hướng và các module còn lại. Dữ liệu thị trường không bị pha trộn với
          dữ liệu giả — module lỗi sẽ tự phục hồi khi provider sẵn sàng.
        </p>
        {error?.message && (
          <p className="mt-2 break-all rounded-md bg-panel-3/60 p-2 text-[11px] text-ink-3">{error.message}</p>
        )}
        <button
          onClick={reset}
          className="mt-4 rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Thử lại
        </button>
      </div>
    </div>
  );
}
