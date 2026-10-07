"use client";

import "./command-center/command-center.css";
import { useMemo } from "react";
import { useApi } from "@/lib/hooks";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { IndexQuote, Quote } from "@/lib/types";
import { Unavailable } from "@/components/ui";
import { PageSkeleton } from "@/components/page-skeleton";
import { CommandCenter } from "@/components/command-center/command-center";
import { getVnSession } from "@/lib/vn/sessions";

type StocksBoard = {
  indices: IndexQuote[] | null;
  quotes: Quote[] | null;
  count?: number;
};

type GlobalMarket = {
  us: { symbol: string; price: number; changePercent: number | null }[];
  crypto: { symbol: string; baseAsset: string; price: number; changePercent: number | null }[];
  asia?: { symbol: string; label: string; price: number; changePercent: number | null }[];
  liquiditySpark?: {
    volumes: number[];
    times?: (string | null)[];
    source?: string;
    symbol?: string;
  } | null;
  sources?: string[];
};

/** Minimal intel so Command Center still paints when /market/intel is slow/down. */
function synthesizeIntel(board: StocksBoard | undefined): MarketIntel | null {
  const indices = board?.indices?.length ? board.indices : null;
  if (!indices?.length && !(board?.quotes?.length)) return null;
  const session = getVnSession();
  return {
    session,
    sessionHint: "Đang đồng bộ intel đầy đủ…",
    indices,
    indicesAvailable: Boolean(indices?.length),
    breadth: {
      advancers: 0,
      decliners: 0,
      unchanged: 0,
      source: "pending",
      available: false,
      note: "Breadth chờ intel",
    },
    liquidity: {
      valueTraded: null,
      baseline: null,
      available: false,
      note: "Thanh khoản chờ intel",
    },
    flow: {
      foreignNet: null,
      propNet: null,
      etfNet: null,
      source: "pending",
      available: false,
      note: "Dòng tiền chờ intel",
    },
    crossAsset: [],
    condition: {
      rating: "NEUTRAL",
      score: 50,
      confidence: "LOW",
      components: [],
      drivers: [],
      risks: ["Intel đầy đủ đang tải"],
      crossAssetState: "NEUTRAL",
      coverage: 0,
    },
    contributors: {
      positive: [],
      negative: [],
      hasWeights: false,
      note: "Chưa có dữ liệu đóng góp.",
    },
    news: [],
    sections: {
      indices: indices?.length ? "LATEST_AVAILABLE" : "UNAVAILABLE",
      breadth: "UNAVAILABLE",
      liquidity: "UNAVAILABLE",
      flow: "UNAVAILABLE",
      crossAsset: "UNAVAILABLE",
      news: "UNAVAILABLE",
    },
    vnDataNote: "Hiển thị bảng giá partial — intel đang kết nối lại.",
  };
}

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
    timeoutMs: 22_000,
    keepPreviousData: true,
  });

  const {
    data: board,
    isLoading: boardLoading,
    mutate: mutateBoard,
  } = useApi<StocksBoard>("/api/v1/stocks?board=full", {
    refreshInterval: 20_000,
    timeoutMs: 22_000,
    keepPreviousData: true,
  });

  const { data: globalMkt } = useApi<GlobalMarket>("/api/v1/market/global", {
    refreshInterval: 60_000,
    timeoutMs: 15_000,
    keepPreviousData: true,
  });

  const displayIntel = useMemo(() => {
    if (intel) return intel;
    return synthesizeIntel(board);
  }, [intel, board]);

  const stillBooting = isLoading && boardLoading && !displayIntel;

  if (stillBooting) {
    return <PageSkeleton variant="dashboard" title="Market Command Center" />;
  }

  if (!displayIntel) {
    return (
      <div className="space-y-3">
        <Unavailable
          title="Tổng quan thị trường đang kết nối lại"
          note={
            error
              ? "Mất kết nối tạm thời tới provider — tự thử lại sau vài giây. Hoặc mở /system."
              : "Payload chưa sẵn sàng — đang đồng bộ nguồn public (VNDirect / VPS / SSI iBoard)."
          }
        />
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void mutate();
              void mutateBoard();
            }}
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
      intel={displayIntel}
      meta={meta}
      quotes={board?.quotes ?? []}
      globalUs={globalMkt?.us ?? []}
      globalCrypto={globalMkt?.crypto ?? []}
      globalAsia={globalMkt?.asia ?? []}
      liquiditySpark={globalMkt?.liquiditySpark ?? null}
    />
  );
}
