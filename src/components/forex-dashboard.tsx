"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import type { ForexMarket } from "@/lib/services/forex";
import type { ForexRow } from "@/lib/types";
import { Chg, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Globe2 } from "lucide-react";

export function ForexDashboard() {
  const { data, meta, isLoading } = useApi<ForexMarket>("/api/v1/forex/markets", { refreshInterval: 60_000 });
  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) return <Unavailable title="Forex chưa khả dụng" note="Biquote chưa cấu hình và nguồn dự phòng (exchangerate-api/ECB) đang gián đoạn. Xem /system." meta={meta} />;

  const groups: { key: ForexRow["group"]; title: string }[] = [
    { key: "major", title: "Cặp chính" },
    { key: "minor", title: "Cặp phụ" },
    { key: "exotic", title: "Ngoại lai / VND" },
  ];

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Globe2 className="size-5 text-accent" /> Thị trường ngoại hối
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            </h1>
            <p className="mt-1 text-[13px] text-ink-2">{data.usdStrengthNote}</p>
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {groups.map((g) => (
          <Panel key={g.key} title={g.title} pad={false}>
            <div className="divide-y divide-line/50">
              {data.rows.filter((r) => r.group === g.key).map((r) => (
                <Link key={r.pair} href={`/forex/${r.pair}`} className="row-hover flex items-center justify-between px-3.5 py-2.5">
                  <div>
                    <div className="text-[13px] font-semibold">{r.symbol}</div>
                    <div className="text-[10px] text-ink-3">{r.pair}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[14px]">{r.price >= 1000 ? r.price.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : r.price >= 100 ? r.price.toFixed(2) : r.price.toFixed(4)}</div>
                    <Chg value={r.changePercent} className="text-[11px]" arrow={false} />
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">
        Phương pháp: tỷ giá realtime từ provider (Biquote khi được cấu hình, nguồn dự phòng exchangerate-api); % thay đổi đối chiếu với bản fix tham chiếu gần nhất của ECB (Frankfurter). Dữ liệu phù hợp quan sát xu hướng — cần đối chiếu giá sàn trước khi giao dịch.
      </p>
    </div>
  );
}
