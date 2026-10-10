"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import type { ForexMarket } from "@/lib/services/forex";
import type { ForexRow } from "@/lib/types";
import { Chg, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Globe2 } from "lucide-react";

export function ForexDashboard() {
  const { data, meta, isLoading } = useApi<ForexMarket>("/api/v1/forex/markets", {
    refreshInterval: 25_000,
    keepPreviousData: true,
    // P5-A: tighter client timeout — hot snapshot / last-good cover cold path
    timeoutMs: 10_000,
  });
  if (isLoading && !data) return <Loading rows={10} />;
  if (!data) {
    return (
      <Unavailable
        title="Forex chưa khả dụng"
        note="Biquote/Yahoo đang kết nối lại. Xem /system."
        meta={meta}
      />
    );
  }

  const groups: { key: NonNullable<ForexRow["group"]>; title: string }[] = [
    { key: "major", title: "Cặp chính" },
    { key: "cross", title: "Cặp chéo" },
    { key: "vnd", title: "VND" },
    { key: "metal", title: "Kim loại (XAU · XAG · XPT)" },
    { key: "energy", title: "Dầu · Gas · Đồng" },
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
        {groups.map((g) => {
          const rows = data.rows.filter((r) => r.group === g.key);
          const placeholders =
            g.key === "metal"
              ? [
                  { pair: "XAUUSD", symbol: "XAU/USD" },
                  { pair: "XAGUSD", symbol: "XAG/USD" },
                  { pair: "XPTUSD", symbol: "XPT/USD" },
                ]
              : g.key === "energy"
                ? [
                    { pair: "OILUSD", symbol: "OIL/USD" },
                    { pair: "UKOIL", symbol: "UKO/USD" },
                    { pair: "USOIL", symbol: "USO/USD" },
                  ]
                : [];
          const show = rows.length
            ? rows
            : placeholders.map((p) => ({
                pair: p.pair,
                symbol: p.symbol,
                price: null as number | null,
                changePercent: null as number | null,
              }));
          if (!show.length) return null;
          return (
            <Panel key={g.key} title={g.title} pad={false}>
              <div className="divide-y divide-line/50">
                {show.map((r) => (
                  <Link
                    key={r.pair}
                    href={`/forex/${r.pair}`}
                    className="row-hover flex items-center justify-between px-3.5 py-2.5"
                  >
                    <div>
                      <div className="text-[13px] font-semibold">{r.symbol}</div>
                      <div className="text-[10px] text-ink-3">{r.pair}</div>
                    </div>
                    <div className="text-right">
                      <div className="num text-[14px]">
                        {r.price == null
                          ? "—"
                          : r.price >= 1000
                            ? r.price.toLocaleString("vi-VN", { maximumFractionDigits: 0 })
                            : r.price >= 100
                              ? r.price.toFixed(2)
                              : r.price.toFixed(4)}
                      </div>
                      <Chg value={r.changePercent} className="text-[11px]" arrow={false} />
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">
        Realtime ≤15s: Biquote (FX) ∥ Yahoo (XAU/XAG/oil) ∥ ER-API. Bấm mã để mở chart + chỉ báo.
      </p>
    </div>
  );
}
