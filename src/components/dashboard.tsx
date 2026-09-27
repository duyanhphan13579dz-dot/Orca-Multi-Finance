"use client";

import "./command-center/command-center.css";
import { useApi } from "@/lib/hooks";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { IndexQuote, Quote } from "@/lib/types";
import { Loading, Unavailable } from "@/components/ui";
import { CommandCenter } from "@/components/command-center/command-center";

type StocksBoard = {
  indices: IndexQuote[] | null;
  quotes: Quote[] | null;
  count?: number;
};

export function Dashboard() {
  const {
    data: intel,
    meta,
    isLoading,
    isValidating,
    mutate,
    error,
  } = useApi<MarketIntel>("/api/v1/market/intel", {
    refreshInterval: 15_000,
    timeoutMs: 18_000,
  });

  const { data: board } = useApi<StocksBoard>("/api/v1/stocks?board=full", {
    refreshInterval: 60_000,
    timeoutMs: 20_000,
  });

  if (isLoading && !intel) {
    return (
      <div className="space-y-3">
        <Loading rows={6} />
        <Loading rows={8} />
        <p className="text-center text-[11px] text-text-muted">
          Đang dựng Market Command Center…
        </p>
      </div>
    );
  }

  if (!intel) {
    return (
      <div className="space-y-3">
        <Unavailable
          title="Tổng quan thị trường đang kết nối lại"
          note={
            error
              ? "Mất kết nối tạm thời tới provider — tự thử lại sau vài giây. Hoặc mở /system."
              : "Payload chưa sẵn sàng — đang đồng bộ VNDirect. Thử làm mới."
          }
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void mutate()}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary hover:border-border-default hover:text-text-primary"
          >
            {isValidating ? "Đang tải…" : "Thử lại ngay"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <CommandCenter
      intel={intel}
      meta={meta}
      quotes={board?.quotes ?? []}
    />
  );
}
