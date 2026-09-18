"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import type { CanslimScreenRow } from "@/lib/services/canslim-screener";
import type { CanslimLetter } from "@/lib/engines/canslim";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

type CanslimData = {
  rows: CanslimScreenRow[];
  scanned: number;
  skipped: number;
  marketBullish: boolean | null;
};

const ALL_LETTERS: CanslimLetter[] = ["C", "A", "N", "S", "L", "I", "M"];

function gradeTone(g: string): "up" | "down" | "warn" | "neutral" {
  if (g === "A" || g === "B") return "up";
  if (g === "D" || g === "F") return "down";
  if (g === "C") return "warn";
  return "neutral";
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

  return (
    <>
      <Panel pad={false}>
        <div className={`space-y-2 p-4 transition-shadow duration-300 ${flash ? "ring-2 ring-accent-primary/60" : ""}`}>
          <div className="text-[13px] font-medium">Bộ lọc CAN SLIM — growth leaders VN</div>
          <p className="text-[12px] leading-relaxed text-text-muted">
            Theo William O'Neil: <strong>C</strong>urrent EPS/LN quý, <strong>A</strong>nnual/ROE, <strong>N</strong>ear 52W high,
            <strong> S</strong>upply–Demand (volume), <strong>L</strong>eader (RS rank), <strong>I</strong>nstitutional (proxy NN),
            <strong> M</strong>arket. Heuristic trên BCTC + nến ngày thật — không phải tín hiệu mua bán.
            {data?.marketBullish === true ? (
              <span className="ml-1 text-emerald-500">M: thị trường nghiêng tăng.</span>
            ) : data?.marketBullish === false ? (
              <span className="ml-1 text-amber-500">M: thị trường yếu — nên thận trọng.</span>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_LETTERS.map((L) => (
              <button
                key={L}
                type="button"
                onClick={() => toggleLetter(L)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold border transition-colors ${
                  letters.includes(L)
                    ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                    : "border-line bg-panel-2 text-ink-2 hover:border-accent-primary/40"
                }`}
                title={`Bắt buộc pass chữ ${L}`}
              >
                {L}
              </button>
            ))}
            <span className="self-center text-[10px] text-text-muted">bắt buộc pass (tùy chọn)</span>
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <label>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Điểm ≥</span>
              <input value={minScore} onChange={(e) => setMinScore(e.target.value)} inputMode="decimal" className="num input !w-20 !py-1.5 text-[12px]" />
            </label>
            <label>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Pass ≥</span>
              <input value={minPass} onChange={(e) => setMinPass(e.target.value)} inputMode="numeric" className="num input !w-16 !py-1.5 text-[12px]" />
            </label>
            <label>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span>
              <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
                <option value="">Tất cả ({VN_SECTOR_MAP.length})</option>
                {VN_SECTOR_MAP.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Mã (live)</span>
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
                className="input !w-36 !py-1.5 text-[12px] focus:ring-2 focus:ring-accent-primary/50"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              onClick={run}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white transition-all duration-150
                ${pressed ? "scale-95 bg-accent-primary ring-2 ring-white/40" : "bg-accent-primary/90 hover:bg-accent-primary"}
                active:scale-95`}
            >
              {busy ? (
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Play className="size-3.5" />
              )}
              {busy ? "Đang quét…" : "Tìm kiếm"}
            </button>
          </div>
          {flash && <div className="text-[11px] font-medium text-accent-primary animate-pulse">Đã áp dụng bộ lọc CANSLIM…</div>}
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
          <div className={`overflow-x-auto transition-opacity ${isValidating ? "opacity-70" : ""}`}>
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
                        <Link href={`/stocks/${r.symbol}`} className="font-semibold hover:text-accent">{r.symbol}</Link>
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
                            return (
                              <span
                                key={L}
                                className={`inline-block rounded px-1 text-[10px] font-bold ${hit ? "bg-emerald-500/20 text-emerald-400" : "bg-panel-2 text-ink-3"}`}
                                title={r.letters.find((x) => x.letter === L)?.detail}
                              >
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
                      <td className="num py-2 text-right">
                        {r.metrics.rsRank != null ? r.metrics.rsRank : "—"}
                      </td>
                      <td className="num py-2 text-right">{fmtNum(r.price, 2)}</td>
                      <td className="py-2 pr-3.5 text-right"><Chg value={r.changePercent} arrow={false} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-3.5 py-2"><MetaLine meta={meta} /></div>
        </Panel>
      )}
    </>
  );
}
