"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { OrcaChart } from "@/components/orca-chart";
import type { CommodityMarket } from "@/lib/services/commodities";
import type { CommodityDef } from "@/lib/providers/commodities";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { AddToWatchlist } from "@/components/watchlist-button";
import { Boxes, CalendarDays, LineChart, Search, X } from "lucide-react";

/**
 * COMMODITIES — VietnamBiz only.
 * Bảng giá hàng hóa trong nước, uniform cards, nguồn duy nhất VietnamBiz.
 */

type Data = CommodityMarket & { catalog: { key: string; name: string; nameVi: string; group: string; symbol: string; unit: string; vnImpact: CommodityDef["vnImpact"] }[] };

const GROUPS: { key: string; title: string; desc: string }[] = [
  { key: "", title: "Tất cả", desc: "" },
  { key: "vietnam", title: "Vàng SJC", desc: "SJC" },
  { key: "energy", title: "Năng lượng", desc: "Xăng · Diesel · Gas" },
  { key: "agriculture", title: "Nông sản", desc: "Cà phê · Tiêu · Cao su · Heo" },
  { key: "industrial", title: "Công nghiệp", desc: "Thép" },
];

const DATE_RANGES: { label: string; tf: string; limit: number }[] = [
  { label: "1D", tf: "15m", limit: 96 },
  { label: "1W", tf: "1h", limit: 168 },
  { label: "1M", tf: "1d", limit: 32 },
  { label: "3M", tf: "1d", limit: 95 },
  { label: "1Y", tf: "1d", limit: 250 },
];

/** VietnamBiz boards are price snapshots — no OHLC history chart from this source. */
const CHARTABLE: Record<string, { symbol: string; title: string }> = {};

export default function CommoditiesPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [chart, setChart] = useState<string | null>(null);
  const [range, setRange] = useState(DATE_RANGES[1]);
  const { data, meta, isLoading } = useApi<Data>("/api/v1/commodities", { refreshInterval: 5 * 60_000 });

  const catalog = useMemo(() => {
    let defs = data?.catalog ?? [];
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
  const chartDef = chart ? CHARTABLE[chart] : null;

  if (isLoading && !data) return <Loading rows={10} />;

  return (
    <div className="space-y-3">
      <div className="panel overflow-visible p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Boxes className="size-5 text-accent-primary" /> Hàng hóa
            <Badge tone="neutral">VietnamBiz</Badge>
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </h1>
          <div className="relative ml-auto w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm: vàng SJC, cà phê, xăng, heo…"
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
          {GROUPS.map((g) => (
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
      </div>

      {chartDef && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
            <LineChart className="size-4 text-accent-primary" />
            <span className="text-[13px] font-semibold">{chartDef.title}</span>
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-elevated p-1">
              <CalendarDays className="ml-1 size-3.5 text-text-muted" />
              {DATE_RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    range.label === r.label ? "bg-accent-primary/15 text-accent-primary" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-1.5">
            <OrcaChart
              key={`${chartDef.symbol}-${range.tf}-${range.limit}`}
              symbol={chartDef.symbol}
              assetType="commodity"
              defaultTimeframe={range.tf}
              height={380}
              title={chartDef.title}
            />
          </div>
        </div>
      )}

      {!data ? (
        <Unavailable title="VietnamBiz chưa phản hồi bảng giá hàng hóa" meta={meta} />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {catalog.map((d) => {
            const row = bySymbol.get(d.symbol);
            const groupMeta = GROUPS.find((x) => x.key === d.group);
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
            const dgt = row.price >= 1000 ? 0 : 2;
            const up = (row.changePercent ?? 0) > 0;
            const hasChart = Boolean(CHARTABLE[d.symbol]);
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
                      <span className="text-[13.5px] font-semibold">{d.nameVi}</span>
                      <span className="text-[9.5px] uppercase tracking-wider text-text-muted">{groupMeta?.title}</span>
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {d.symbol} · {row.unit}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <AddToWatchlist assetType="commodity" symbol={d.symbol} />
                    {hasChart && (
                      <button
                        onClick={() => setChart(chart === d.symbol ? null : d.symbol)}
                        className={`rounded-md border p-1 ${
                          chart === d.symbol
                            ? "border-accent-primary/50 text-accent-primary"
                            : "border-border-subtle text-text-muted hover:text-text-primary"
                        }`}
                        aria-label="Mở chart"
                      >
                        <LineChart className="size-3.5" />
                      </button>
                    )}
                  </div>
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
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {d.vnImpact && (
                  <p className="mt-1.5 rounded-md bg-surface-elevated p-1.5 pl-3 text-[10.5px] leading-relaxed text-text-muted">
                    <span className="text-text-secondary">{d.vnImpact.sector}</span>
                    {d.vnImpact.stocks.length > 0 && (
                      <>
                        {" "}·{" "}
                        {d.vnImpact.stocks.map((s) => (
                          <b key={s} className="text-accent-primary/90">
                            {" "}
                            {s}
                          </b>
                        ))}
                      </>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && data.unavailable.length > 0 && (
        <p className="text-[11px] text-text-muted">
          {data.unavailable.length} mặt hàng chưa parse được từ VietnamBiz — hệ thống không mock data.
        </p>
      )}
    </div>
  );
}
