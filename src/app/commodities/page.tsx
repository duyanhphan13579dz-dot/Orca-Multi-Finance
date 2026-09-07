"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CommodityMarket } from "@/lib/services/commodities";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Unavailable } from "@/components/ui";
import { AddToWatchlist } from "@/components/watchlist-button";
import { OrcaChart } from "@/components/orca-chart";
import { CurrencyConverter } from "@/components/currency-converter";
import { Boxes, LineChart, Search, X } from "lucide-react";

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

/** Heuristic: symbols with international futures/spot history (Yahoo / PAXG). */
function isChartableCommodity(symbol: string, nameVi = ""): boolean {
  const s = `${symbol} ${nameVi}`.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /VANG|GOLD|XAU|BAC|SILVER|XAG|WTI|CRUDE|USOIL|BRENT|NATGAS|COPPER|CAFE|COFFEE|SUGAR|DUONG|CORN|WHEAT|SOY|PLATINUM|PALLADIUM/.test(s);
}

function CommodityVolatilityChart({ catalog }: { catalog: CatalogItem[] }) {
  const options = useMemo(
    () => catalog.filter((d) => isChartableCommodity(d.symbol, d.nameVi)),
    [catalog],
  );
  const [symbol, setSymbol] = useState(options[0]?.symbol ?? "");

  useEffect(() => {
    if (!options.length) {
      setSymbol("");
      return;
    }
    if (!options.some((o) => o.symbol === symbol)) {
      setSymbol(options[0].symbol);
    }
  }, [options, symbol]);

  if (!options.length) {
    return (
      <section className="panel overflow-hidden p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
          <LineChart className="size-4 text-accent-primary" /> Biểu đồ biến động
        </div>
        <p className="mt-2 text-[12px] text-text-muted">
          Chưa có mặt hàng có chuỗi giá quốc tế (vàng, dầu, bạc…) trong bộ lọc hiện tại — thử chọn nhóm Kim loại / Năng lượng.
        </p>
      </section>
    );
  }

  const active = options.find((o) => o.symbol === symbol) ?? options[0];

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <LineChart className="size-4 text-accent-primary" />
          <h2 className="text-[13px] font-semibold text-text-primary">Biểu đồ biến động</h2>
          <Badge tone="neutral">OHLC tham chiếu</Badge>
        </div>
        <select
          value={active.symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-lg border border-border-subtle bg-surface-elevated px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-accent-primary/60"
          aria-label="Chọn mặt hàng xem biểu đồ"
        >
          {options.map((o) => (
            <option key={o.symbol} value={o.symbol}>
              {o.nameVi} ({o.symbol})
            </option>
          ))}
        </select>
      </header>
      <div className="p-2">
        <OrcaChart
          key={active.symbol}
          symbol={active.symbol}
          assetType="commodity"
          defaultTimeframe="1d"
          height={340}
          title={`${active.nameVi} · ${active.symbol}`}
        />
        <p className="px-2 pb-2 text-[10px] leading-relaxed text-text-muted">
          Chuỗi nến từ Yahoo Futures / Binance PAXG (vàng) — tham chiếu biến động quốc tế, có thể khác giá VietnamBiz (VND/nội địa).
        </p>
      </div>
    </section>
  );
}

export default function CommoditiesPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const { data, meta, isLoading } = useApi<Data>("/api/v1/commodities", { refreshInterval: 5 * 60_000 });

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
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      defs = defs.filter(
        (d) =>
          d.nameVi.toLowerCase().includes(needle) ||
          d.name.toLowerCase().includes(needle) ||
          d.symbol.toLowerCase().includes(needle),
      );
    }
    return defs;
  }, [data, group, q]);

  const bySymbol = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.symbol, r])), [data]);

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
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {groups.map((g) => (
            <button
              key={g.key}
              onClick={() => setGroup(g.key)}
              className={`group rounded-full border px-3 py-1 text-[11.5px] transition-all ${
                group === g.key
                  ? "border-accent-primary/50 bg-accent-primary/12 text-accent-primary shadow-[0_0_0_3px_rgba(76,141,255,0.10)]"
                  : "border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary"
              }`}
            >
              {g.title}
              {g.desc && <span className="ml-1 text-[10px] text-text-muted group-hover:text-text-secondary">{g.desc}</span>}
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

      <CommodityVolatilityChart catalog={data?.catalog ?? catalog} />

      {!data ? (
        <Unavailable title="VietnamBiz Data chưa phản hồi bảng giá" meta={meta} />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {catalog.map((d) => {
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
      )}
    </div>
  );
}
