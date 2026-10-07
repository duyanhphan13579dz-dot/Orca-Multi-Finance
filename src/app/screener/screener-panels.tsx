"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP, sectorOf } from "@/lib/vn/master";
import type { CryptoMarketRow, Quote, IndexQuote } from "@/lib/types";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";

type StocksData = { indices: IndexQuote[] | null; quotes: Quote[] | null };

const VN_BOARD =
  "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD";

export function Field({
  label,
  value,
  onChange,
  small,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  small?: boolean;
}) {
  return (
    <label>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input text-[12px] ${small ? "!w-24 !py-1.5" : "!w-28 !py-1.5"}`}
        inputMode="decimal"
      />
    </label>
  );
}

export function VnScreener({ defaultSector }: { defaultSector: string | null }) {
  const { res, data, meta, isLoading, isValidating, mutate } = useApi<StocksData>(`/api/v1/stocks?symbols=${VN_BOARD}`, {
    refreshInterval: 20_000,
  });
  const [sector, setSector] = useState(defaultSector ?? "");
  const [minChg, setMinChg] = useState("");
  const [maxChg, setMaxChg] = useState("");
  const [minVol, setMinVol] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ sector: defaultSector ?? "", minChg: "", maxChg: "", minVol: "", q: "" });
  const [pressed, setPressed] = useState(false);

  const rows = useMemo(() => {
    let list = data?.quotes ?? [];
    if (applied.sector) list = list.filter((row) => sectorOf(row.symbol) === applied.sector);
    if (applied.minChg) list = list.filter((row) => (row.changePercent ?? 0) >= Number(applied.minChg));
    if (applied.maxChg) list = list.filter((row) => (row.changePercent ?? 0) <= Number(applied.maxChg));
    if (applied.minVol)
      list = list.filter((row) => (row.quoteVolume ?? row.volume ?? 0) >= Number(applied.minVol) * 1_000_000);
    const needle = (q || applied.q).trim().toUpperCase();
    if (needle) {
      const parts = needle.split(/[\s,;]+/).filter(Boolean);
      list = list.filter((row) =>
        parts.some(
          (p) =>
            row.symbol.includes(p) ||
            (row.name ?? "").toUpperCase().includes(p) ||
            (sectorOf(row.symbol) ?? "").toUpperCase().includes(p),
        ),
      );
    }
    return [...list].sort((a, b) => (b.quoteVolume ?? b.volume ?? 0) - (a.quoteVolume ?? a.volume ?? 0));
  }, [data, applied, q]);

  const run = useCallback(() => {
    setPressed(true);
    setApplied({ sector, minChg, maxChg, minVol, q });
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  }, [sector, minChg, maxChg, minVol, q, mutate]);

  if (isLoading && !res) return <Loading rows={8} />;
  if (!res?.success) {
    return (
      <>
        <Panel title="Bộ lọc cổ phiếu Việt Nam" pad={false}>
          <div className="p-3 text-[12px] text-text-muted">Đang tải bộ lọc…</div>
        </Panel>
        <Unavailable title="VNStock chưa kết nối" note={res && !res.success ? res.error.message : undefined} />
      </>
    );
  }
  return (
    <>
      <Panel
        title={
          <span>
            Kết quả: {rows.length} mã <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            {isValidating ? <span className="ml-1.5 text-[10px] text-accent-primary">· đang cập nhật</span> : null}
          </span>
        }
        pad={false}
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Tìm mã</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="VCB, FPT…" className="input !w-32 !py-1.5 text-[12px]" />
          </label>
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
              <option value="">Tất cả</option>
              {VN_SECTOR_MAP.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <Field label="Δ% min" value={minChg} onChange={setMinChg} small />
          <Field label="Δ% max" value={maxChg} onChange={setMaxChg} small />
          <Field label="GT min (tỷ)" value={minVol} onChange={setMinVol} small />
          <button type="button" onClick={run} className={`rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white ${pressed ? "bg-accent-primary" : "bg-accent-primary/90"}`}>
            {isValidating ? "Đang lọc…" : "Tìm kiếm"}
          </button>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                <th className="px-3.5 py-2 font-medium">Mã</th>
                <th className="py-2 font-medium">Ngành</th>
                <th className="py-2 text-right font-medium">Giá</th>
                <th className="py-2 text-right font-medium">± %</th>
                <th className="py-2 pr-3.5 text-right font-medium">GT GD</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3.5 py-6 text-center text-text-muted">Không có mã khớp.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.symbol} className="row-hover border-b border-line/40">
                  <td className="px-3.5 py-2"><Link href={`/stocks/${row.symbol}`} className="font-semibold hover:text-accent">{row.symbol}</Link></td>
                  <td className="py-2 text-[11px] text-text-muted">{sectorOf(row.symbol)}</td>
                  <td className="num py-2 text-right">{fmtNum(row.price, 2)}</td>
                  <td className="py-2 text-right"><Chg value={row.changePercent} arrow={false} /></td>
                  <td className="num py-2 pr-3.5 text-right text-ink-2">{fmtCompact(row.quoteVolume ?? row.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-line/50 md:hidden">
          {rows.map((row) => (
            <Link key={row.symbol} href={`/stocks/${row.symbol}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-panel-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{row.symbol}</span>
                <span className="mt-0.5 block truncate text-[10px] text-text-muted">{sectorOf(row.symbol)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block text-[13px]">{fmtNum(row.price, 2)}</span>
                <Chg value={row.changePercent} arrow={false} className="text-[11px]" />
              </span>
            </Link>
          ))}
        </div>
        <div className="border-t border-line px-3.5 py-2"><MetaLine meta={meta} /></div>
      </Panel>
    </>
  );
}

export function CryptoScreener() {
  const [url] = useState("/api/v1/screener?universe=crypto&limit=40");
  const { res, data, meta, isLoading } = useApi<{ universe: string; rows: CryptoMarketRow[] }>(url, {
    refreshInterval: 30_000,
  });
  if (isLoading && !res) return <Loading rows={8} />;
  if (!data) return <Unavailable title="Screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />;
  return (
    <Panel title={`Crypto: ${data.rows.length} mã`} pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
              <th className="px-3.5 py-2">Mã</th>
              <th className="py-2 text-right">Giá</th>
              <th className="py-2 text-right">24h %</th>
              <th className="py-2 pr-3.5 text-right">Vol</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.symbol} className="row-hover border-b border-line/40">
                <td className="px-3.5 py-2"><Link href={`/crypto/${r.symbol}`} className="font-semibold hover:text-accent">{r.baseAsset}</Link></td>
                <td className="num py-2 text-right">{fmtNum(r.price, priceDigits(r.price))}</td>
                <td className="py-2 text-right"><Chg value={r.changePercent} arrow={false} /></td>
                <td className="num py-2 pr-3.5 text-right text-ink-2">{fmtCompact(r.quoteVolume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-3.5 py-2"><MetaLine meta={meta} /></div>
    </Panel>
  );
}
