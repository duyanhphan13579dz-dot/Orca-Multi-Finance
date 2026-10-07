"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

type CanslimLetter = "C" | "A" | "N" | "S" | "L" | "I" | "M";

type CanslimLetterScore = {
  letter: CanslimLetter;
  pass: boolean;
  score: number;
  detail: string;
  value: number | null;
};

type CanslimScreenRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  gradeVi: string;
  passCount: number;
  passLetters: CanslimLetter[];
  letters: CanslimLetterScore[];
  metrics: {
    epsYoyPct: number | null;
    revenueYoyPct: number | null;
    epsQoqPct?: number | null;
    roePct: number | null;
    annualGrowthPct: number | null;
    pctFromHigh: number | null;
    rsRank: number | null;
    volRatio: number | null;
    foreignNet: number | null;
    foreignNet5d?: number | null;
    sharesOutstanding?: number | null;
  };
  flags: string[];
  notes: string[];
};

type CanslimCoverageStats = {
  withBars: number;
  withGrowth: number;
  withHealth: number;
  withForeign: number;
  withRatios: number;
  withEquity: number;
};

type CanslimData = {
  rows: CanslimScreenRow[];
  scanned: number;
  skipped: number;
  marketBullish: boolean | null;
  marketDetail?: string;
  coverage?: CanslimCoverageStats;
};

const ALL_LETTERS: CanslimLetter[] = ["C", "A", "N", "S", "L", "I", "M"];

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

function gradeTone(g: string): "up" | "down" | "warn" | "neutral" {
  if (g === "A" || g === "B") return "up";
  if (g === "D" || g === "F") return "down";
  if (g === "C") return "warn";
  return "neutral";
}

function marketToneClass(bullish: boolean | null | undefined): string {
  if (bullish === true) return "text-[11px] font-medium text-emerald-500";
  if (bullish === false) return "text-[11px] font-medium text-amber-500";
  return "text-[11px] font-medium text-text-muted";
}

function letterBtnClass(active: boolean): string {
  if (active)
    return "rounded-md px-2.5 py-1 text-[11px] font-semibold border border-accent-primary bg-accent-primary/20 text-accent-primary";
  return "rounded-md px-2.5 py-1 text-[11px] font-semibold border border-line bg-panel-2 text-ink-2 hover:border-accent-primary/40";
}

function passChipClass(hit: boolean): string {
  if (hit) return "inline-block rounded px-1 text-[10px] font-bold bg-emerald-500/20 text-emerald-400";
  return "inline-block rounded px-1 text-[10px] font-bold bg-panel-2 text-ink-3";
}

function buildQs(opts: {
  minScore: string;
  minPass: string;
  sector: string;
  symbols: string;
  letters: CanslimLetter[];
  bust?: number;
}) {
  const qs = new URLSearchParams({
    minScore: opts.minScore || "50",
    minPass: opts.minPass || "0",
    limit: "40",
  });
  if (opts.sector) qs.set("sector", opts.sector);
  if (opts.letters.length) qs.set("letters", opts.letters.join(","));
  const symbols = opts.symbols
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length) qs.set("symbols", symbols.join(","));
  if (opts.bust) qs.set("_", String(opts.bust));
  return qs.toString();
}

export function CanslimScreener({ defaultSector }: { defaultSector: string | null }) {
  const [minScore, setMinScore] = useState("50");
  const [minPass, setMinPass] = useState("3");
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [letters, setLetters] = useState<CanslimLetter[]>([]);
  const [query, setQuery] = useState(() =>
    buildQs({ minScore: "50", minPass: "3", sector: defaultSector ?? "", symbols: "", letters: [] }),
  );
  const [pressed, setPressed] = useState(false);
  const [flash, setFlash] = useState(false);

  const { res, data, meta, isLoading, isValidating, mutate } = useApi<CanslimData>(`/api/v1/screener/canslim?${query}`, {
    refreshInterval: 120_000,
  });

  const run = useCallback(() => {
    setPressed(true);
    setFlash(true);
    setQuery(buildQs({ minScore, minPass, sector, symbols, letters, bust: Date.now() }));
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  }, [minScore, minPass, sector, symbols, letters, mutate]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 900);
    return () => window.clearTimeout(t);
  }, [flash]);

  const toggleLetter = (L: CanslimLetter) => {
    setLetters((prev) => (prev.includes(L) ? prev.filter((x) => x !== L) : [...prev, L]));
  };

  const liveNeedle = symbols.trim().toUpperCase();
  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    if (!liveNeedle) return list;
    const parts = liveNeedle.split(/[\s,;]+/).filter(Boolean);
    return list.filter((r) => parts.some((p) => r.symbol.includes(p) || (r.name ?? "").toUpperCase().includes(p)));
  }, [data, liveNeedle]);

  const busy = isLoading || isValidating;
  const cov = data?.coverage;

  return (
    <div className="space-y-3">
      <Panel title="Bộ lọc CAN SLIM — growth leaders VN">
        <p className="mb-3 text-[12px] leading-relaxed text-text-muted">
          Pipeline: BCTC (C/A) · VNDirect ratios/ROE · OHLCV (N/S/L) · NN 5 phiên (I) · VNINDEX MA50+3M (M). Heuristic
          nghiên cứu — không phải tín hiệu mua bán.
        </p>

        {data?.marketDetail ? (
          <div className={`mb-2 ${marketToneClass(data.marketBullish)}`}>M · {data.marketDetail}</div>
        ) : null}

        {cov ? (
          <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
            <span className="rounded-md border border-line px-2 py-0.5">Nến {cov.withBars}</span>
            <span className="rounded-md border border-line px-2 py-0.5">BCTC {cov.withGrowth}</span>
            <span className="rounded-md border border-line px-2 py-0.5">Health {cov.withHealth}</span>
            <span className="rounded-md border border-line px-2 py-0.5">Ratios {cov.withRatios}</span>
            <span className="rounded-md border border-line px-2 py-0.5">NN {cov.withForeign}</span>
            <span className="rounded-md border border-line px-2 py-0.5">CP LH {cov.withEquity}</span>
          </div>
        ) : null}

        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Chữ cái bắt buộc (tùy chọn)
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ALL_LETTERS.map((L) => (
            <button
              key={L}
              type="button"
              onClick={() => toggleLetter(L)}
              className={letterBtnClass(letters.includes(L))}
              title={`Bắt buộc pass chữ ${L}`}
            >
              {L}
            </button>
          ))}
        </div>

        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Ngưỡng điểm</div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <FilterChip title="Điểm ≥">
            <input
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              inputMode="decimal"
              placeholder="50"
              className="num input !w-full !px-2 !py-1.5 text-[12px]"
            />
          </FilterChip>
          <FilterChip title="Pass ≥">
            <input
              value={minPass}
              onChange={(e) => setMinPass(e.target.value)}
              inputMode="numeric"
              placeholder="3"
              className="num input !w-full !px-2 !py-1.5 text-[12px]"
            />
          </FilterChip>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-line/50 pt-3">
          <FilterChip title="Ngành" className="min-w-[10rem]">
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="input !w-full !px-2 !py-1.5 text-[12px]"
            >
              <option value="">Tất cả ({VN_SECTOR_MAP.length})</option>
              {VN_SECTOR_MAP.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip title="Mã (live)" className="min-w-[9rem]">
            <input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder="FPT, HPG"
              className="input !w-full !px-2 !py-1.5 text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
          </FilterChip>
          <button
            type="button"
            onClick={run}
            className={`inline-flex h-[2.65rem] items-center gap-1.5 self-end rounded-lg px-4 text-[12px] font-semibold text-white shadow-sm transition ${
              pressed ? "scale-95 bg-accent-primary ring-2 ring-white/40" : "bg-accent-primary hover:bg-accent-primary/90"
            }`}
          >
            {busy ? (
              <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Play className="size-3.5" />
            )}
            {busy ? "Đang quét…" : "Tìm kiếm"}
          </button>
        </div>

        {flash ? (
          <div className="mt-2 text-[11px] font-medium text-accent-primary animate-pulse">Đã áp dụng bộ lọc CANSLIM…</div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <MetaLine meta={meta} />
          <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
        </div>
      </Panel>

      {isLoading && !res ? (
        <Loading rows={8} />
      ) : !data ? (
        <Unavailable title="CANSLIM screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel
          title={
            <span>
              {rows.length} mã · quét {data.scanned} · bỏ {data.skipped}{" "}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              {isValidating ? <span className="ml-1.5 text-[10px] text-accent-primary">· đang cập nhật</span> : null}
            </span>
          }
          pad={false}
        >
          <div className={isValidating ? "overflow-x-auto opacity-70 transition-opacity" : "overflow-x-auto transition-opacity"}>
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="px-3.5 py-2 font-medium">Mã</th>
                  <th className="py-2 font-medium">Grade</th>
                  <th className="py-2 text-right font-medium">Điểm</th>
                  <th className="py-2 font-medium">Pass</th>
                  <th className="py-2 text-right font-medium">LN YoY</th>
                  <th className="py-2 text-right font-medium">ROE</th>
                  <th className="py-2 text-right font-medium">RS</th>
                  <th className="py-2 text-right font-medium">Giá</th>
                  <th className="py-2 pr-3.5 text-right font-medium">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3.5 py-6 text-center text-text-muted">
                      Không có mã khớp. Hạ điểm tối thiểu / pass hoặc bỏ bắt buộc chữ cái.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.symbol} className="row-hover border-b border-line/40 align-top">
                      <td className="px-3.5 py-2">
                        <Link href={`/stocks/${r.symbol}`} className="font-semibold hover:text-accent">
                          {r.symbol}
                        </Link>
                        <div className="text-[10px] text-text-muted">{r.sector ?? "—"}</div>
                      </td>
                      <td className="py-2">
                        <Badge tone={gradeTone(r.grade)}>{r.grade}</Badge>
                        <div className="mt-0.5 text-[10px] text-text-muted">{r.gradeVi}</div>
                      </td>
                      <td className="num py-2 text-right font-semibold">{r.score}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-0.5">
                          {ALL_LETTERS.map((L) => {
                            const hit = r.passLetters.includes(L);
                            const detail = r.letters.find((x) => x.letter === L)?.detail;
                            return (
                              <span key={L} className={passChipClass(hit)} title={detail}>
                                {L}
                              </span>
                            );
                          })}
                        </div>
                        <div className="mt-0.5 text-[10px] text-text-muted">{r.passCount}/7</div>
                      </td>
                      <td className="num py-2 text-right">
                        {r.metrics.epsYoyPct != null ? `${r.metrics.epsYoyPct.toFixed(0)}%` : "—"}
                      </td>
                      <td className="num py-2 text-right">
                        {r.metrics.roePct != null ? `${r.metrics.roePct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="num py-2 text-right">{r.metrics.rsRank != null ? r.metrics.rsRank : "—"}</td>
                      <td className="num py-2 text-right">{fmtNum(r.price, 2)}</td>
                      <td className="py-2 pr-3.5 text-right">
                        <Chg value={r.changePercent} arrow={false} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-3.5 py-2">
            <MetaLine meta={meta} />
          </div>
        </Panel>
      )}
    </div>
  );
}
