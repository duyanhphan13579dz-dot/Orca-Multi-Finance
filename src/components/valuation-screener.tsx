"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

type Row = { symbol: string; sector: string | null; price: number | null; pe: number | null; pb: number | null; ps: number | null; eps: number | null; reportDate: string | null; score: number };
type Data = { rows: Row[]; scanned: number; skipped: number };

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label><span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">{label}</span><input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="num input !w-20 !py-1.5 text-[12px]" /></label>;
}
function multiple(value: number | null) { return value == null ? "—" : value.toFixed(2); }

export function ValuationScreener({ defaultSector }: { defaultSector: string | null }) {
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [minPe, setMinPe] = useState(""); const [maxPe, setMaxPe] = useState("");
  const [minPb, setMinPb] = useState(""); const [maxPb, setMaxPb] = useState("");
  const [minPs, setMinPs] = useState(""); const [maxPs, setMaxPs] = useState("");
  const [query, setQuery] = useState("/api/v1/screener/valuation");
  const { res, data, meta, isLoading, isValidating } = useApi<Data>(query, { refreshInterval: 300_000, timeoutMs: 120_000 });
  const run = useCallback(() => {
    const qs = new URLSearchParams();
    if (sector) qs.set("sector", sector); if (symbols) qs.set("symbols", symbols);
    for (const [key, value] of Object.entries({ minPe, maxPe, minPb, maxPb, minPs, maxPs })) if (value) qs.set(key, value);
    qs.set("_", String(Date.now())); setQuery(`/api/v1/screener/valuation?${qs}`);
  }, [sector, symbols, minPe, maxPe, minPb, maxPb, minPs, maxPs]);
  return <div className="space-y-3">
    <Panel title="Định giá P · P/E, P/B, P/S">
      <p className="mb-3 max-w-4xl text-[12px] leading-relaxed text-text-muted">Sàng lọc cổ phiếu theo bội số định giá: P/E so sánh giá với lợi nhuận, P/B với giá trị sổ sách, và P/S với doanh thu. Bội số thấp không tự động đồng nghĩa với rẻ — hãy đối chiếu tăng trưởng, chất lượng lợi nhuận, nợ và ngành.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="P/E từ" value={minPe} onChange={setMinPe}/><Field label="P/E đến" value={maxPe} onChange={setMaxPe}/>
        <Field label="P/B từ" value={minPb} onChange={setMinPb}/><Field label="P/B đến" value={maxPb} onChange={setMaxPb}/>
        <Field label="P/S từ" value={minPs} onChange={setMinPs}/><Field label="P/S đến" value={maxPs} onChange={setMaxPs}/>
        <label><span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span><select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-36 !py-1.5 text-[12px]"><option value="">Tất cả</option>{VN_SECTOR_MAP.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select></label>
        <label><span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Mã</span><input value={symbols} onChange={(e) => setSymbols(e.target.value)} placeholder="VCB,FPT…" className="input !w-32 !py-1.5 text-[12px]" /></label>
        <button type="button" onClick={run} disabled={isValidating} className="inline-flex items-center gap-1.5 rounded-md bg-accent-primary px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"><Play className="size-3.5"/>{isValidating ? "Đang quét…" : "Quét định giá"}</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-muted"><MetaLine meta={meta}/>{data ? <span>{data.rows.length} mã · quét {data.scanned} · bỏ {data.skipped}</span> : null}<FreshnessDot status={meta?.freshness}/></div>
    </Panel>
    {isLoading && !data ? <Loading rows={8}/> : !res?.success && !data ? <Unavailable title="Screener định giá không khả dụng" note={res && !res.success ? res.error.message : undefined}/> : <Panel title={`Kết quả · ${data?.rows.length ?? 0} mã`}>
      <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-[12px]"><thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted"><th className="py-2 pr-3">Mã</th><th className="py-2 pr-3">Ngành</th><th className="py-2 text-right">Giá</th><th className="py-2 text-right">P/E</th><th className="py-2 text-right">P/B</th><th className="py-2 text-right">P/S</th><th className="py-2 pl-3 text-right">Ngày dữ liệu</th></tr></thead><tbody>{data?.rows.map((row) => <tr key={row.symbol} className="row-hover border-b border-line/40"><td className="py-2 pr-3"><Link href={`/stocks/${row.symbol}`} className="font-semibold hover:text-accent">{row.symbol}</Link></td><td className="py-2 pr-3 text-[11px] text-text-muted">{row.sector ?? "—"}</td><td className="num py-2 text-right">{row.price?.toFixed(2) ?? "—"}</td><td className="num py-2 text-right">{multiple(row.pe)}</td><td className="num py-2 text-right">{multiple(row.pb)}</td><td className="num py-2 text-right">{multiple(row.ps)}</td><td className="py-2 pl-3 text-right text-[11px] text-text-muted">{row.reportDate ?? "—"}</td></tr>)}</tbody></table></div>
      {!data?.rows.length ? <p className="py-5 text-center text-[12px] text-text-muted">Không có mã khớp điều kiện định giá.</p> : null}
    </Panel>}
  </div>;
}
