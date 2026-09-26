"use client";

import Link from "next/link";
import { useMemo } from "react";
import { sectorOf, VN_SECTOR_MAP } from "@/lib/vn/master";
import type { IndexQuote, Quote } from "@/lib/types";
import { Chg, fmtCompact, fmtNum } from "@/components/ui";

/** Ưu tiên cột ngành giống SieuCoPhieu */
const PRIORITY_SECTORS = [
  "Ngân hàng",
  "Bất động sản",
  "Chứng khoán",
  "Thép",
  "Dầu khí",
  "Bán lẻ",
  "Bảo hiểm",
  "Công nghệ",
  "Thực phẩm & Đồ uống",
  "Điện lực",
  "Xây dựng & Vật liệu",
  "Hàng không & Vận tải",
];

/** Proxy VN30 — mã bluechip / thanh khoản cao thường trong VN30 */
const VN30_PROXY = new Set([
  "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
  "MBB", "MSN", "MWG", "PLX", "SAB", "SHB", "SSB", "SSI", "STB", "TCB",
  "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
]);

function hitsBand(price: number | null | undefined, band: number | null | undefined): boolean {
  if (price == null || band == null || Number.isNaN(price) || Number.isNaN(band)) return false;
  return Math.abs(price - band) <= 0.051;
}

function rowTone(qu: Quote): string {
  if (hitsBand(qu.price, qu.ceilingPrice)) return "bg-violet-500/20 text-violet-200";
  if (hitsBand(qu.price, qu.floorPrice)) return "bg-sky-400/20 text-sky-200";
  const p = qu.changePercent;
  if (p == null || !Number.isFinite(p)) return "bg-surface-elevated/40 text-text-secondary";
  if (p > 0.15) return "bg-emerald-500/20 text-emerald-200";
  if (p > 0) return "bg-emerald-500/10 text-emerald-300/90";
  if (p < -0.15) return "bg-rose-500/20 text-rose-200";
  if (p < 0) return "bg-rose-500/10 text-rose-300/90";
  return "bg-amber-500/10 text-amber-100/90";
}

function pctLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p > 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

type SectorCol = {
  name: string;
  avgPct: number | null;
  rows: Quote[];
};

function buildColumns(quotes: Quote[]): SectorCol[] {
  const bySym = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const vn30Rows = [...VN30_PROXY]
    .map((s) => bySym.get(s))
    .filter((q): q is Quote => Boolean(q))
    .sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));

  const cols: SectorCol[] = [];

  if (vn30Rows.length) {
    const withPct = vn30Rows.filter((q) => q.changePercent != null);
    const avg = withPct.length
      ? withPct.reduce((s, q) => s + (q.changePercent ?? 0), 0) / withPct.length
      : null;
    cols.push({
      name: "VN30",
      avgPct: avg,
      rows: vn30Rows.slice(0, 28),
    });
  }

  const sectorOrder = [
    ...PRIORITY_SECTORS,
    ...VN_SECTOR_MAP.map((s) => s.name).filter((n) => !PRIORITY_SECTORS.includes(n)),
  ];

  for (const name of sectorOrder) {
    if (cols.length >= 10) break;
    const rows = quotes
      .filter((q) => sectorOf(q.symbol) === name)
      .sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
    if (rows.length < 3) continue;
    const withPct = rows.filter((q) => q.changePercent != null);
    const avg = withPct.length
      ? withPct.reduce((s, q) => s + (q.changePercent ?? 0), 0) / withPct.length
      : null;
    cols.push({ name, avgPct: avg, rows: rows.slice(0, 24) });
  }

  return cols;
}

function IndexStrip({ indices, quotes }: { indices: IndexQuote[]; quotes: Quote[] }) {
  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    let flat = 0;
    for (const q of quotes) {
      const p = q.changePercent;
      if (p == null) continue;
      if (p > 0.05) up++;
      else if (p < -0.05) down++;
      else flat++;
    }
    return { up, down, flat };
  }, [quotes]);

  const list = indices.slice(0, 4);
  if (!list.length) return null;

  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:gap-2">
      {list.map((i, idx) => {
        const up = (i.changePercent ?? 0) >= 0;
        return (
          <div
            key={i.code}
            className={`rounded-lg border px-2.5 py-2 ${
              idx === 0
                ? "border-accent-primary/35 bg-accent-primary/5"
                : "border-border-subtle bg-surface-elevated/50"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  idx === 0 ? "text-accent-primary" : "text-text-muted"
                }`}
              >
                {i.code}
              </span>
              <Chg value={i.changePercent} arrow={false} className="text-[11px]" />
            </div>
            <div
              className={`num mt-0.5 text-[16px] font-semibold sm:text-[18px] ${
                up ? "text-up" : "text-down"
              }`}
            >
              {fmtNum(i.value, 2)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-text-muted">
              {i.volume != null ? <span className="num">GT {fmtCompact(i.volume)}</span> : null}
              {idx === 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-up">▲ {breadth.up}</span>
                  <span className="text-amber-300">● {breadth.flat}</span>
                  <span className="text-down">▼ {breadth.down}</span>
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectorColumn({ col }: { col: SectorCol }) {
  const avgUp = (col.avgPct ?? 0) >= 0;
  return (
    <div className="flex min-w-[148px] max-w-[200px] flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-base/80">
      <div className="flex items-center justify-between gap-1 border-b border-border-subtle bg-surface-elevated/60 px-2 py-1.5">
        <span className="truncate text-[11px] font-semibold text-text-primary" title={col.name}>
          {col.name}
        </span>
        <span className={`num shrink-0 text-[11px] font-medium ${avgUp ? "text-up" : "text-down"}`}>
          {pctLabel(col.avgPct)}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-1 border-b border-border-subtle/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-text-muted">
        <span>Mã</span>
        <span className="text-right">Giá</span>
        <span className="text-right">+/-</span>
        <span className="text-right">KL</span>
      </div>
      <div className="max-h-[min(62vh,520px)] overflow-y-auto overscroll-contain">
        {col.rows.map((q) => (
          <Link
            key={q.symbol}
            href={`/stocks/${q.symbol}`}
            className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-1 px-1.5 py-[3px] text-[11px] transition hover:brightness-110 ${rowTone(q)}`}
          >
            <span className="truncate font-semibold tracking-tight">{q.symbol}</span>
            <span className="num text-right tabular-nums">{fmtNum(q.price, 2)}</span>
            <span className="num min-w-[3.2rem] text-right tabular-nums">{pctLabel(q.changePercent)}</span>
            <span className="num min-w-[2.4rem] text-right text-[10px] opacity-80">
              {q.volume != null ? fmtCompact(q.volume) : "—"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BangDienBoard({
  quotes,
  indices,
}: {
  quotes: Quote[];
  indices: IndexQuote[];
}) {
  const columns = useMemo(() => buildColumns(quotes), [quotes]);

  if (!quotes.length) {
    return (
      <p className="rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-4 text-center text-[12px] text-text-muted">
        Chưa có dữ liệu bảng giá để dựng bảng điện.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <IndexStrip indices={indices} quotes={quotes} />

      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10.5px] text-text-muted">
          Bảng điện theo ngành · tô màu tăng/giảm/trần/sàn · click mã để mở chi tiết
        </p>
        <span className="hidden text-[10px] text-text-muted sm:inline">
          {quotes.length} mã · {columns.length} cột
        </span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {columns.map((col) => (
          <SectorColumn key={col.name} col={col} />
        ))}
      </div>
    </div>
  );
}
