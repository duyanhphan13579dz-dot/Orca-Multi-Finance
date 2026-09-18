"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP, sectorOf } from "@/lib/vn/master";
import type { CryptoMarketRow, Quote, IndexQuote } from "@/lib/types";
import { WyckoffScreener } from "@/components/wyckoff-screener";
import { CanslimScreener } from "@/components/canslim-screener";
import { MinerviniScreener } from "@/components/minervini-screener";
import { ElliottScreener } from "@/components/elliott-screener";
import { ValuationScreener } from "@/components/valuation-screener";
import { Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { FlatsIcon, Play } from "@/components/screener-icons";

type StocksData = { indices: IndexQuote[] | null; quotes: Quote[] | null };
type Universe = "stocks" | "crypto" | "wyckoff" | "canslim" | "minervini" | "elliott" | "valuation";

const VN_BOARD = "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD";

function ScreenerInner() {
  const params = useSearchParams();
  const rawU = params.get("universe");
  const initial: Universe =
    rawU === "crypto"
      ? "crypto"
      : rawU === "wyckoff"
        ? "wyckoff"
        : rawU === "canslim"
          ? "canslim"
          : rawU === "minervini"
            ? "minervini"
              : rawU === "elliott"
                ? "elliott"
                : rawU === "valuation"
                  ? "valuation"
                  : "stocks";
  const [universe, setUniverse] = useState<Universe>(initial);
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
            <button data-active={universe === "canslim"} onClick={() => setUniverse("canslim")}>CANSLIM</button>
            <button data-active={universe === "minervini"} onClick={() => setUniverse("minervini")}>Minervini</button>
            <button data-active={universe === "wyckoff"} onClick={() => setUniverse("wyckoff")}>Wyckoff</button>
            <button data-active={universe === "elliott"} onClick={() => setUniverse("elliott")}>Elliott Wave</button>
            <button data-active={universe === "valuation"} onClick={() => setUniverse("valuation")}>Định giá P</button>
            <button data-active={universe === "crypto"} onClick={() => setUniverse("crypto")}>Crypto</button>
          </div>
        </div>
      </Panel>
      {universe === "crypto" ? (
        <CryptoScreener />
      ) : universe === "wyckoff" ? (
        <WyckoffScreener defaultSector={params.get("sector")} />
      ) : universe === "canslim" ? (
        <CanslimScreener defaultSector={params.get("sector")} />
      ) : universe === "minervini" ? (
        <MinerviniScreener defaultSector={params.get("sector")} />
      ) : universe === "elliott" ? (
        <ElliottScreener defaultSector={params.get("sector")} />
      ) : universe === "valuation" ? (
        <ValuationScreener defaultSector={params.get("sector")} />
      ) : (
        <VnScreener defaultSector={params.get("sector")} />
      )}
    </div>
  );
}

function VnScreener({ defaultSector }: { defaultSector: string | null }) {
  const { res, data, meta, isLoading, isValidating, mutate } = useApi<StocksData>(`/api/v1/stocks?symbols=${VN_BOARD}`, { refreshInterval: 20_000 });
  const [sector, setSector] = useState(defaultSector ?? "");
  const [minChg, setMinChg] = useState("");
  const [maxChg, setMaxChg] = useState("");
  const [minVol, setMinVol] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ sector: defaultSector ?? "", minChg: "", maxChg: "", minVol: "", q: "" });
  const [pressed, setPressed] = useState(false);
  const [flash, setFlash] = useState(false);

  const rows = useMemo(() => {
    let list = data?.quotes ?? [];
    if (applied.sector) list = list.filter((row) => sectorOf(row.symbol) === applied.sector);
    if (applied.minChg) list = list.filter((row) => (row.changePercent ?? 0) >= Number(applied.minChg));
    if (applied.maxChg) list = list.filter((row) => (row.changePercent ?? 0) <= Number(applied.maxChg));
    if (applied.minVol) list = list.filter((row) => (row.quoteVolume ?? row.volume ?? 0) >= Number(applied.minVol) * 1_000_000);
    const needle = (q || applied.q).trim().toUpperCase();
    if (needle) {
      const parts = needle.split(/[\s,;]+/).filter(Boolean);
      list = list.filter((row) =>
        parts.some(
          (p) => row.symbol.includes(p) || (row.name ?? "").toUpperCase().includes(p) || (sectorOf(row.symbol) ?? "").toUpperCase().includes(p),
        ),
      );
    }
    return [...list].sort((a, b) => (b.quoteVolume ?? b.volume ?? 0) - (a.quoteVolume ?? a.volume ?? 0));
  }, [data, applied, q]);

  const run = useCallback(() => {
    setPressed(true);
    setFlash(true);
    setApplied({ sector, minChg, maxChg, minVol, q });
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  }, [sector, minChg, maxChg, minVol, q, mutate]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 900);
    return () => window.clearTimeout(t);
  }, [flash]);

  const filters = (
    <div className={`flex flex-wrap items-end gap-2 rounded-md p-0.5 transition-shadow duration-300 ${flash ? "ring-2 ring-accent-primary/50" : ""}`}>
      <label>
        <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Tìm mã (live)</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="VCB, FPT…"
          className="input !w-32 !py-1.5 text-[12px] focus:ring-2 focus:ring-accent-primary/50"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <VnFilterSelect sector={sector} setSector={setSector} />
      <Field label="Δ% tối thiểu" value={minChg} onChange={setMinChg} small />
      <Field label="Δ% tối đa" value={maxChg} onChange={setMaxChg} small />
      <Field label="GT min (tỷ đ)" value={minVol} onChange={setMinVol} small />
      <button
        type="button"
        onClick={run}
        className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white transition-all duration-150 ${pressed ? "scale-95 bg-accent-primary ring-2 ring-white/40" : "bg-accent-primary/90 hover:bg-accent-primary"} active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary`}
      >
        {isValidating ? (
          <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
        ) : (
          <Play className="size-3.5" />
        )}
        {isValidating ? "Đang lọc…" : "Tìm kiếm"}
      </button>
    </div>
  );

  if (isLoading && !res) return <Loading rows={8} />;
  if (!res?.success) {
    return (
      <>
        <Panel title="Bộ lọc cổ phiếu Việt Nam" pad={false}>
          <div className="p-3">{filters}</div>
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
            Kết quả: {rows.length} mã{" "}
            {q.trim() ? <span className="text-accent-primary">(lọc “{q.trim()}”)</span> : null}{" "}
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            {isValidating ? <span className="ml-1.5 text-[10px] text-accent-primary">· đang cập nhật</span> : null}
          </span>
        }
        right={filters}
        pad={false}
      >
        <div className={`overflow-x-auto transition-opacity duration-200 ${isValidating ? "opacity-70" : "opacity-100"}`}>
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
                <tr>
                  <td colSpan={5} className="px-3.5 py-6 text-center text-text-muted">
                    Không có mã khớp. Thử xóa ô tìm hoặc nới điều kiện lọc.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.symbol} className="row-hover border-b border-line/40">
                    <td className="px-3.5 py-2"><Link href={`/stocks/${row.symbol}`} className="font-semibold hover:text-accent">{row.symbol}</Link></td>
                    <td className="py-2 text-[11px] text-text-muted">{sectorOf(row.symbol)}</td>
                    <td className="num py-2 text-right">{fmtNum(row.price, 2)}</td>
                    <td className="py-2 text-right"><Chg value={row.changePercent} arrow={false} /></td>
                    <td className="num py-2 pr-3.5 text-right text-ink-2">{fmtCompact(row.quoteVolume ?? row.volume)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-3.5 py-2"><MetaLine meta={meta} /></div>
      </Panel>
      <Panel title="CANSLIM · Minervini · Wyckoff">
        <div className="text-[12px] leading-relaxed text-ink-2 space-y-1">
          <div>Tab <strong>CANSLIM</strong>: quét growth leaders (EPS/ROE/RS/new high) theo O'Neil.</div>
          <div>Tab <strong>Minervini</strong>: Trend Template 8 tiêu chí Stage 2 (SEPA).</div>
          <div>Tab <strong>Wyckoff</strong>: quét Spring / UTAD / SOS / SOW trên rổ thanh khoản.</div>
          <div className="text-text-muted">Cả ba đều là heuristic nghiên cứu — không phải tín hiệu mua bán.</div>
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
  const [pressed, setPressed] = useState(false);
  const { res, data, meta, isLoading, isValidating, mutate } = useApi<{ universe: string; rows: CryptoMarketRow[] }>(url, { refreshInterval: 30_000 });
  const run = () => {
    setPressed(true);
    const p = new URLSearchParams({ universe: "crypto", limit: "40" });
    if (minChange) p.set("minChange", minChange);
    if (maxChange) p.set("maxChange", maxChange);
    if (minVol) p.set("minQuoteVolume", String(Number(minVol) * 1e6));
    p.set("_", String(Date.now()));
    setUrl(`/api/v1/screener?${p.toString()}`);
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  };
  return (
    <>
      <Panel pad={false}>
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => setUrl(`/api/v1/screener?universe=crypto&limit=40&${p.params}&_=${Date.now()}`)} className="hover-lift rounded-md border border-line bg-panel-2 px-3 py-2 text-left">
                <div className="text-[12px] font-medium text-accent">{p.name}</div>
                <div className="text-[10px] text-ink-3">{p.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Δ% tối thiểu" value={minChange} onChange={setMinChange} />
            <Field label="Δ% tối đa" value={maxChange} onChange={setMaxChange} />
            <Field label="Vol tối thiểu ($M)" value={minVol} onChange={setMinVol} />
            <button
              type="button"
              onClick={run}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white transition-all duration-150 ${pressed ? "scale-95 bg-accent-primary ring-2 ring-white/40" : "bg-accent-primary/90 hover:bg-accent-primary"} active:scale-95`}
            >
              {isValidating ? (
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
              ) : (
                <Play className="size-3.5" />
              )}
              {isValidating ? "Đang lọc…" : "Tìm kiếm"}
            </button>
          </div>
        </div>
        <div className="border-t border-line px-4 py-2"><MetaLine meta={meta} /></div>
      </Panel>
      {isLoading && !res ? <Loading rows={8} /> : !data ? (
        <Unavailable title="Screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel title={`Kết quả: ${data.rows.length} mã${isValidating ? " · đang cập nhật" : ""}`} pad={false}>
          <div className={`overflow-x-auto transition-opacity ${isValidating ? "opacity-70" : ""}`}>
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
