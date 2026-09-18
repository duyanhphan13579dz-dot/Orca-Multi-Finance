"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import type { WyckoffScreenRow } from "@/lib/services/wyckoff-screener";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

function VnFilterSelect({ sector, setSector }: { sector: string; setSector: (v: string) => void }) {
  return (
    <label>
      <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span>
      <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
        <option value="">Tất cả ({VN_SECTOR_MAP.length} ngành)</option>
        {VN_SECTOR_MAP.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name} ({s.symbols.length})
          </option>
        ))}
      </select>
    </label>
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

type WyckoffData = { rows: WyckoffScreenRow[]; scanned: number; skipped: number };

const WYCKOFF_PHASES = [
  { v: "all", l: "Mọi phase" },
  { v: "accumulation", l: "Accumulation" },
  { v: "re-accumulation", l: "Re-accumulation" },
  { v: "markup", l: "Markup" },
  { v: "distribution", l: "Distribution" },
  { v: "re-distribution", l: "Re-distribution" },
  { v: "markdown", l: "Markdown" },
] as const;

const WYCKOFF_SETUPS = [
  { v: "all", l: "Mọi setup" },
  { v: "spring", l: "Spring" },
  { v: "upthrust", l: "Upthrust / UTAD" },
  { v: "sos-breakout", l: "SOS breakout" },
  { v: "sow-breakdown", l: "SOW breakdown" },
  { v: "accumulation-range", l: "Range tích lũy" },
  { v: "distribution-range", l: "Range phân phối" },
] as const;

function phaseTone(phase: string): "up" | "down" | "warn" | "neutral" {
  if (phase === "accumulation" || phase === "re-accumulation" || phase === "markup") return "up";
  if (phase === "distribution" || phase === "re-distribution" || phase === "markdown") return "down";
  return "neutral";
}

function buildQs(opts: { phase: string; setup: string; minConf: string; sector: string; symbols: string; bust?: number }) {
  const qs = new URLSearchParams({
    phase: opts.phase,
    setup: opts.setup,
    minConfidence: opts.minConf || "40",
    limit: "40",
  });
  if (opts.sector) qs.set("sector", opts.sector);
  const symbols = opts.symbols
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length) qs.set("symbols", symbols.join(","));
  // cache-bust khi user bấm Tìm kiếm lại cùng bộ lọc
  if (opts.bust) qs.set("_", String(opts.bust));
  return qs.toString();
}

export function WyckoffScreener({ defaultSector }: { defaultSector: string | null }) {
  const [phase, setPhase] = useState("all");
  const [setup, setSetup] = useState("all");
  const [minConf, setMinConf] = useState("40");
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [query, setQuery] = useState(() =>
    buildQs({ phase: "all", setup: "all", minConf: "40", sector: defaultSector ?? "", symbols: "" }),
  );
  const [pressed, setPressed] = useState(false);
  const [flash, setFlash] = useState(false);
  const { res, data, meta, isLoading, isValidating, mutate } = useApi<WyckoffData>(`/api/v1/screener/wyckoff?${query}`, {
    refreshInterval: 60_000,
  });

  const run = useCallback(() => {
    setPressed(true);
    setFlash(true);
    const next = buildQs({ phase, setup, minConf, sector, symbols, bust: Date.now() });
    setQuery(next);
    // force SWR revalidate ngay cả khi key giống
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  }, [phase, setup, minConf, sector, symbols, mutate]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 900);
    return () => window.clearTimeout(t);
  }, [flash]);

  // Lọc live theo ô mã trên kết quả đang có (nhạy, không chờ API)
  const liveNeedle = symbols.trim().toUpperCase();
  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    if (!liveNeedle) return list;
    const parts = liveNeedle.split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) return list;
    return list.filter((r) => parts.some((p) => r.symbol.includes(p) || (r.name ?? "").toUpperCase().includes(p) || (r.sector ?? "").toUpperCase().includes(p)));
  }, [data, liveNeedle]);

  const busy = isLoading || isValidating;

  return (
    <>
      <Panel pad={false}>
        <div className={`space-y-2 p-4 transition-shadow duration-300 ${flash ? "ring-2 ring-accent-primary/60 shadow-[0_0_0_3px_rgba(59,130,246,0.15)]" : ""}`}>
          <div className="text-[13px] font-medium">Bộ lọc Wyckoff — rổ thanh khoản VN</div>
          <p className="text-[12px] leading-relaxed text-text-muted">
            Đọc chu kỳ Composite Man trên nến ngày. Gõ mã để lọc nhanh kết quả; đổi phase/setup/ngành rồi bấm <strong>Tìm kiếm</strong> để quét lại toàn rổ.
          </p>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <label>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Phase</span>
              <select value={phase} onChange={(e) => setPhase(e.target.value)} className="input !w-44 !py-1.5 text-[12px]">
                {WYCKOFF_PHASES.map((p) => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Setup</span>
              <select value={setup} onChange={(e) => setSetup(e.target.value)} className="input !w-44 !py-1.5 text-[12px]">
                {WYCKOFF_SETUPS.map((p) => (
                  <option key={p.v} value={p.v}>{p.l}</option>
                ))}
              </select>
            </label>
            <VnFilterSelect sector={sector} setSector={setSector} />
            <Field label="Tin cậy ≥" value={minConf} onChange={setMinConf} small />
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
                placeholder="VCB, HPG, FPT"
                className="input !w-44 !py-1.5 text-[12px] focus:ring-2 focus:ring-accent-primary/50"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              onClick={run}
              disabled={busy && pressed}
              aria-busy={busy}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white transition-all duration-150
                ${pressed ? "scale-95 bg-accent-primary ring-2 ring-white/40" : "bg-accent-primary/90 hover:bg-accent-primary"}
                ${busy ? "opacity-90" : ""}
                active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary`}
            >
              {busy ? (
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
              ) : (
                <Play className="size-3.5" />
              )}
              {busy ? "Đang quét…" : "Tìm kiếm"}
            </button>
          </div>
          {flash && (
            <div className="text-[11px] font-medium text-accent-primary animate-pulse">
              Đã áp dụng bộ lọc — đang tải kết quả…
            </div>
          )}
        </div>
      </Panel>

      {isLoading && !res ? (
        <Loading rows={8} />
      ) : !data ? (
        <Unavailable title="Wyckoff screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel
          title={
            <span>
              {rows.length} mã{liveNeedle ? ` (lọc “${liveNeedle}”)` : ""} · quét {data.scanned} · bỏ {data.skipped} thiếu nến{" "}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              {isValidating ? <span className="ml-1.5 text-[10px] text-accent-primary">· đang cập nhật</span> : null}
            </span>
          }
          pad={false}
        >
          <div className={`overflow-x-auto transition-opacity duration-200 ${isValidating ? "opacity-70" : "opacity-100"}`}>
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="px-3.5 py-2 font-medium">Mã</th>
                  <th className="py-2 font-medium">Phase</th>
                  <th className="py-2 font-medium">Setup</th>
                  <th className="py-2 text-right font-medium">Tin cậy</th>
                  <th className="py-2 text-right font-medium">Giá</th>
                  <th className="py-2 text-right font-medium">Δ%</th>
                  <th className="py-2 pr-3.5 font-medium">Sự kiện</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3.5 py-6 text-center text-text-muted">
                      Không có mã khớp. Thử xóa ô mã hoặc nới lọc phase/setup rồi bấm Tìm kiếm.
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
                        <Badge tone={phaseTone(r.phase)}>{r.phaseVi}{r.subPhase ? ` · ${r.subPhase}` : ""}</Badge>
                      </td>
                      <td className="py-2 text-ink-2">{r.setupVi}</td>
                      <td className="num py-2 text-right">{r.confidence}%</td>
                      <td className="num py-2 text-right">{fmtNum(r.price, 2)}</td>
                      <td className="py-2 text-right"><Chg value={r.changePercent} arrow={false} /></td>
                      <td className="max-w-[280px] py-2 pr-3.5 text-[11px] leading-snug text-ink-2">
                        {r.events[0] ?? r.notes[0] ?? "—"}
                      </td>
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
