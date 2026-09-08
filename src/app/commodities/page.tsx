"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CommodityMarket } from "@/lib/services/commodities";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Unavailable } from "@/components/ui";
import { AddToWatchlist } from "@/components/watchlist-button";
import { CurrencyConverter } from "@/components/currency-converter";
import {
  CommodityLineChart,
  resolveCommodityChartSymbol,
} from "@/components/commodity-line-chart";
import { Boxes, Search, X } from "lucide-react";

type CatalogItem = {
  key: string;
  name: string;
  nameVi: string;
  group: string;
  symbol: string;
  unit: string;
  vnImpact: { sector: string; stocks: string[]; mechanism: string } | null;
};

type Data = Omit<CommodityMarket, "catalog"> & {
  catalog: CatalogItem[];
  groups?: Record<string, { title: string; desc: string }>;
};

const FALLBACK_GROUPS: { key: string; title: string; desc: string }[] = [
  { key: "", title: "Tất cả", desc: "" },
  { key: "hang_tieu_dung", title: "Hàng tiêu dùng", desc: "Heo · Cà phê · Gạo…" },
  { key: "kim_loai_phi_kim", title: "Kim loại & phi kim", desc: "Vàng · Đồng…" },
  { key: "hoa_chat", title: "Hóa chất", desc: "Ure · Phân…" },
  { key: "vat_lieu_xay_dung", title: "Vật liệu XD", desc: "Thép · Xi măng…" },
  { key: "nang_luong", title: "Năng lượng", desc: "WTI · Xăng…" },
  { key: "nhua_va_cao_su", title: "Nhựa & cao su", desc: "PVC · PP…" },
];

export default function CommoditiesPage() {
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [group, setGroup] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const { data, meta, isLoading, isValidating, error, mutate } = useApi<Data>("/api/v1/commodities", { refreshInterval: 5 * 60_000 });
  const isStale = meta?.freshness === "STALE" || meta?.freshness === "DELAYED" || meta?.freshness === "DEGRADED" || meta?.stale;
  const hasFallbackNote = Boolean(data?.errors?.length || (meta?.note && /cache/i.test(meta.note)));

  const groups = useMemo(() => {
    if (data?.groups) {
      return [
        { key: "", title: "Tất cả", desc: "" },
        ...Object.entries(data.groups).map(([key, v]) => ({ key, title: v.title, desc: v.desc })),
      ];
    }
    return FALLBACK_GROUPS;
  }, [data]);

  const catalog = useMemo((): CatalogItem[] => {
    let defs: CatalogItem[] = data?.catalog ?? [];
    if (group) defs = defs.filter((d) => d.group === group);
    if (deferredQ.trim()) {
      const needle = deferredQ.trim().toLowerCase();
      defs = defs.filter(
        (d) =>
          d.nameVi.toLowerCase().includes(needle) ||
          d.name.toLowerCase().includes(needle) ||
          d.symbol.toLowerCase().includes(needle),
      );
    }
    return defs;
  }, [data, group, deferredQ]);

  const bySymbol = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.symbol, r])), [data]);

  const visibleCatalog = useMemo(() => catalog.slice(0, visibleCount), [catalog, visibleCount]);
  // Reset pagination when filters change - effect avoids setState during render
  useEffect(() => {
    setVisibleCount(24);
  }, [group, deferredQ]);

  const chartOptions = useMemo(() => {
    const acc: { chartSymbol: string; label: string }[] = [];
    for (const d of data?.catalog ?? []) {
      const cs = resolveCommodityChartSymbol(d.symbol, d.nameVi);
      if (!cs || acc.some((x) => x.chartSymbol === cs)) continue;
      acc.push({ chartSymbol: cs, label: d.nameVi });
    }
    for (const fallback of [
      { chartSymbol: "GOLD", label: "Vàng (quốc tế)" },
      { chartSymbol: "SILVER", label: "Bạc (quốc tế)" },
      { chartSymbol: "WTI", label: "Dầu WTI" },
      { chartSymbol: "BRENT", label: "Dầu Brent" },
      { chartSymbol: "COPPER", label: "Đồng (Copper)" },
      { chartSymbol: "COFFEE", label: "Cà phê (KC)" },
    ] as const) {
      if (!acc.some((x) => x.chartSymbol === fallback.chartSymbol)) {
        acc.push({ chartSymbol: fallback.chartSymbol, label: fallback.label });
      }
    }
    return acc;
  }, [data?.catalog]);

  if (isLoading && !data) return <Loading rows={10} />;

  return (
    <div className="space-y-3">
      <div className="panel overflow-visible p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Boxes className="size-5 text-accent-primary" /> Hàng hóa
            <Badge tone="neutral">VietnamBiz Data</Badge>
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </h1>
          <div className="relative ml-auto w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm: vàng, cà phê, xăng, thép…"
              className="w-full rounded-xl border border-border-subtle bg-surface-elevated py-2 pl-9 pr-8 text-[13px] text-text-primary shadow-inner outline-none transition-all placeholder:text-text-muted focus:border-accent-primary/50 focus:ring-2 focus:ring-accent-primary/20"
              aria-label="Tìm kiếm hàng hóa"
            />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" aria-label="Xóa">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="chip-scroll scrollbar-hide mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 scroll-snap-x md:flex-wrap md:overflow-visible md:pb-0">
          {groups.map((g) => (
            <button
              key={g.key}
              onClick={() => setGroup(g.key)}
              className={`scroll-snap-item group shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11.5px] transition-all md:py-1 ${
                group === g.key
                  ? "border-accent-primary/50 bg-accent-primary/12 text-accent-primary shadow-[0_0_0_3px_rgba(76,141,255,0.10)]"
                  : "border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary"
              }`}
            >
              {g.title}
              {g.desc && <span className="ml-1 hidden text-[10px] text-text-muted group-hover:text-text-secondary sm:inline">{g.desc}</span>}
            </button>
          ))}
          <span className="ml-auto hidden md:block">
            <MetaLine meta={meta} />
          </span>
        </div>
        {data?.rows && (
          <p className="mt-2 text-[11px] text-text-muted">
            {data.rows.length} mặt hàng · nguồn{" "}
            <a href="https://data.vietnambiz.vn/goods" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline">
              data.vietnambiz.vn/goods
            </a>
          </p>
        )}
      </div>

      <CurrencyConverter />

      {(isStale || hasFallbackNote) && data && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
          <span className="font-medium">Đang hiển thị dữ liệu cache</span>
          <span className="text-amber-800/80 dark:text-amber-200/80">
            VietnamBiz tạm chậm/không phản hồi — bạn vẫn xem được dữ liệu gần nhất. Hệ thống sẽ tự đồng bộ lại.
          </span>
          {meta?.note && <span className="text-[11px] text-amber-700/80 dark:text-amber-200/70">· {meta.note}</span>}
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="ml-auto rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {isValidating ? "Đang thử…" : "Thử lại ngay"}
          </button>
        </div>
      )}

      <CommodityLineChart options={chartOptions} height={320} />

      {!data ? (
        <div className="space-y-3">
          <Unavailable title="VietnamBiz Data chưa phản hồi bảng giá" meta={meta} note={error ? String((error as Error).message ?? error) : undefined} />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => mutate()}
              disabled={isValidating}
              className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50"
            >
              {isValidating ? "Đang tải…" : "Thử lại"}
            </button>
            <a href="https://data.vietnambiz.vn/goods" target="_blank" rel="noopener noreferrer" className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-elevated">
              Mở nguồn gốc
            </a>
            <a href="/system" className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-elevated">
              Xem /system
            </a>
          </div>
          {meta && (
            <p className="text-[11px] text-text-muted">
              Hệ thống tự thử lại sau 20–60s (có cache DB nếu từng đồng bộ). Nếu vẫn trắng trang, nguồn đang bảo trì/WAF chặn — thử lại sau.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3" style={{ contentVisibility: "auto", containIntrinsicSize: "1000px" }}>
            {visibleCatalog.map((d) => {
            const row = bySymbol.get(d.symbol);
            const groupMeta = groups.find((x) => x.key === d.group);
            if (!row) {
              return (
                <div key={d.key} className="panel flex items-center justify-between p-3 opacity-60">
                  <div>
                    <div className="text-[13px] font-medium">{d.nameVi}</div>
                    <div className="text-[10px] text-text-muted">
                      {d.symbol} · {groupMeta?.title}
                    </div>
                  </div>
                  <Badge tone="warn">UNAVAILABLE</Badge>
                </div>
              );
            }
            const dgt = row.price >= 1000 ? 0 : row.price >= 10 ? 2 : 3;
            const up = (row.changePercent ?? 0) > 0;
            return (
              <div key={d.key} className="panel hover-lift relative overflow-hidden p-3">
                <div
                  className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] ${
                    up ? "bg-positive" : (row.changePercent ?? 0) < 0 ? "bg-negative" : "bg-border-default"
                  }`}
                />
                <div className="flex items-start justify-between gap-2 pl-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold leading-snug">{d.nameVi}</span>
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {groupMeta?.title ?? d.group} · {row.unit}
                    </div>
                  </div>
                  <AddToWatchlist assetType="commodity" symbol={d.symbol} />
                </div>
                <div className="mt-2 flex items-baseline justify-between pl-1.5">
                  <span className="num text-[19px] font-semibold tracking-tight">
                    {fmtNum(row.price, dgt)}
                    <span className="ml-1 text-[10px] font-normal text-text-muted">{row.currency}</span>
                  </span>
                  <Chg value={row.changePercent} className="text-[12px]" arrow={false} />
                </div>
                <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-1.5 pl-1.5">
                  {row.sourceRecords.map((s) => (
                    <div key={s.source} className="flex items-center justify-between text-[10px] text-text-muted">
                      <span className="truncate">{s.source}</span>
                      <span className="num">
                        {fmtNum(s.price, dgt)}
                        {s.timestamp && (
                          <>
                            {" "}·{" "}
                            {new Date(s.timestamp).toLocaleString("vi-VN", {
                              timeZone: "Asia/Ho_Chi_Minh",
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
            })}
          </div>
          {visibleCatalog.length < catalog.length && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => setVisibleCount((c) => Math.min(c + 24, catalog.length))}
                className="rounded-md border border-accent-primary/30 bg-accent-primary/10 px-4 py-1.5 text-[12px] font-medium text-accent-primary hover:bg-accent-primary/15"
              >
                Xem thêm {Math.min(24, catalog.length - visibleCatalog.length)} mặt hàng ({visibleCatalog.length}/{catalog.length})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
