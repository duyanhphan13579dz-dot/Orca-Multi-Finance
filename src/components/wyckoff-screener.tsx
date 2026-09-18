"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import type { WyckoffScreenRow } from "@/lib/services/wyckoff-screener";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";

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

export function WyckoffScreener({ defaultSector }: { defaultSector: string | null }) {
  const [phase, setPhase] = useState("all");
  const [setup, setSetup] = useState("all");
  const [minConf, setMinConf] = useState("40");
  const [sector, setSector] = useState(defaultSector ?? "");
  const qs = new URLSearchParams({
    phase,
    setup,
    minConfidence: minConf || "40",
    limit: "40",
  });
  if (sector) qs.set("sector", sector);
  const { res, data, meta, isLoading } = useApi<WyckoffData>(`/api/v1/screener/wyckoff?${qs.toString()}`, {
    refreshInterval: 60_000,
  });

  return (
    <>
      <Panel pad={false}>
        <div className="space-y-2 p-4">
          <div className="text-[13px] font-medium">Bộ lọc Wyckoff — rổ thanh khoản VN</div>
          <p className="text-[12px] leading-relaxed text-text-muted">
            Đọc chu kỳ Composite Man trên nến ngày: Phase A dừng xu hướng cũ, B xây nguyên nhân, C test (Spring / UTAD),
            D xác nhận (SOS / SOW), E rời range. Spring không bắt buộc. Kết quả heuristic, độ tin cậy kèm theo.
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
          </div>
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
              {data.rows.length} mã · quét {data.scanned} · bỏ {data.skipped} thiếu nến{" "}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            </span>
          }
          pad={false}
        >
          <div className="overflow-x-auto">
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
                {data.rows.map((r) => (
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
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-3.5 py-2"><MetaLine meta={meta} /></div>
        </Panel>
      )}
    </>
  );
}
