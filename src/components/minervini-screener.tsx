"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

type MinerviniCriteria = {
  priceAbove150And200: boolean;
  ma150Above200: boolean;
  ma200Rising: boolean;
  ma50AboveLonger: boolean;
  priceAbove50: boolean;
  above52wLow30pct: boolean;
  within25pctOf52wHigh: boolean;
  rsAtLeast70: boolean;
};
type MinerviniScreenRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  passCount: number;
  passAll: boolean;
  stage2: boolean;
  criteria: MinerviniCriteria;
  metrics: {
    rsRating: number | null;
    pctAbove52wLow: number | null;
    pctBelow52wHigh: number | null;
    volumeContracting: boolean;
  };
  notes: string[];
};

const CRITERION_LABELS_VI: Record<string, string> = {
  priceAbove150And200: "Giá > SMA150 & SMA200",
  ma150Above200: "SMA150 > SMA200",
  ma200Rising: "SMA200 đang dốc lên (≥1 tháng)",
  ma50AboveLonger: "SMA50 > SMA150 & SMA200",
  priceAbove50: "Giá > SMA50",
  above52wLow30pct: "Giá ≥ +30% so với đáy 52T",
  within25pctOf52wHigh: "Giá trong 25% đỉnh 52T",
  rsAtLeast70: "RS rank ≥ 70 (proxy)",
};

type MinerviniData = { rows: MinerviniScreenRow[]; scanned: number; skipped: number };

function Field({
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
        inputMode="decimal"
        className={`num input ${small ? "!w-24" : "w-28"} !py-1.5 text-[12px]`}
      />
    </label>
  );
}

function buildQs(opts: {
  minPass: string;
  onlyPassAll: boolean;
  minRs: string;
  sector: string;
  symbols: string;
  bust?: number;
}) {
  const qs = new URLSearchParams({
    minPass: opts.minPass || "6",
    limit: "40",
  });
  if (opts.onlyPassAll) qs.set("onlyPassAll", "1");
  if (opts.minRs) qs.set("minRs", opts.minRs);
  if (opts.sector) qs.set("sector", opts.sector);
  const symbols = opts.symbols
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length) qs.set("symbols", symbols.join(","));
  if (opts.bust) qs.set("_", String(opts.bust));
  return qs.toString();
}

function CritDots({ row }: { row: MinerviniScreenRow }) {
  const keys = Object.keys(CRITERION_LABELS_VI) as (keyof MinerviniCriteria)[];
  return (
    <div className="flex flex-wrap gap-0.5" title={keys.map((k) => `${CRITERION_LABELS_VI[k] ?? k}: ${row.criteria[k] ? "✓" : "✗"}`).join("\n")}>
      {keys.map((k) => (
        <span
          key={k}
          className={`inline-block h-2 w-2 rounded-full ${row.criteria[k] ? "bg-emerald-500" : "bg-zinc-600"}`}
        />
      ))}
    </div>
  );
}

export function MinerviniScreener({ defaultSector }: { defaultSector: string | null }) {
  const [minPass, setMinPass] = useState("6");
  const [onlyPassAll, setOnlyPassAll] = useState(false);
  const [minRs, setMinRs] = useState("70");
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(() =>
    buildQs({ minPass: "6", onlyPassAll: false, minRs: "70", sector: defaultSector ?? "", symbols: "" }),
  );

  const { res, data, meta, isLoading, isValidating, mutate } = useApi<MinerviniData>(
    `/api/v1/screener/minervini?${query}`,
    { refreshInterval: 60_000, timeoutMs: 90_000 },
  );

  const run = useCallback(() => {
    setQuery(
      buildQs({
        minPass,
        onlyPassAll,
        minRs,
        sector,
        symbols,
        bust: Date.now(),
      }),
    );
  }, [minPass, onlyPassAll, minRs, sector, symbols]);

  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    const needle = q.trim().toUpperCase();
    if (needle) {
      const parts = needle.split(/[\s,;]+/).filter(Boolean);
      list = list.filter((row) =>
        parts.some(
          (p) =>
            row.symbol.includes(p) ||
            (row.name ?? "").toUpperCase().includes(p) ||
            (row.sector ?? "").toUpperCase().includes(p),
        ),
      );
    }
    return list;
  }, [data?.rows, q]);

  return (
    <div className="space-y-3">
      <Panel title="Mark Minervini — Trend Template (SEPA)">
        <p className="mb-3 text-[12px] leading-relaxed text-text-muted">
          Bộ lọc 8 tiêu chí Stage 2 từ <em>Trade Like a Stock Market Wizard</em>. Tất cả phải đúng mới coi là
          Stage 2 đầy đủ. RS rank dùng proxy percentile lợi suất ~12T trong universe (không phải IBD RS Rating
          gốc). VCP / pivot entry vẫn cần phân tích chart thủ công sau khi lọc.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Tối thiểu tiêu chí</span>
            <select value={minPass} onChange={(e) => setMinPass(e.target.value)} className="input !w-28 !py-1.5 text-[12px]">
              {[8, 7, 6, 5, 4].map((n) => (
                <option key={n} value={String(n)}>
                  ≥ {n}/8
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[12px]">
            <input type="checkbox" checked={onlyPassAll} onChange={(e) => setOnlyPassAll(e.target.checked)} />
            Chỉ 8/8 (Stage 2)
          </label>
          <Field label="RS tối thiểu" value={minRs} onChange={setMinRs} small />
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
              <option value="">Tất cả</option>
              {VN_SECTOR_MAP.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Mã (tuỳ chọn)</span>
            <input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              placeholder="VCB,FPT,…"
              className="input !w-40 !py-1.5 text-[12px]"
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={isValidating}
            aria-busy={isValidating}
            className="group inline-flex items-center gap-1.5 rounded-md border border-accent-primary/70 bg-accent-primary px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_0_14px_rgb(59_130_246/0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-primary/90 hover:shadow-[0_0_20px_rgb(59_130_246/0.38)] active:translate-y-0 active:scale-95 disabled:cursor-wait disabled:opacity-75"
          >
            {isValidating ? <RefreshCw className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />}
            {isValidating ? "Đang quét…" : "Quét dữ liệu"}
          </button>
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-primary/50 hover:bg-accent-primary/10 hover:text-accent-primary active:translate-y-0 active:scale-95 disabled:cursor-wait disabled:opacity-60"
            disabled={isValidating}
            aria-busy={isValidating}
          >
            <RefreshCw className={`size-3.5 ${isValidating ? "animate-spin" : ""}`} aria-hidden />
            {isValidating ? "Đang làm mới…" : "Làm mới"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <MetaLine meta={meta} />
          {data && (
            <span>
              {rows.length} mã · quét {data.scanned} · bỏ {data.skipped} thiếu nến
            </span>
          )}
          <FreshnessDot status={meta?.freshness} />
        </div>
      </Panel>

      {isLoading && !data ? (
        <div className="space-y-2">
          <p className="px-1 text-[12px] text-text-muted">Đang quét Trend Template (OHLCV ≥200 phiên)…</p>
          <Loading rows={8} />
        </div>
      ) : !res?.success && !data ? (
        <Unavailable title="Minervini screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel title="Kết quả">
          <div className="mb-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Lọc nhanh theo mã / tên / ngành…"
              className="input !w-full max-w-sm !py-1.5 text-[12px]"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted">
                  <th className="py-2 pr-2">Mã</th>
                  <th className="py-2 pr-2">Ngành</th>
                  <th className="py-2 pr-2 text-right">Giá</th>
                  <th className="py-2 pr-2 text-right">%</th>
                  <th className="py-2 pr-2 text-center">Pass</th>
                  <th className="py-2 pr-2">8 tiêu chí</th>
                  <th className="py-2 pr-2 text-right">RS</th>
                  <th className="py-2 pr-2 text-right">+Đáy52T</th>
                  <th className="py-2 pr-2 text-right">−Đỉnh52T</th>
                  <th className="py-2 pr-2">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border/60 hover:bg-surface-2/40">
                    <td className="py-1.5 pr-2 font-medium">
                      <Link href={`/stocks/${row.symbol}`} className="text-accent hover:underline">
                        {row.symbol}
                      </Link>
                      {row.passAll && (
                        <Badge className="ml-1" tone="up">
                          Stage 2
                        </Badge>
                      )}
                      {row.metrics.volumeContracting && (
                        <Badge className="ml-1" tone="neutral">
                          Vol↓
                        </Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-text-muted">{row.sector ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtNum(row.price)}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <Chg value={row.changePercent} />
                    </td>
                    <td className="py-1.5 pr-2 text-center tabular-nums font-medium">
                      {row.passCount}/8
                    </td>
                    <td className="py-1.5 pr-2">
                      <CritDots row={row} />
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {row.metrics.rsRating != null ? row.metrics.rsRating : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-text-muted">
                      {row.metrics.pctAbove52wLow != null ? `${row.metrics.pctAbove52wLow.toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-text-muted">
                      {row.metrics.pctBelow52wHigh != null ? `${row.metrics.pctBelow52wHigh.toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-[11px] text-text-muted">
                      {row.notes.slice(0, 2).join(" · ") || (row.passAll ? "Đủ 8/8" : "")}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-text-muted">
                      Không có mã đạt ngưỡng — thử hạ minPass hoặc bỏ onlyPassAll.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
