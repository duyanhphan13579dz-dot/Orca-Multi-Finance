"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

type Row = {
  symbol: string;
  sector: string | null;
  price: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  evEbitda: number | null;
  peg: number | null;
  fcfYieldPct: number | null;
  netDebtToEbitda: number | null;
  eps: number | null;
  niYoyPct: number | null;
  reportDate: string | null;
  sourceNote: string;
  score: number;
};
type Data = { rows: Row[]; scanned: number; skipped: number; withData?: number; bctcHit?: number };

function FilterChip({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-[7.5rem] flex-col gap-1.5 rounded-lg border border-line/80 bg-panel-2/60 px-2.5 py-2 ${className}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-2">{title}</span>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="num input !w-full min-w-0 !px-2 !py-1.5 text-[12px]"
    />
  );
}

function RangeChip({
  title,
  from,
  to,
  onFrom,
  onTo,
}: {
  title: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <FilterChip title={title} className="min-w-[9.5rem]">
      <div className="flex items-center gap-1.5">
        <NumInput value={from} onChange={onFrom} placeholder="Từ" />
        <span className="shrink-0 text-[10px] text-text-muted">–</span>
        <NumInput value={to} onChange={onTo} placeholder="Đến" />
      </div>
    </FilterChip>
  );
}

function MinChip({
  title,
  value,
  onChange,
  placeholder = "≥",
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <FilterChip title={title}>
      <NumInput value={value} onChange={onChange} placeholder={placeholder} />
    </FilterChip>
  );
}

function MaxChip({
  title,
  value,
  onChange,
  placeholder = "≤",
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <FilterChip title={title}>
      <NumInput value={value} onChange={onChange} placeholder={placeholder} />
    </FilterChip>
  );
}

function multiple(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}
function percent(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

export function ValuationScreener({ defaultSector }: { defaultSector: string | null }) {
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [minPe, setMinPe] = useState("");
  const [maxPe, setMaxPe] = useState("");
  const [minPb, setMinPb] = useState("");
  const [maxPb, setMaxPb] = useState("");
  const [minPs, setMinPs] = useState("");
  const [maxPs, setMaxPs] = useState("");
  const [minEvEbitda, setMinEvEbitda] = useState("");
  const [maxEvEbitda, setMaxEvEbitda] = useState("");
  const [maxPeg, setMaxPeg] = useState("");
  const [minFcfYield, setMinFcfYield] = useState("");
  const [maxNetDebtEbitda, setMaxNetDebtEbitda] = useState("");

  const [query, setQuery] = useState("/api/v1/screener/valuation");
  const { res, data, meta, isLoading, isValidating } = useApi<Data>(query, {
    refreshInterval: 300_000,
    timeoutMs: 120_000,
  });

  const run = useCallback(() => {
    const qs = new URLSearchParams();
    if (sector) qs.set("sector", sector);
    if (symbols) qs.set("symbols", symbols);
    for (const [key, value] of Object.entries({
      minPe,
      maxPe,
      minPb,
      maxPb,
      minPs,
      maxPs,
      minEvEbitda,
      maxEvEbitda,
      maxPeg,
      minFcfYield,
      maxNetDebtEbitda,
    })) {
      if (value) qs.set(key, value);
    }
    qs.set("_", String(Date.now()));
    setQuery(`/api/v1/screener/valuation?${qs}`);
  }, [
    sector,
    symbols,
    minPe,
    maxPe,
    minPb,
    maxPb,
    minPs,
    maxPs,
    minEvEbitda,
    maxEvEbitda,
    maxPeg,
    minFcfYield,
    maxNetDebtEbitda,
  ]);

  return (
    <div className="space-y-3">
      <Panel title="Định giá P · P/E, P/B, PEG, FCF yield">
        <p className="mb-3 max-w-5xl text-[12px] leading-relaxed text-text-muted">
          Bội số từ VNDirect ratios, bổ sung PEG và FCF yield từ báo cáo tài chính (BCTC snapshot). Bội số thấp không
          đồng nghĩa rẻ — đối chiếu tăng trưởng LN, chất lượng dòng tiền và nợ.
        </p>

        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Bội số định giá</div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <RangeChip title="P/E" from={minPe} to={maxPe} onFrom={setMinPe} onTo={setMaxPe} />
          <RangeChip title="P/B" from={minPb} to={maxPb} onFrom={setMinPb} onTo={setMaxPb} />
          <RangeChip title="P/S" from={minPs} to={maxPs} onFrom={setMinPs} onTo={setMaxPs} />
          <RangeChip
            title="EV / EBITDA"
            from={minEvEbitda}
            to={maxEvEbitda}
            onFrom={setMinEvEbitda}
            onTo={setMaxEvEbitda}
          />
        </div>

        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Tăng trưởng & dòng tiền
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <MaxChip title="PEG tối đa" value={maxPeg} onChange={setMaxPeg} placeholder="VD: 1.2" />
          <MinChip title="FCF yield ≥" value={minFcfYield} onChange={setMinFcfYield} placeholder="%" />
          <MaxChip
            title="Net debt / EBITDA ≤"
            value={maxNetDebtEbitda}
            onChange={setMaxNetDebtEbitda}
            placeholder="VD: 2"
          />
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-line/50 pt-3">
          <FilterChip title="Ngành" className="min-w-[10rem]">
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="input !w-full !px-2 !py-1.5 text-[12px]"
            >
              <option value="">Tất cả</option>
              {VN_SECTOR_MAP.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip title="Mã" className="min-w-[9rem]">
            <input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              placeholder="VCB, FPT…"
              className="input !w-full !px-2 !py-1.5 text-[12px]"
            />
          </FilterChip>
          <button
            type="button"
            onClick={run}
            disabled={isValidating}
            className="inline-flex h-[2.65rem] items-center gap-1.5 self-end rounded-lg bg-accent-primary px-4 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-primary/90 disabled:opacity-60"
          >
            <Play className="size-3.5" />
            {isValidating ? "Đang quét…" : "Quét định giá"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <MetaLine meta={meta} />
          {data ? (
            <span>
              {data.rows.length} khớp · data {data.withData ?? data.scanned - data.skipped}/{data.scanned}
              {data.bctcHit != null ? ` · BCTC ${data.bctcHit}` : ""}
            </span>
          ) : null}
          <FreshnessDot status={meta?.freshness} />
        </div>
      </Panel>

      {isLoading && !data ? (
        <Loading rows={8} />
      ) : !res?.success && !data ? (
        <Unavailable title="Screener định giá không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel title={`Kết quả · ${data?.rows.length ?? 0} mã`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="py-2 pr-3">Mã</th>
                  <th className="py-2 pr-3">Ngành</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right">Giá</th>
                  <th className="py-2 text-right">P/E</th>
                  <th className="py-2 text-right">P/B</th>
                  <th className="py-2 text-right">P/S</th>
                  <th className="py-2 text-right">EV/EBITDA</th>
                  <th className="py-2 text-right">PEG</th>
                  <th className="py-2 text-right">FCF Yld</th>
                  <th className="py-2 text-right">ND/EBITDA</th>
                  <th className="py-2 text-right">LN YoY</th>
                  <th className="py-2 pl-3 text-right">Nguồn</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((row) => (
                  <tr key={row.symbol} className="row-hover border-b border-line/40">
                    <td className="py-2 pr-3">
                      <Link href={`/stocks/${row.symbol}`} className="font-semibold hover:text-accent">
                        {row.symbol}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-[11px] text-text-muted">{row.sector ?? "—"}</td>
                    <td className="num py-2 text-right font-semibold text-accent">{row.score}</td>
                    <td className="num py-2 text-right">{row.price?.toFixed(2) ?? "—"}</td>
                    <td className="num py-2 text-right">{multiple(row.pe)}</td>
                    <td className="num py-2 text-right">{multiple(row.pb)}</td>
                    <td className="num py-2 text-right">{multiple(row.ps)}</td>
                    <td className="num py-2 text-right">{multiple(row.evEbitda)}</td>
                    <td className="num py-2 text-right">{multiple(row.peg)}</td>
                    <td className="num py-2 text-right">{percent(row.fcfYieldPct)}</td>
                    <td className="num py-2 text-right">{multiple(row.netDebtToEbitda)}</td>
                    <td className="num py-2 text-right">{percent(row.niYoyPct)}</td>
                    <td className="py-2 pl-3 text-right text-[10px] text-text-muted">{row.sourceNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data?.rows.length ? (
            <p className="py-5 text-center text-[12px] text-text-muted">Không có mã khớp điều kiện định giá.</p>
          ) : null}
        </Panel>
      )}
    </div>
  );
}
