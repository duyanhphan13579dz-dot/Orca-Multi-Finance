"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";
import type { ElliottPattern, ElliottScreenRow } from "@/lib/services/elliott-screener";

type Data = { rows: ElliottScreenRow[]; scanned: number; skipped: number };

const patterns: { v: ElliottPattern | "all"; l: string }[] = [
  { v: "all", l: "Mọi cấu trúc" },
  { v: "impulse-up", l: "Xung lực tăng" },
  { v: "impulse-down", l: "Xung lực giảm" },
  { v: "corrective-abc-up", l: "Điều chỉnh ABC tăng" },
  { v: "corrective-abc-down", l: "Điều chỉnh ABC giảm" },
  { v: "unclear", l: "Chưa rõ" },
];

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

function tone(bias: string): "up" | "down" | "neutral" {
  return bias === "bullish" ? "up" : bias === "bearish" ? "down" : "neutral";
}

function qs(pattern: string, confidence: string, sector: string, symbols: string, bust?: number) {
  const p = new URLSearchParams({ pattern, minConfidence: confidence || "25", limit: "40" });
  if (sector) p.set("sector", sector);
  const ss = symbols
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((s) => s.toUpperCase());
  if (ss.length) p.set("symbols", ss.join(","));
  if (bust) p.set("_", String(bust));
  return p.toString();
}

export function ElliottScreener({ defaultSector }: { defaultSector: string | null }) {
  const [pattern, setPattern] = useState("all");
  const [confidence, setConfidence] = useState("25");
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [query, setQuery] = useState(() => qs("all", "25", defaultSector ?? "", ""));
  const { res, data, meta, isLoading, isValidating, mutate } = useApi<Data>(`/api/v1/screener/elliott?${query}`, {
    refreshInterval: 60_000,
    timeoutMs: 90_000,
  });

  const run = useCallback(() => {
    setQuery(qs(pattern, confidence, sector, symbols, Date.now()));
    void mutate();
  }, [pattern, confidence, sector, symbols, mutate]);

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  return (
    <div className="space-y-3">
      <Panel title="Elliott Wave Screener — rổ thanh khoản VN">
        <p className="mb-3 text-[12px] leading-relaxed text-text-muted">
          Phân loại pivot OHLCV thành xung lực 1–2–3–4–5 hoặc điều chỉnh ABC, kiểm tra ba quy tắc cốt lõi và vùng
          Fibonacci 38,2%. Heuristic nghiên cứu — không phải tín hiệu mua bán.
        </p>

        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Cấu trúc sóng</div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <FilterChip title="Cấu trúc" className="min-w-[10rem]">
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="input !w-full !px-2 !py-1.5 text-[12px]"
            >
              {patterns.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.l}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip title="Tin cậy ≥">
            <input
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              inputMode="numeric"
              placeholder="25"
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
              <option value="">Tất cả</option>
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
              placeholder="VCB, FPT"
              className="input !w-full !px-2 !py-1.5 text-[12px]"
            />
          </FilterChip>
          <button
            type="button"
            onClick={run}
            className="inline-flex h-[2.65rem] items-center gap-1.5 self-end rounded-lg bg-accent-primary px-4 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-primary/90"
          >
            <Play className="size-3.5" />
            {isValidating ? "Đang quét…" : "Tìm kiếm"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <MetaLine meta={meta} />
          <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
        </div>
      </Panel>

      {isLoading && !res ? (
        <Loading rows={8} />
      ) : !data ? (
        <Unavailable title="Elliott screener không khả dụng" note={res && !res.success ? res.error.message : undefined} />
      ) : (
        <Panel
          title={
            <span>
              {rows.length} mã · quét {data.scanned} · bỏ {data.skipped} thiếu nến{" "}
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            </span>
          }
          pad={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="px-3.5 py-2">Mã</th>
                  <th className="py-2">Mẫu</th>
                  <th className="py-2">Sóng</th>
                  <th className="py-2 text-right">Tin cậy</th>
                  <th className="py-2 text-right">Mục tiêu</th>
                  <th className="py-2 text-right">Vô hiệu</th>
                  <th className="py-2 pr-3.5">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3.5 py-6 text-center text-text-muted">
                      Không có mã khớp điều kiện.
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
                        <Badge tone={tone(r.bias)}>{r.patternVi}</Badge>
                        <div className="mt-1 text-[10px] text-text-muted">{r.degree}</div>
                      </td>
                      <td className="py-2 text-ink-2">{r.waves.map((w) => w.label).join(" → ") || "—"}</td>
                      <td className="num py-2 text-right">
                        {r.confidence}%
                        <div>
                          <Chg value={r.changePercent} arrow={false} />
                        </div>
                      </td>
                      <td className="num py-2 text-right">{fmtNum(r.nextTarget, 2)}</td>
                      <td className="num py-2 text-right">{fmtNum(r.invalidation, 2)}</td>
                      <td className="max-w-[260px] py-2 pr-3.5 text-[11px] leading-snug text-ink-2">
                        {r.notes[0] ?? "—"}
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

      <Panel title="Cách đọc kết quả Elliott">
        <p className="text-[12px] leading-relaxed text-ink-2">
          Xung lực tăng/giảm cần 5 chân và tuân thủ: sóng 2 không vượt điểm đầu sóng 1, sóng 3 không ngắn nhất, sóng 4
          không chồng vùng sóng 1. Mẫu ABC chỉ là ứng viên; nên đối chiếu đa khung thời gian, Fibonacci và quản trị rủi
          ro.
        </p>
      </Panel>
    </div>
  );
}
