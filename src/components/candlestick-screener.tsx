"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Play } from "@/components/screener-icons";

type PatternHit = {
  name: string;
  nameVi: string;
  type: "bullish" | "bearish" | "neutral";
  category: string;
  reliability: string;
  score: number;
  volumeConfirmed: boolean;
};

type CandleRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  patterns: PatternHit[];
  bestScore: number;
  bestPattern: PatternHit | null;
  alertWorthy: boolean;
};

type ScreenPayload = {
  rows: CandleRow[];
  scanned: number;
  skipped: number;
  meta?: { freshness?: string; ageMs?: number; note?: string };
};

const CATEGORIES = [
  { id: "all", label: "Tất cả" },
  { id: "bullish_reversal", label: "Đảo chiều tăng" },
  { id: "bearish_reversal", label: "Đảo chiều giảm" },
  { id: "continuation", label: "Tiếp diễn" },
  { id: "neutral", label: "Trung tính" },
] as const;

export function CandlestickScreener({ defaultSector }: { defaultSector?: string | null }) {
  const [sector, setSector] = useState(defaultSector ?? "");
  const [category, setCategory] = useState("all");
  const [minScore, setMinScore] = useState("50");
  const [volumeOnly, setVolumeOnly] = useState(false);
  const [reversalOnly, setReversalOnly] = useState(true);
  const [pressed, setPressed] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (sector) p.set("sector", sector);
    if (category !== "all") p.set("category", category);
    if (minScore) p.set("minScore", minScore);
    if (volumeOnly) p.set("volumeOnly", "1");
    if (reversalOnly) p.set("reversalOnly", "1");
    p.set("limit", "50");
    return p.toString();
  }, [sector, category, minScore, volumeOnly, reversalOnly]);

  const { res, data, meta, isLoading, isValidating, mutate } = useApi<ScreenPayload>(
    `/api/v1/screener/candlestick?${qs}`,
    { refreshInterval: 90_000, timeoutMs: 90_000 },
  );

  const run = useCallback(() => {
    setPressed(true);
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  }, [mutate]);

  const rows = data?.rows ?? [];

  if (isLoading && !res) return <Loading rows={8} />;

  if (!res?.success && !data) {
    return (
      <Unavailable
        title="Screener mẫu nến chưa sẵn sàng"
        note={res && !res.success ? res.error.message : "Thử lại sau vài giây"}
      />
    );
  }

  return (
    <>
      <Panel title="Bộ lọc mẫu hình nến" pad={false}>
        <div className="flex flex-wrap items-end gap-2 p-3">
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ngành</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
              <option value="">Tất cả</option>
              {VN_SECTOR_MAP.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Nhóm mẫu</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input !w-40 !py-1.5 text-[12px]">
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Điểm min</span>
            <input value={minScore} onChange={(e) => setMinScore(e.target.value)} className="input !w-20 !py-1.5 text-[12px]" inputMode="numeric" />
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[12px]">
            <input type="checkbox" checked={reversalOnly} onChange={(e) => setReversalOnly(e.target.checked)} />
            Chỉ đảo chiều
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[12px]">
            <input type="checkbox" checked={volumeOnly} onChange={(e) => setVolumeOnly(e.target.checked)} />
            Có volume
          </label>
          <button
            type="button"
            onClick={run}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white ${
              pressed ? "scale-95 bg-accent-primary" : "bg-accent-primary/90 hover:bg-accent-primary"
            }`}
          >
            <Play className="size-3.5" />
            {isValidating ? "Đang quét…" : "Quét mẫu nến"}
          </button>
        </div>
      </Panel>

      <Panel
        title={
          <span>
            Mẫu nến: {rows.length} mã
            {data ? ` · quét ${data.scanned}` : ""}
            <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            {isValidating ? <span className="ml-1.5 text-[10px] text-accent-primary">· đang cập nhật</span> : null}
          </span>
        }
        pad={false}
      >
        {rows.length === 0 ? (
          <div className="px-3.5 py-8 text-center text-[13px] text-text-muted">
            Không có mẫu khớp. Thử nới điểm min hoặc tắt “Chỉ đảo chiều”.
            {data?.skipped ? <div className="mt-1 text-[11px]">Đã bỏ qua {data.skipped} mã thiếu nến.</div> : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="px-3.5 py-2 font-medium">Mã</th>
                  <th className="py-2 font-medium">Mẫu nến</th>
                  <th className="py-2 text-right font-medium">Điểm</th>
                  <th className="py-2 text-right font-medium">Giá</th>
                  <th className="py-2 pr-3.5 text-right font-medium">± %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.symbol} className="row-hover border-b border-line/40">
                    <td className="px-3.5 py-2">
                      <Link href={`/stocks/${row.symbol}`} className="font-semibold hover:text-accent">{row.symbol}</Link>
                      {row.alertWorthy ? <span className="ml-1.5"><Badge tone="bull">Alert</Badge></span> : null}
                    </td>
                    <td className="py-2 text-[11px]">
                      <span className={row.bestPattern?.type === "bullish" ? "text-bull" : row.bestPattern?.type === "bearish" ? "text-bear" : ""}>
                        {row.bestPattern?.nameVi ?? row.bestPattern?.name ?? "—"}
                      </span>
                    </td>
                    <td className="num py-2 text-right font-medium">{row.bestScore}</td>
                    <td className="num py-2 text-right">{fmtNum(row.price, 2)}</td>
                    <td className="py-2 pr-3.5 text-right"><Chg value={row.changePercent} arrow={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3.5 py-2">
          <MetaLine meta={meta ?? data?.meta} />
          <p className="mt-1 text-[10px] text-text-muted">Ưu tiên mẫu đảo chiều · heuristic nghiên cứu, không phải tín hiệu mua/bán.</p>
        </div>
      </Panel>
    </>
  );
}
