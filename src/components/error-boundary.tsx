"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log for debugging but never throw further
    console.error("[orca] boundary caught", error, info.componentStack?.slice(0, 800));
    // Report to server best-effort
    try {
      fetch("/api/v1/system/info", { method: "GET", cache: "no-store" }).catch(() => {});
    } catch {}
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Soft reset: try to re-render; if still fails, global-error will handle
  };

  private handleHardReload = () => {
    try {
      // Offer to clear corrupted local storage that commonly causes loops
      // Don't auto clear, user must confirm via fallback button secondary
      window.location.reload();
    } catch {
      window.location.href = "/";
    }
  };

  private handleClearAndReload = () => {
    try {
      const keys = ["orca.settings.v1", "orca.watchlist.v1", "orca.journal.v1", "orca.sidebar.collapsed"];
      for (const k of keys) localStorage.removeItem(k);
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const msg = this.state.error?.message ?? "unknown";
      const isChunk = /ChunkLoadError|Loading chunk|Failed to fetch.*chunk/i.test(msg);
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 px-4 py-10 text-center">
          <p className="text-[11px] uppercase tracking-widest text-text-muted">ORCA — phục hồi lỗi</p>
          <h2 className="text-[15px] font-semibold text-text-primary">
            {isChunk ? "Phiên bản mới đã sẵn sàng" : "Gặp sự cố hiển thị tạm thời"}
          </h2>
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            {isChunk
              ? "Ứng dụng vừa được cập nhật. Vui lòng tải lại để nhận bản mới — dữ liệu của bạn vẫn được giữ."
              : "Một module gặp lỗi render ngoài dự kiến. Dữ liệu thị trường và các trang khác vẫn an toàn. Thử tải lại khung này."}
          </p>
          <p className="max-w-full break-all rounded bg-surface-elevated px-2 py-1 text-[10px] text-text-muted">
            {msg.slice(0, 220)}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              onClick={this.handleReset}
              className="rounded-full bg-accent-primary px-4 py-2 text-[13px] font-semibold text-white active:scale-95"
            >
              Thử lại
            </button>
            <button
              onClick={this.handleHardReload}
              className="rounded-full border border-border-subtle bg-surface-elevated px-4 py-2 text-[13px] font-medium text-text-secondary active:scale-95"
            >
              Tải lại trang
            </button>
            <button
              onClick={this.handleClearAndReload}
              className="rounded-full border border-negative/30 bg-negative/10 px-4 py-2 text-[12px] font-medium text-negative active:scale-95"
            >
              Xóa bộ nhớ tạm & tải lại
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            Mẹo: lỗi “unknown” thường do bộ nhớ cục bộ cũ bị hỏng sau khi cập nhật — nút cuối sẽ xóa cache cục bộ và hồi phục ngay.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
