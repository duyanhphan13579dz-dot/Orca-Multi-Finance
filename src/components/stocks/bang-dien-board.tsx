"use client";

import "./bang-dien.css";
import { memo, useMemo } from "react";
import { SectorCompareChart } from "@/components/stocks/sector-compare-chart";
import { SectorScrollRail, SectorColumnShell } from "@/components/stocks/sector-scroll-rail";
import { sectorOf, VN_SECTOR_MAP } from "@/lib/vn/master";
import type { IndexQuote, Quote } from "@/lib/types";
import { useApi } from "@/lib/hooks";
import { Chg, fmtCompact, fmtNum } from "@/components/ui";

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

const VN30_PROXY = new Set([
  "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG",
  "MBB", "MSN", "MWG", "PLX", "SAB", "SHB", "SSB", "SSI", "STB", "TCB",
  "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
]);

type IntelLite = {
  condition?: {
    score?: number;
    rating?: string;
    confidence?: string;
    drivers?: string[];
    risks?: string[];
  };
  breadth?: {
    advancers?: number;
    decliners?: number;
    unchanged?: number;
    available?: boolean;
  };
  flow?: {
    foreignNet?: number | null;
    propNet?: number | null;
    available?: boolean;
  };
  session?: { labelVi?: string; trading?: boolean };
};

function hitsBand(price: number | null | undefined, band: number | null | undefined): boolean {
  if (price == null || band == null || Number.isNaN(price) || Number.isNaN(band)) return false;
  return Math.abs(price - band) <= 0.051;
}

function rowTone(qu: Quote): string {
  if (hitsBand(qu.price, qu.ceilingPrice)) return "bd-ceil";
  if (hitsBand(qu.price, qu.floorPrice)) return "bd-floor";
  const p = qu.changePercent;
  if (p == null || !Number.isFinite(p)) return "bd-flat";
  if (p > 0.15) return "bd-up-strong";
  if (p > 0) return "bd-up";
  if (p < -0.15) return "bd-down-strong";
  if (p < 0) return "bd-down";
  return "bd-flat";
}

function pctLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p > 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

function ratingVi(r?: string): string {
  switch (r) {
    case "BULLISH":
      return "Lạc quan";
    case "MODERATELY BULLISH":
      return "Nghiêng mua";
    case "NEUTRAL":
      return "Trung tính";
    case "MIXED":
      return "Trộn lẫn";
    case "MODERATELY BEARISH":
      return "Nghiêng bán";
    case "BEARISH":
      return "Bi quan";
    default:
      return r || "—";
  }
}

function volumeImbalance(rows: Quote[]): {
  buyVol: number;
  sellVol: number;
  flatVol: number;
  imbalance: number | null;
} {
  let buyVol = 0;
  let sellVol = 0;
  let flatVol = 0;
  for (const q of rows) {
    const v = q.volume ?? 0;
    if (!v || !Number.isFinite(v)) continue;
    const p = q.changePercent;
    if (p == null) {
      flatVol += v;
      continue;
    }
    if (p > 0.05) buyVol += v;
    else if (p < -0.05) sellVol += v;
    else flatVol += v;
  }
  const tot = buyVol + sellVol;
  const imbalance = tot > 0 ? (buyVol - sellVol) / tot : null;
  return { buyVol, sellVol, flatVol, imbalance };
}

type SectorCol = {
  name: string;
  avgPct: number | null;
  rows: Quote[];
  imbalance: number | null;
  buyVol: number;
  sellVol: number;
};

function buildColumns(quotes: Quote[]): SectorCol[] {
  const bySym = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const vn30Rows = [...VN30_PROXY]
    .map((s) => bySym.get(s))
    .filter((q): q is Quote => Boolean(q))
    .sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
  const cols: SectorCol[] = [];
  const pushCol = (name: string, rows: Quote[], limit: number) => {
    if (rows.length < 2) return;
    const slice = rows.slice(0, limit);
    const withPct = slice.filter((q) => q.changePercent != null);
    const avg = withPct.length
      ? withPct.reduce((s, q) => s + (q.changePercent ?? 0), 0) / withPct.length
      : null;
    const imb = volumeImbalance(slice);
    cols.push({
      name,
      avgPct: avg,
      rows: slice,
      imbalance: imb.imbalance,
      buyVol: imb.buyVol,
      sellVol: imb.sellVol,
    });
  };
  if (vn30Rows.length) pushCol("VN30", vn30Rows, 18);
  const sectorOrder = [
    ...PRIORITY_SECTORS,
    ...VN_SECTOR_MAP.map((s) => s.name).filter((n) => !PRIORITY_SECTORS.includes(n)),
  ];
  for (const name of sectorOrder) {
    if (cols.length >= 12) break;
    const rows = quotes
      .filter((q) => sectorOf(q.symbol) === name)
      .sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
    if (rows.length < 3) continue;
    pushCol(name, rows, 16);
  }
  return cols;
}

function SentimentGauge({ intel }: { intel: IntelLite | null | undefined }) {
  const score = intel?.condition?.score;
  const rating = intel?.condition?.rating;
  const conf = intel?.condition?.confidence;
  const breadth = intel?.breadth;
  const flow = intel?.flow;
  const s = score != null && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  const label = ratingVi(rating);
  const needle = s ?? 50;
  const tone = needle >= 62 ? "text-up" : needle <= 38 ? "text-down" : "text-amber-300";
  const denom =
    (breadth?.advancers ?? 0) + (breadth?.decliners ?? 0) + (breadth?.unchanged ?? 0);
  const buyPct = denom > 0 && breadth?.advancers != null ? (breadth.advancers / denom) * 100 : null;
  const sellPct = denom > 0 && breadth?.decliners != null ? (breadth.decliners / denom) * 100 : null;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[160px] flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Tâm lý thị trường</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`num text-[22px] font-bold tabular-nums ${tone}`}>{s != null ? Math.round(s) : "—"}</span>
            <span className={`text-[13px] font-semibold ${tone}`}>{label}</span>
            {conf ? <span className="text-[10px] text-text-muted">· tin cậy {conf}</span> : null}
          </div>
          <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500">
            <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-surface-base shadow" style={{ left: `${needle}%` }} title={`Score ${needle}`} />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-text-muted">
            <span>Bi quan</span><span>Trung tính</span><span>Lạc quan</span>
          </div>
        </div>
        <div className="grid min-w-[180px] flex-1 gap-1.5 sm:max-w-xs">
          <div>
            <div className="mb-0.5 flex justify-between text-[10px] text-text-muted">
              <span>Chờ mua <span className="text-up">{breadth?.advancers != null ? breadth.advancers : "?"}</span></span>
              <span>Chờ bán <span className="text-down">{breadth?.decliners != null ? breadth.decliners : "?"}</span></span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-base">
              <div className="bg-up/80 transition-all" style={{ width: `${buyPct ?? 33}%` }} />
              <div className="bg-amber-400/50 transition-all" style={{ width: `${Math.max(0, 100 - (buyPct ?? 33) - (sellPct ?? 33))}%` }} />
              <div className="bg-down/80 transition-all" style={{ width: `${sellPct ?? 33}%` }} />
            </div>
          </div>
          {flow?.available && (flow.foreignNet != null || flow.propNet != null) ? (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
              {flow.foreignNet != null ? (
                <span>Ngoại net <span className={flow.foreignNet >= 0 ? "text-up" : "text-down"}>{flow.foreignNet >= 0 ? "+" : ""}{fmtCompact(flow.foreignNet)}</span></span>
              ) : null}
              {flow.propNet != null ? (
                <span>Tự doanh <span className={flow.propNet >= 0 ? "text-up" : "text-down"}>{flow.propNet >= 0 ? "+" : ""}{fmtCompact(flow.propNet)}</span></span>
              ) : null}
            </div>
          ) : null}
          {intel?.condition?.drivers?.[0] ? (
            <p className="line-clamp-2 text-[10px] leading-snug text-text-secondary">{intel.condition.drivers[0]}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ImbalanceBar({ imbalance, buyVol, sellVol, compact }: { imbalance: number | null; buyVol: number; sellVol: number; compact?: boolean }) {
  const tot = buyVol + sellVol;
  const buyPct = tot > 0 ? (buyVol / tot) * 100 : 50;
  const label = imbalance == null ? "—" : imbalance > 0.15 ? "Mua áp đảo" : imbalance < -0.15 ? "Bán áp đảo" : "Cân bằng";
  const tone = imbalance == null ? "text-text-muted" : imbalance > 0.15 ? "text-up" : imbalance < -0.15 ? "text-down" : "text-amber-300";
  return (
    <div className={compact ? "px-0 pt-1.5" : ""}>
      <div className={`mb-1 flex items-center justify-between gap-1 ${compact ? "text-[11px]" : "text-[12px]"}`}>
        <span className={`truncate font-medium ${tone}`}>{label}</span>
        <span className={`num shrink-0 font-semibold tabular-nums ${tone}`}>{imbalance != null ? `${imbalance > 0 ? "+" : ""}${(imbalance * 100).toFixed(0)}%` : ""}</span>
      </div>
      <div className={`flex overflow-hidden rounded-full bg-surface-base/80 ${compact ? "h-1.5" : "h-2"}`}>
        <div className="bg-up/80 transition-all" style={{ width: `${buyPct}%` }} />
        <div className="bg-down/80 transition-all" style={{ width: `${100 - buyPct}%` }} />
      </div>
    </div>
  );
}

function IndexStrip({ indices, quotes }: { indices: IndexQuote[]; quotes: Quote[] }) {
  const breadth = useMemo(() => {
    let up = 0, down = 0, flat = 0;
    for (const q of quotes) {
      const p = q.changePercent;
      if (p == null) continue;
      if (p > 0.05) up++; else if (p < -0.05) down++; else flat++;
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
          <div key={i.code} className={`rounded-lg border px-2.5 py-2 ${idx === 0 ? "border-accent-primary/35 bg-accent-primary/5" : "border-border-subtle bg-surface-elevated/50"}`}>
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${idx === 0 ? "text-accent-primary" : "text-text-muted"}`}>{i.code}</span>
              <Chg value={i.changePercent} arrow={false} className="text-[11px]" />
            </div>
            <div className={`num mt-0.5 text-[16px] font-semibold sm:text-[18px] ${up ? "text-up" : "text-down"}`}>{fmtNum(i.value, 2)}</div>
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

const SectorColumn = memo(
  function SectorColumn({ col }: { col: SectorCol }) {
    const avgUp = (col.avgPct ?? 0) >= 0;
    const headerCls = avgUp ? "bd-col-head bd-col-head-up" : "bd-col-head bd-col-head-down";
    return (
      <div className="bd-col">
        <div className={headerCls}>
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-[13px] font-bold leading-snug text-text-primary" title={col.name}>
              {col.name}
            </span>
            <span className={`num shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold tabular-nums ${avgUp ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}>
              {pctLabel(col.avgPct)}
            </span>
          </div>
          <ImbalanceBar imbalance={col.imbalance} buyVol={col.buyVol} sellVol={col.sellVol} compact />
        </div>
        <div className="bd-col-labels">
          <span>Mã</span>
          <span className="text-right">Giá</span>
          <span className="min-w-[3.4rem] text-right">+/-</span>
          <span className="min-w-[2.6rem] text-right">KL</span>
        </div>
        <div className="bd-col-rows">
          {col.rows.map((q) => (
            <a key={q.symbol} href={`/stocks/${q.symbol}`} className={`bd-row ${rowTone(q)}`}>
              <span className="truncate font-bold tracking-tight">{q.symbol}</span>
              <span className="num text-right font-medium tabular-nums">{fmtNum(q.price, 2)}</span>
              <span className="num min-w-[3.4rem] text-right font-semibold tabular-nums">{pctLabel(q.changePercent)}</span>
              <span className="num min-w-[2.6rem] text-right text-[11px] opacity-80">{q.volume != null ? fmtCompact(q.volume) : "—"}</span>
            </a>
          ))}
        </div>
      </div>
    );
  },
  (prev, next) => {
    const a = prev.col;
    const b = next.col;
    if (a.name !== b.name || a.avgPct !== b.avgPct || a.imbalance !== b.imbalance) return false;
    if (a.rows.length !== b.rows.length) return false;
    for (let i = 0; i < a.rows.length; i++) {
      const ra = a.rows[i];
      const rb = b.rows[i];
      if (ra.symbol !== rb.symbol || ra.price !== rb.price || ra.changePercent !== rb.changePercent || ra.volume !== rb.volume) {
        return false;
      }
    }
    return true;
  },
);

export function BangDienBoard({ quotes, indices }: { quotes: Quote[]; indices: IndexQuote[] }) {
  const { data: intel } = useApi<IntelLite>("/api/v1/market/intel", { refreshInterval: 60_000 });
  const columns = useMemo(() => buildColumns(quotes), [quotes]);
  const fallbackIntel = useMemo((): IntelLite | null => {
    if (intel?.condition?.score != null) return intel;
    let up = 0, down = 0, flat = 0;
    for (const q of quotes) {
      const p = q.changePercent;
      if (p == null) continue;
      if (p > 0.05) up++; else if (p < -0.05) down++; else flat++;
    }
    const tot = up + down + flat;
    if (!tot) return intel ?? null;
    const ratio = (up - down) / tot;
    const score = Math.round(50 + ratio * 50);
    return {
      ...intel,
      condition: {
        score,
        rating: score >= 68 ? "BULLISH" : score >= 57 ? "MODERATELY BULLISH" : score > 43 ? "NEUTRAL" : score > 32 ? "MODERATELY BEARISH" : "BEARISH",
        confidence: "LOW",
        drivers: ["Ước lượng từ độ rộng bảng giá (thiếu market-intel đầy đủ)."],
      },
      breadth: { advancers: up, decliners: down, unchanged: flat, available: true },
    };
  }, [intel, quotes]);

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
      <SentimentGauge intel={fallbackIntel} />
      <SectorCompareChart cols={columns} />
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] text-text-muted">Bảng điện theo ngành · cuộn ngang · click mã mở chi tiết</p>
        <span className="hidden shrink-0 text-[11px] text-text-muted sm:inline">{quotes.length} mã · {columns.length} ngành</span>
      </div>
      <SectorScrollRail itemCount={columns.length}>
        {columns.map((col) => (
          <SectorColumnShell key={col.name}>
            <SectorColumn col={col} />
          </SectorColumnShell>
        ))}
      </SectorScrollRail>
    </div>
  );
}
