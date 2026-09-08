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
    try {
      console.error("[orca] route error", error?.digest ?? error?.message, error?.stack?.slice(0, 800));
    } catch {}
  }, [error]);

  const msg = (error as Error)?.message ?? "";
  const isChunk = /ChunkLoadError|Loading chunk|Failed to fetch.*chunk/i.test(msg);

  const clearAndReset = () => {
    try {
      const keys = ["orca.settings.v1", "orca.watchlist.v1", "orca.journal.v1"];
      for (const k of keys) localStorage.removeItem(k);
    } catch {}
    reset();
  };

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="text-[11px] uppercase tracking-wider text-text-muted">Hệ thống</p>
      <h1 className="text-[15px] font-semibold text-text-primary">
        {isChunk ? "Phiên bản mới cần tải lại" : "Có lỗi tạm thời"}
      </h1>
      <p className="text-[13px] leading-relaxed text-text-secondary">
        {isChunk
          ? "Trình duyệt đang giữ bản cũ của module này trong cache sau khi triển khai. Tải lại để đồng bộ — dữ liệu của bạn không bị mất."
          : "Module vừa gặp sự cố không mong muốn. Dữ liệu khác vẫn có thể hoạt động bình thường — thử tải lại khung này."}
      </p>
      {msg && <p className="max-w-full break-all rounded bg-surface-elevated px-2 py-1 text-[10px] text-text-muted">{msg.slice(0, 200)}</p>}
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-accent-primary px-4 py-2 text-[13px] font-semibold text-white active:scale-95"
        >
          Thử lại
        </button>
        <button
          type="button"
          onClick={clearAndReset}
          className="rounded-full border border-border-subtle bg-surface-elevated px-4 py-2 text-[12px] font-medium text-text-secondary active:scale-95"
        >
          Xóa cache cục bộ & thử lại
        </button>
        <a href="/" className="rounded-full border border-border-subtle bg-surface-elevated px-4 py-2 text-[12px] font-medium text-text-secondary">
          Về Tổng quan
        </a>
      </div>
      {error?.digest && <p className="text-[10px] text-text-muted">Mã: {error.digest}</p>}
    </div>
  );
}
