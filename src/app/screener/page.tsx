"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP, sectorOf } from "@/lib/vn/master";
import type { CryptoMarketRow, Quote, IndexQuote } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { FlatsIcon, Play } from "@/components/screener-icons";

type CryptoRows = { rows: CryptoMarketRow[] };
type StocksData = { indices: IndexQuote[] | null; quotes: Quote[] | null };

const VN_BOARD = "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD";

function ScreenerInner() {
  const params = useSearchParams();
  const [universe, setUniverse] = useState<"stocks" | "crypto">(params.get("universe") === "crypto" ? "crypto" : "stocks");
  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FlatsIcon /> Asset Screener
          </h1>
          <p className="mt-1 text-[12px] text-text-muted">
            Ưu tiên thị trường chứng khoán Việt Nam — chạy hoàn toàn trên dữ liệu thật mới nhất, không minh họa bằng dữ liệu giả.
          </p>
          <div className="seg mt-3">
            <button data-active={universe === "stocks"} onClick={() => setUniverse("stocks")}>Cổ phiếu VN ⭐</button>
            <button data-active={universe === "crypto"} onClick={() => setUniverse("crypto")}>Crypto</button>
          </div>
        </div>
      </Panel>
      {universe === "crypto" ? <CryptoScreener /> : <VnScreener defaultSector={params.get("sector")} />}
    </div>
  );
}

/* ------------------------------ VN screener ------------------------------- */

function VnScreener({ defaultSector }: { defaultSector: string | null }) {
  const { res, data, meta, isLoading } = useApi<StocksData>(`/api/v1/stocks?symbols=${VN_BOARD}`, { refreshInterval: 20_000 });
  const [sector, setSector] = useState(defaultSector ?? "");
  const [minChg, setMinChg] = useState("");
  const [maxChg, setMaxChg] = useState("");
  const [minVol, setMinVol] = useState("");

  const rows = useMemo(() => {
    let list = data?.quotes ?? [];
    if (sector) list = list.filter((q) => sectorOf(q.symbol) === sector);
    if (minChg) list = list.filter((q) => (q.changePercent ?? 0) >= Number(minChg));
    if (maxChg) list = list.filter((q) => (q.changePercent ?? 0) <= Number(maxChg));
    if (minVol) list = list.filter((q) => (q.quoteVolume ?? q.volume ?? 0) >= Number(minVol) * 1_000_000);
    return [...list].sort((a, b) => (b.quoteVolume ?? b.volume ?? 0) - (a.quoteVolume ?? a.volume ?? 0));
  }, [data, sector, minChg, maxChg, minVol]);

  if (isLoading && !res) return <Loading rows={8} />;
  if (!res?.success) {
    return (
      <>
        <Panel title="Bộ lọc cổ phiếu Việt Nam" pad={false}>
          <div className="flex flex-wrap items-end gap-2 p-3">
            <VnFilterSelect sector={sector} setSector={setSector} />
            <Field label="Δ% tối thiểu" value={minChg} onChange={setMinChg} />
            <Field label="Δ% tối đa" value={maxChg} onChange={setMaxChg} />
            <Field label="GT GD tối thiểu (tỷ đ)" value={minVol} onChange={setMinVol} />
          </div>
        </Panel>
        <Unavailable title="VNDirect chưa kết nối" note={res && !res.success ? res.error.message : undefined} />
      </>
    );
  }

  return (
    <>
      <Panel
        title={<span>Kết quả: {rows.length} mã <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} /></span>}
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            <VnFilterSelect sector={sector} setSector={setSector} />
            <Field label="Δ% min" value={minChg} onChange={setMinChg} small />
            <Field label="Δ% max" value={maxChg} onChange={setMaxChg} small />
            <Field label="GT min (tr VNĐ)" value={minVol} onChange={setMinVol} small />
          </div>
        }
        pad={false}
      >
        <div className="overflow-x-auto">
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
              {rows.map((q) => (
                <tr key={q.symbol} className="row-hover border-b border-line/40">
                  <td className="px-3.5 py-2"><Link href={`/stocks/${q.symbol}`} className="font-semibold hover:text-accent">{q.symbol}</Link></td>
                  <td className="py-2 text-[11px] text-text-muted">{sectorOf(q.symbol)}</td>
                  <td className="num py-2 text-right">{fmtNum(q.price, 2)}</td>
                  <td className="py-2 text-right"><Chg value={q.changePercent} arrow={false} /></td>
                  <td className="num py-2 pr-3.5 text-right text-ink-2">{fmtCompact(q.quoteVolume ?? q.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-3.5 py-2"><MetaLine meta={meta} /></div>
      </Panel>
      <Panel title="Chiến lược nâng cao — CANSLIM · Minervini · Wyckoff · Value">
        <div className="text-[12px] leading-relaxed text-ink-2">
          Rule engines chuyên sâu (growth momentum theo CANSLIM, nền tích lũy kiểu Minervini, điểm Wyckoff, value theo Graham-điều chỉnh VN) chạy trên cùng pipeline này khi Financial Statements từ VNDirect khả dụng — kết hợp Financial Health Engine + Valuation Engine đã triển khai.
          <Badge tone="warn" >roadmap</Badge>
        </div>
      </Panel>
    </>
  );
}

function VnFilterSelect({ sector, setSector }: { sector: string; setSector: (v: string) => void }) {
  return (
    <label>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span>
      <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
        <option value="">Tất cả ({VN_SECTOR_MAP.length} ngành)</option>
        {VN_SECTOR_MAP.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.symbols.length})</option>)}
      </select>
    </label>
  );
}

/* ----------------------------- crypto screener ----------------------------- */

const PRESETS = [
  { name: "Momentum mạnh", desc: "tăng ≥3% & vol ≥ $50M", params: "minChange=3&minQuoteVolume=50000000&sort=gainers" },
  { name: "Bị bán mạnh", desc: "giảm ≤-4% & vol ≥ $30M", params: "maxChange=-4&minQuoteVolume=30000000&sort=losers" },
  { name: "Dòng tiền lớn", desc: "vol ≥ $500M", params: "minQuoteVolume=500000000" },
] as const;

function CryptoScreener() {
  const [url, setUrl] = useState("/api/v1/screener?universe=crypto&limit=40");
  const [minChange, setMinChange] = useState("");
  const [maxChange, setMaxChange] = useState("");
  const [minVol, setMinVol] = useState("");
  const { res, data, meta, isLoading } = useApi<{ universe: string; rows: CryptoMarketRow[] }>(url, { refreshInterval: 30_000 });

  const run = () => {
    const p = new URLSearchParams({ universe: "crypto", limit: "40" });
    if (minChange) p.set("minChange", minChange);
    if (maxChange) p.set("maxChange", maxChange);
    if (minVol) p.set("minQuoteVolume", String(Number(minVol) * 1e6));
    setUrl(`/api/v1/screener?${p.toString()}`);
  };

  return (
    <>
      <Panel pad={false}>
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => setUrl(`/api/v1/screener?universe=crypto&limit=40&${p.params}`)} className="hover-lift rounded-md border border-line bg-panel-2 px-3 py-2 text-left">
                <div className="text-[12px] font-medium text-accent">{p.name}</div>
                <div className="text-[10px] text-ink-3">{p.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Δ% tối thiểu" value={minChange} onChange={setMinChange} />
            <Field label="Δ% tối đa" value={maxChange} onChange={setMaxChange} />
            <Field label="Vol tối thiểu ($M)" value={minVol} onChange={setMinVol} />
            <button onClick={run} className="flex items-center gap-1.5 rounded-md bg-accent-primary/90 px-3 py-1.5 text-[12px] font-semibold text-white">
              <Play className="size-3.5" /> Chạy bộ lọc
            </button>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2"><MetaLine meta={meta} /></div>
      </Panel>

      {isLoading && !res ? <Loading rows={8} /> : !data ? (
        <Unavailable title="Screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel title={`Kết quả: ${data.rows.length} mã`} pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="px-3.5 py-2 font-medium">Mã</th>
                  <th className="py-2 text-right font-medium">Giá</th>
                  <th className="py-2 text-right font-medium">24h %</th>
                  <th className="py-2 text-right font-medium">Biên 24h</th>
                  <th className="py-2 pr-3.5 text-right font-medium">Vol</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.symbol} className="row-hover border-b border-line/40">
                    <td className="px-3.5 py-2"><Link href={`/crypto/${r.symbol}`} className="font-semibold hover:text-accent">{r.baseAsset}</Link></td>
                    <td className="num py-2 text-right">{fmtNum(r.price, priceDigits(r.price))}</td>
                    <td className="py-2 text-right"><Chg value={r.changePercent} arrow={false} /></td>
                    <td className="num py-2 text-right text-ink-3">{fmtNum(r.low, priceDigits(r.price))}–{fmtNum(r.high, priceDigits(r.price))}</td>
                    <td className="num py-2 pr-3.5 text-right text-ink-2">${fmtCompact(r.quoteVolume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

function Field({ label, value, onChange, small }: { label: string; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <label>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={`num input ${small ? "!w-24" : "w-28"} !py-1.5 text-[12px]`} />
    </label>
  );
}

export default function ScreenerPage() {
  return (
    <Suspense fallback={<Loading rows={8} />}>
      <ScreenerInner />
    </Suspense>
  );
}
