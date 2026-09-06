"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { OrcaChart } from "@/components/orca-chart";
import CommodityDetailView from "@/components/commodity-detail";
import type { CommodityMarket } from "@/lib/services/commodities";
import type { CommodityDef } from "@/lib/providers/commodities";
import type { FreshnessStatus } from "@/lib/types";
import { Badge, Chg, fmtNum, fmtLocale, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { AddToWatchlist } from "@/components/watchlist-button";
import { CurrencyConverter, convertClient, useFxRates } from "@/components/currency-converter";
import { Boxes, CalendarDays, LineChart, Search, X } from "lucide-react";

/**
 * COMMODITIES — sleek world-class UI/UX:
 * command-style search, polished date-range picker on the gold chart,
 * uniform cards, honest per-source provenance.
 *
 * UI/UX STABLE CONTRACT — appearance is frozen. Data flow upgrades only:
 * price + change come from VietnamBiz Data (data.vietnambiz.vn/goods — WiFeed);
 * chọn/chạm một hàng hóa → mở LANDING PAGE NỔI (floating overlay) với chi tiết
 * đầy đủ (quote, performance, chart, provenance, tác động ngành) — cùng dữ
 * liệu với route /commodities/:key. Nhấn Esc / nền tối / X để đóng.
 */

type Data = CommodityMarket & {
  catalog: {
    key: string;
    name: string;
    nameVi: string;
    group: string;
    category: string;
    subcategory: string | null;
    symbol: string;
    unit: string;
    hasChart: boolean;
    vnImpact: CommodityDef["vnImpact"];
  }[];
};

/** NHÓM theo đúng bảng /goods (6 nhóm). */
const GROUPS: { key: string; title: string; desc: string }[] = [
  { key: "", title: "Tất cả", desc: "" },
  { key: "consumer", title: "Hàng tiêu dùng", desc: "Heo · Gạo · Cà phê" },
  { key: "metals", title: "Kim loại & phi kim", desc: "Vàng · Đồng · Nhôm" },
  { key: "chemicals", title: "Hóa chất", desc: "Ure · Xút · Lưu huỳnh" },
  { key: "construction", title: "Vật liệu xây dựng", desc: "Thép · Đá · Xi măng" },
  { key: "energy", title: "Năng lượng", desc: "Dầu · Gas · Xăng dầu" },
  { key: "plastics", title: "Nhựa & cao su", desc: "PVC · PP · PET" },
];

const DATE_RANGES: { label: string; tf: string; limit: number }[] = [
  { label: "1D", tf: "1h", limit: 96 },
  { label: "1W", tf: "4h", limit: 168 },
  { label: "1M", tf: "1d", limit: 32 },
  { label: "3M", tf: "1d", limit: 95 },
  { label: "1Y", tf: "1d", limit: 250 },
];

export default function CommoditiesPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [chart, setChart] = useState<string | null>(null);
  const [range, setRange] = useState(DATE_RANGES[1]); // 1W default
  const [detail, setDetail] = useState<string | null>(null); // selected commodity key → floating overlay
  const { data, meta, isLoading } = useApi<Data>("/api/v1/commodities", { refreshInterval: 3_000 });
  const fx = useFxRates();
  const [displayCurrency, setDisplayCurrency] = useState<string>(""); // "" = giá gốc nguồn

  // Esc closes the floating landing page; lock body scroll while open
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [detail]);

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
  const byUnavailable = useMemo(() => new Map((data?.unavailable ?? []).map((u) => [u.key, u])), [data]);
  /** WiFeed /goods không có OHLC → hasChart=false với mọi mục → không có chart từ nguồn khác */
  const chartable = useMemo(() => new Set((data?.catalog ?? []).filter((d) => d.hasChart).map((d) => d.symbol)), [data]);
  const chartDef = chart ? data?.catalog.find((d) => d.symbol === chart && d.hasChart) : null;

  /** đơn vị vật lý từ unit nguồn ("CNY/tấn" → "tấn"; "USD/ounce" → "ounce"). */
  const physUnit = (unit: string | null | undefined) => {
    const u = (unit ?? "").trim();
    const i = u.indexOf("/");
    const p = i >= 0 ? u.slice(i + 1).trim() : "";
    return p && !/^(VNĐ|VND|USD|CNY|JPY|MYR|EUR|GBP)$/i.test(p) ? p : u;
  };

  /** giá row quy đổi sang displayCurrency (null = không đổi được / đang chọn gốc). */
  const convertedRow = (rowPrice: number, rowCurrency: string | null | undefined): number | null => {
    if (!displayCurrency || !fx.rates) return null;
    const cur = (rowCurrency ?? "").toUpperCase();
    if (!cur || !fx.rates.currencies.some((c) => c.code === cur)) return null;
    if (cur === displayCurrency) return rowPrice;
    return convertClient(rowPrice, cur, displayCurrency, fx.rates.rates);
  };

  const fmtConverted = (v: number) =>
    v.toLocaleString(fmtLocale(), {
      minimumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6,
      maximumFractionDigits: v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6,
    });

  if (isLoading && !data) return <Loading rows={10} />;

  return (
    <div className="space-y-3">
      {/* hero + search bar (sleek command surface) */}
      <div className="panel overflow-visible p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Boxes className="size-5 text-accent-primary" /> Hàng hóa
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </h1>
          <div className="relative ml-auto w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm hàng hóa: vàng, dầu, cà phê…"
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
          {fx.rates && fx.rates.currencies.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[10.5px] text-text-muted">Giá hiển thị theo</span>
              <select
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value)}
                className="rounded-lg border border-border-subtle bg-surface-elevated px-2 py-1 text-[11px] text-text-secondary outline-none focus:border-accent-primary/50"
                aria-label="Chọn tiền tệ hiển thị giá"
              >
                <option value="">Gốc (nguồn WiFeed)</option>
                {fx.rates.currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.label}</option>
                ))}
              </select>
            </span>
          )}
          <span className="ml-auto hidden md:block"><MetaLine meta={meta} /></span>
        </div>
      </div>

      {/* commodity chart with polished date range picker (same container) */}
      {chartDef && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
            <LineChart className="size-4 text-accent-primary" />
            <span className="text-[13px] font-semibold">{chartDef.nameVi} · {chartDef.symbol}</span>
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
              title={chartDef.symbol}
            />
          </div>
        </div>
      )}

      {/* MÁY TÍNH QUY ĐỔI TIỀN TỆ — tra giá hàng hóa theo 1 đồng tiền */}
      <CurrencyConverter />

      {/* cards grid */}
      {!data ? (
        <Unavailable title="Chưa có nguồn hàng hóa nào phản hồi" meta={meta} />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {catalog.map((d) => {
            const row = bySymbol.get(d.symbol);
            const groupMeta = GROUPS.find((x) => x.key === d.group);
            const openDetail = () => setDetail(d.key);
            if (!row) {
              const un = byUnavailable.get(d.key);
              return (
                <div key={d.key} className="panel flex items-center justify-between p-3 opacity-60">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{d.nameVi}</div>
                    <div className="text-[10px] text-text-muted">{d.symbol} · {groupMeta?.title}</div>
                    {un?.reason && <div className="mt-1 line-clamp-2 text-[9.5px] leading-snug text-text-muted">{un.reason}</div>}
                  </div>
                  <span title={un?.reason ?? undefined}><Badge tone="warn">UNAVAILABLE</Badge></span>
                </div>
              );
            }
            const dgt = row.price >= 1000 ? 0 : 2;
            const up = (row.changePercent ?? 0) > 0;
            const hasChart = chartable.has(d.symbol);
            return (
              <div
                key={d.key}
                className="panel hover-lift relative overflow-hidden p-3 cursor-pointer"
                onClick={openDetail}
                aria-label={`Xem chi tiết ${d.nameVi}`}
              >
                <div className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] ${up ? "bg-positive" : (row.changePercent ?? 0) < 0 ? "bg-negative" : "bg-border-default"}`} />
                <div className="flex items-start justify-between gap-2 pl-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold">{d.nameVi}</span>
                      <span className="text-[9.5px] uppercase tracking-wider text-text-muted">{groupMeta?.title}</span>
                      {row.freshness && <FreshnessDot status={row.freshness as FreshnessStatus} />}
                    </div>
                    <div className="text-[10px] text-text-muted">{d.symbol} · {row.unit}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span onClick={(e) => e.stopPropagation()}><AddToWatchlist assetType="commodity" symbol={d.symbol} /></span>
                    {hasChart && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setChart(chart === d.symbol ? null : d.symbol); }}
                        className={`rounded-md border p-1 ${chart === d.symbol ? "border-accent-primary/50 text-accent-primary" : "border-border-subtle text-text-muted hover:text-text-primary"}`}
                        aria-label="Mở chart"
                      >
                        <LineChart className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-baseline justify-between pl-1.5">
                  <span className="text-left">
                    <span className="num text-[19px] font-semibold tracking-tight">
                      {convertedRow(row.price, row.currency) != null
                        ? fmtConverted(convertedRow(row.price, row.currency)!)
                        : fmtNum(row.price, dgt)}
                      <span className="ml-1 text-[10px] font-normal text-text-muted">
                        {convertedRow(row.price, row.currency) != null ? displayCurrency : row.currency}
                      </span>
                    </span>
                    {convertedRow(row.price, row.currency) != null && (
                      <span className="block text-[9.5px] text-text-muted">
                        ≈ {fmtNum(row.price, dgt)} {row.currency}/{physUnit(row.unit)} (tỷ giá WiFeed)
                      </span>
                    )}
                  </span>
                  <Chg value={row.changePercent} className="text-[12px]" arrow={false} />
                </div>
                <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-1.5 pl-1.5">
                  {row.sourceRecords.map((s) => (
                    <div key={s.source} className="flex items-center justify-between text-[10px] text-text-muted">
                      <span className="truncate">{s.source}</span>
                      <span className="num">
                        {fmtNum(s.price, dgt)}
                        {s.timestamp && <> · {new Date(s.timestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</>}
                      </span>
                    </div>
                  ))}
                </div>
                {d.vnImpact && (
                  <p className="mt-1.5 rounded-md bg-surface-elevated p-1.5 pl-3 text-[10.5px] leading-relaxed text-text-muted">
                    <span className="text-text-secondary">{d.vnImpact.sector}</span>
                    {d.vnImpact.stocks.length > 0 && <> · {d.vnImpact.stocks.map((s) => <b key={s} className="text-accent-primary/90"> {s}</b>)}</>}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && data.unavailable.length > 0 && (
        <div className="space-y-1 text-[11px] text-text-muted">
          <p>
            {data.unavailable.length} mặt hàng chưa có nguồn (VietnamBiz Data / WiFeed) — hệ thống không mock data.
            {data.sourcesUsed.length > 0 && <> · nguồn đang dùng: {data.sourcesUsed.join(", ")}</>}
          </p>
          {data.errors?.[0] && (
            <p className="text-[10px] text-warning/90">Lỗi nguồn: {data.errors[0]}</p>
          )}
        </div>
      )}

      {/* LANDING PAGE NỔI — floating overlay khi chọn/chạm một hàng hóa */}
      {detail && <CommodityLandingOverlay symbol={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Floating landing-page overlay: same content as /commodities/:key, fits the design. */
function CommodityLandingOverlay({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={`Chi tiết ${symbol}`} onClick={onClose}>
      <div className="panel relative my-auto w-full max-w-3xl rounded-2xl p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between rounded-t-xl bg-surface-base/95 px-1 pb-2 pt-1 backdrop-blur">
          <span className="text-[11px] uppercase tracking-wider text-text-muted">Landing · {symbol}</span>
          <div className="flex items-center gap-2">
            <Link href={`/commodities/${symbol.toLowerCase()}`} className="inline-flex items-center rounded-md border border-border-subtle px-2 py-1 text-[10.5px] text-text-muted hover:text-text-primary" onClick={onClose}>
              Mở trang đầy đủ
            </Link>
            <button onClick={onClose} className="rounded-md border border-border-subtle p-1 text-text-muted hover:text-text-primary" aria-label="Đóng">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
        <CommodityDetailView symbol={symbol} compact />
      </div>
    </div>
  );
}
