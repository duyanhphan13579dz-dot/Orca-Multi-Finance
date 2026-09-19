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
  roe: number | null;
  roa: number | null;
  ros: number | null;
  roic: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  debtEquity: number | null;
  currentRatio: number | null;
  revenueYoyPct: number | null;
  niYoyPct: number | null;
  coverage: number;
  qualityScore: number | null;
  healthScore: number | null;
  reportDate: string | null;
  score: number;
};
type Data = { rows: Row[]; scanned: number; skipped: number; withData?: number };

/** Single numeric filter inside a bordered chip */
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
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`num input !w-full min-w-0 !px-2 !py-1.5 text-[12px] ${className}`}
    />
  );
}

/** From–to pair in one chip */
function RangeChip({
  title,
  from,
  to,
  onFrom,
  onTo,
  unit,
}: {
  title: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  unit?: string;
}) {
  return (
    <FilterChip title={unit ? `${title} (${unit})` : title} className="min-w-[9.5rem]">
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
  unit,
  placeholder = "≥",
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <FilterChip title={unit ? `${title} (${unit})` : title}>
      <NumInput value={value} onChange={onChange} placeholder={placeholder} />
    </FilterChip>
  );
}

function MaxChip({
  title,
  value,
  onChange,
  unit,
  placeholder = "≤",
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <FilterChip title={unit ? `${title} (${unit})` : title}>
      <NumInput value={value} onChange={onChange} placeholder={placeholder} />
    </FilterChip>
  );
}

function percent(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function num(value: number | null, digits = 2) {
  return value == null ? "—" : value.toFixed(digits);
}

export function FundamentalScreener({ defaultSector }: { defaultSector: string | null }) {
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [minRoe, setMinRoe] = useState("");
  const [maxRoe, setMaxRoe] = useState("");
  const [minRoa, setMinRoa] = useState("");
  const [maxRoa, setMaxRoa] = useState("");
  const [minRoic, setMinRoic] = useState("");
  const [maxRoic, setMaxRoic] = useState("");
  const [minGrossMargin, setMinGrossMargin] = useState("");
  const [maxGrossMargin, setMaxGrossMargin] = useState("");
  const [minNetMargin, setMinNetMargin] = useState("");
  const [maxNetMargin, setMaxNetMargin] = useState("");
  const [maxDebtEquity, setMaxDebtEquity] = useState("");
  const [minCurrentRatio, setMinCurrentRatio] = useState("");
  const [minCoverage, setMinCoverage] = useState("");
  const [minNiYoy, setMinNiYoy] = useState("");

  const [query, setQuery] = useState("/api/v1/screener/fundamental");
  const { res, data, meta, isLoading, isValidating } = useApi<Data>(query, {
    refreshInterval: 900_000,
    timeoutMs: 120_000,
  });

  const run = useCallback(() => {
    const qs = new URLSearchParams();
    if (sector) qs.set("sector", sector);
    if (symbols) qs.set("symbols", symbols);
    for (const [key, value] of Object.entries({
      minRoe,
      maxRoe,
      minRoa,
      maxRoa,
      minRoic,
      maxRoic,
      minGrossMargin,
      maxGrossMargin,
      minNetMargin,
      maxNetMargin,
      maxDebtEquity,
      minCurrentRatio,
      minCoverage,
      minNiYoy,
    })) {
      if (value) qs.set(key, value);
    }
    qs.set("_", String(Date.now()));
    setQuery(`/api/v1/screener/fundamental?${qs}`);
  }, [
    sector,
    symbols,
    minRoe,
    maxRoe,
    minRoa,
    maxRoa,
    minRoic,
    maxRoic,
    minGrossMargin,
    maxGrossMargin,
    minNetMargin,
    maxNetMargin,
    maxDebtEquity,
    minCurrentRatio,
    minCoverage,
    minNiYoy,
  ]);

  return (
    <div className="space-y-3">
      <Panel title="Chỉ số cơ bản · ROE, ROA, biên LN, ROIC, đòn bẩy">
        <p className="mb-3 max-w-5xl text-[12px] leading-relaxed text-text-muted">
          Sàng lọc từ báo cáo tài chính (bulk snapshot BCTC). Score tổng hợp ROE · ROIC · biên lợi nhuận · nợ/VCSH ·
          coverage. So sánh trong cùng ngành vì mô hình kinh doanh và đòn bẩy khác nhau.
        </p>

        {/* Profitability ranges */}
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Sinh lời</div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <RangeChip title="ROE" unit="%" from={minRoe} to={maxRoe} onFrom={setMinRoe} onTo={setMaxRoe} />
          <RangeChip title="ROA" unit="%" from={minRoa} to={maxRoa} onFrom={setMinRoa} onTo={setMaxRoa} />
          <RangeChip title="ROIC" unit="%" from={minRoic} to={maxRoic} onFrom={setMinRoic} onTo={setMaxRoic} />
          <RangeChip
            title="Biên gộp"
            unit="%"
            from={minGrossMargin}
            to={maxGrossMargin}
            onFrom={setMinGrossMargin}
            onTo={setMaxGrossMargin}
          />
          <RangeChip
            title="Biên ròng"
            unit="%"
            from={minNetMargin}
            to={maxNetMargin}
            onFrom={setMinNetMargin}
            onTo={setMaxNetMargin}
          />
        </div>

        {/* Leverage / quality */}
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Cấu trúc & chất lượng</div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <MaxChip title="Nợ / VCSH" value={maxDebtEquity} onChange={setMaxDebtEquity} placeholder="Tối đa" />
          <MinChip title="Current ratio" value={minCurrentRatio} onChange={setMinCurrentRatio} placeholder="Tối thiểu" />
          <MinChip title="Coverage" value={minCoverage} onChange={setMinCoverage} placeholder="0–1" />
          <MinChip title="LN YoY" unit="%" value={minNiYoy} onChange={setMinNiYoy} placeholder="Từ" />
        </div>

        {/* Scope + action */}
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
            {isValidating ? "Đang quét…" : "Quét chỉ số"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <MetaLine meta={meta} />
          {data ? (
            <span>
              {data.rows.length} khớp · data {data.withData ?? data.scanned - data.skipped}/{data.scanned} · bỏ{" "}
              {data.skipped}
            </span>
          ) : null}
          <FreshnessDot status={meta?.freshness} />
        </div>
      </Panel>

      {isLoading && !data ? (
        <Loading rows={8} />
      ) : !res?.success && !data ? (
        <Unavailable
          title="Screener chỉ số cơ bản không khả dụng"
          note={res && !res.success ? res.error.message : undefined}
        />
      ) : (
        <Panel title={`Kết quả · ${data?.rows.length ?? 0} mã`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="py-2 pr-3">Mã</th>
                  <th className="py-2 pr-3">Ngành</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right">Giá</th>
                  <th className="py-2 text-right">ROE</th>
                  <th className="py-2 text-right">ROA</th>
                  <th className="py-2 text-right">ROIC</th>
                  <th className="py-2 text-right">Biên gộp</th>
                  <th className="py-2 text-right">Biên ròng</th>
                  <th className="py-2 text-right">Nợ/VCSH</th>
                  <th className="py-2 text-right">CR</th>
                  <th className="py-2 text-right">LN YoY</th>
                  <th className="py-2 text-right">Cov</th>
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
                    <td className="num py-2 text-right">{percent(row.roe)}</td>
                    <td className="num py-2 text-right">{percent(row.roa)}</td>
                    <td className="num py-2 text-right">{percent(row.roic)}</td>
                    <td className="num py-2 text-right">{percent(row.grossMargin)}</td>
                    <td className="num py-2 text-right">{percent(row.netMargin)}</td>
                    <td className="num py-2 text-right">{num(row.debtEquity)}</td>
                    <td className="num py-2 text-right">{num(row.currentRatio)}</td>
                    <td className="num py-2 text-right">{percent(row.niYoyPct)}</td>
                    <td className="num py-2 text-right">
                      {row.coverage > 0 ? `${Math.round(row.coverage * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data?.rows.length ? (
            <p className="py-5 text-center text-[12px] text-text-muted">Không có mã khớp điều kiện chỉ số cơ bản.</p>
          ) : null}
        </Panel>
      )}
    </div>
  );
}
