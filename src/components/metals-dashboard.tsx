"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import type { MetalsMarket } from "@/lib/services/metals";
import type { MetalRow } from "@/lib/types";
import { Chg, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Gem } from "lucide-react";

export function MetalsDashboard() {
  const { data, meta, isLoading } = useApi<MetalsMarket>("/api/v1/metals/markets", { refreshInterval: 60_000 });
  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) return <Unavailable title="Kim loại chưa khả dụng" note="Swissquote BBO và Yahoo Finance đang gián đoạn. Xem /system." meta={meta} />;

  const groups: { key: MetalRow["group"]; title: string }[] = [
    { key: "precious", title: "Kim loại quý" },
    { key: "platinum", title: "Nhóm bạch kim" },
  ];

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Gem className="size-5 text-accent" /> Kim loại (Metals)
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            </h1>
            <p className="mt-1 text-[13px] text-ink-2">{data.note}</p>
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {groups.map((g) => (
          <Panel key={g.key} title={g.title} pad={false}>
            <div className="divide-y divide-line/50">
              {data.rows.filter((r) => r.group === g.key).map((r) => (
                <Link key={r.symbol} href={`/metals/${r.symbol}`} className="row-hover flex items-center justify-between px-3.5 py-2.5">
                  <div>
                    <div className="text-[13px] font-semibold">{r.symbol}</div>
                    <div className="text-[10px] text-ink-3">{r.name} · {r.unit}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[14px]">{r.price >= 1000 ? r.price.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : r.price.toFixed(2)}</div>
                    <Chg value={r.changePercent} className="text-[11px]" arrow={false} />
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">
        Giá BBO trực tiếp từ Swissquote public feed (no key, realtime); % thay đổi/đóng cửa trước từ Yahoo Finance. Khi thị trường đóng cửa (cuối tuần) giá là phiên gần nhất — nguồn vẫn ghi nhãn freshness trung thực, không phải lỗi provider.
      </p>
    </div>
  );
}
