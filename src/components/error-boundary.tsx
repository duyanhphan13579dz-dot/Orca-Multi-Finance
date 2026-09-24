"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Optional label for diagnostics */
  name?: string;
  fallback?: ReactNode;
};

type State = { error: Error | null };

/**
 * Soft boundary — one subtree crash does not take down the whole shell.
 * Used around main page content when hopping tabs rapidly.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== "undefined") {
      console.warn(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="mx-auto max-w-lg rounded-xl border border-border-subtle bg-surface-elevated/80 px-4 py-6 text-center">
          <p className="text-[13px] font-semibold text-text-primary">Khu vực này gặp lỗi tạm thời</p>
          <p className="mt-1 text-[12px] text-text-muted">
            Sidebar và tab khác vẫn dùng được. Thử tải lại vùng này.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-3 rounded-lg bg-accent-primary/15 px-3 py-1.5 text-[12px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/25 active:scale-[0.98]"
          >
            Thử lại
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
