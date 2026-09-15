"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { Meta } from "@/lib/types";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Activity, ArrowRight, ArrowUpRight, BrainCircuit, Factory, Globe2, KeyRound, Layers, Scale, TrendingUp } from "lucide-react";

/**
 * ORCA REAL-TIME MARKET INTELLIGENCE COMMAND CENTER
 * Vietnam market → condition engine → cross-asset context → breadth → flow →
 * contributors → analyst intelligence. Every widget shows source + freshness.
 */

export function Dashboard() {
  const { data, meta, isLoading, isValidating, mutate, error } = useApi<MarketIntel>("/api/v1/market/intel", {
    refreshInterval: 12_000,
    timeoutMs: 18_000,
  });
  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Loading rows={6} />
        <Loading rows={8} />
        <p className="text-center text-[11px] text-text-muted">Đang dựng Market Intelligence từ VNDirect…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <Unavailable
          title="Market Intelligence Engine đang kết nối lại"
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
  return <IntelView intel={data} meta={meta} />;
}
