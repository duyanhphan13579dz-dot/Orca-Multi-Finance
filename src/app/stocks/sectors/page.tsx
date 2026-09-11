"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { Chg, fmtCompact, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";

interface SectorMember {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  quoteVolume: number | null;
}

interface SectorRow {
  sector: string;
  count: number;
  universeCount: number;
  avgChangePercent: number | null;
  medianChangePercent: number | null;
  advances: number;
  declines: number;
  unchanged: number;
  totalVolume: number;
  totalValue: number;
  trendScore: number | null;
  trendLabelVi: string;
  topGainers: SectorMember[];
  topLosers: SectorMember[];
}

interface SectorTrendPayload {
  sessionDate: string | null;
  marketAvgChangePercent: number | null;
  leaders: SectorRow[];
  laggards: SectorRow[];
  sectors: SectorRow[];
  count: number;
}

function scoreTone(score: number | null): string {
  if (score == null) return "text-ink-3";
  if (score >= 15) return "text-up";
  if (score <= -15) return "text-down";
  return "text-ink-2";
}

export default function SectorTrendPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { res, data, meta, isLoading } = useApi<SectorTrendPayload>("/api/v1/market/sector-trend", {
    refreshInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const list = data?.sectors ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((s) => s.sector.toLowerCase().includes(needle));
  }, [data, q]);

  const detail = useMemo(() => {
    if (!selected || !data?.sectors) return null;
    return data.sectors.find((s) => s.sector === selected) ?? null;
  }, [selected, data]);

  if (isLoading && !res) return <Loading rows={10} />;

  if (!res?.success || !data) {
    return (
      <Unavailable
        title="Chưa có phân tích xu hướng ngành"
        note={res && !res.success ? res.error.message : "Cần bảng giá SSI/VN để tổng hợp theo ngành."}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Panel title="Phân tích xu hướng ngành">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          {data.sessionDate && (
            <span>
              Phiên <strong className="text-ink-2">{data.sessionDate}</strong>
            </span>
          )}
          <span>
            TB thị trường{" "}
            <Chg value={data.marketAvgChangePercent} className="font-medium" />
          </span>
          <span>{data.count} nhóm ngành</span>
          <span className="ml-auto">
            <MetaLine meta={meta} />
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-medium text-ink-3">Ngành dẫn dắt</div>
            <ul className="space-y-1 text-[12px]">
              {data.leaders.map((s) => (
                <li key={s.sector} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-ink-2 hover:text-accent"
                    onClick={() => setSelected(s.sector)}
                  >
                    {s.sector}
                  </button>
                  <span className="flex items-center gap-2">
                    <Chg value={s.avgChangePercent} />
                    <span className={`num text-[11px] ${scoreTone(s.trendScore)}`}>
                      {s.trendScore != null ? s.trendScore : "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-ink-3">Ngành yếu</div>
            <ul className="space-y-1 text-[12px]">
              {data.laggards.map((s) => (
                <li key={s.sector} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-ink-2 hover:text-accent"
                    onClick={() => setSelected(s.sector)}
                  >
                    {s.sector}
                  </button>
                  <span className="flex items-center gap-2">
                    <Chg value={s.avgChangePercent} />
                    <span className={`num text-[11px] ${scoreTone(s.trendScore)}`}>
                      {s.trendScore != null ? s.trendScore : "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="Bảng xếp hạng ngành"
        right={
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lọc ngành…"
            className="rounded-md border border-line bg-bg-2 px-2 py-1 text-[11px] text-ink-2 outline-none focus:border-accent"
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-2 font-medium">Ngành</th>
                <th className="num py-1.5 font-medium">Xu hướng</th>
                <th className="num py-1.5 font-medium">Điểm</th>
                <th className="num py-1.5 font-medium">% TB</th>
                <th className="num py-1.5 font-medium">Tăng/Giảm</th>
                <th className="num py-1.5 font-medium">GTGD</th>
                <th className="num py-1.5 font-medium">Mã</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.sector}
                  className={`cursor-pointer border-b border-line/40 hover:bg-accent/5 ${
                    selected === s.sector ? "bg-accent/10" : ""
                  }`}
                  onClick={() => setSelected(s.sector)}
                >
                  <td className="py-1.5 pr-2 font-medium text-ink-2">{s.sector}</td>
                  <td className={`num py-1.5 ${scoreTone(s.trendScore)}`}>{s.trendLabelVi}</td>
                  <td className={`num py-1.5 ${scoreTone(s.trendScore)}`}>
                    {s.trendScore != null ? s.trendScore : "—"}
                  </td>
                  <td className="num py-1.5">
                    <Chg value={s.avgChangePercent} />
                  </td>
                  <td className="num py-1.5 text-ink-3">
                    <span className="text-up">{s.advances}</span>/
                    <span className="text-down">{s.declines}</span>
                  </td>
                  <td className="num py-1.5">{fmtCompact(s.totalValue)}</td>
                  <td className="num py-1.5 text-ink-3">
                    {s.count}/{s.universeCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {detail && (
        <Panel title={`Chi tiết · ${detail.sector}`}>
          <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-ink-3">
            <span>
              Xu hướng:{" "}
              <strong className={scoreTone(detail.trendScore)}>{detail.trendLabelVi}</strong>
            </span>
            <span>
              % trung bình: <Chg value={detail.avgChangePercent} />
            </span>
            <span>
              % trung vị: <Chg value={detail.medianChangePercent} />
            </span>
            <span>
              Breadth: {detail.advances} tăng / {detail.declines} giảm / {detail.unchanged} đứng
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">Top tăng trong ngành</div>
              <ul className="space-y-1 text-[12px]">
                {detail.topGainers.map((m) => (
                  <li key={m.symbol} className="flex justify-between gap-2">
                    <Link href={`/stocks/${m.symbol}`} className="text-accent hover:underline">
                      {m.symbol}
                    </Link>
                    <Chg value={m.changePercent} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">Top giảm trong ngành</div>
              <ul className="space-y-1 text-[12px]">
                {detail.topLosers.map((m) => (
                  <li key={m.symbol} className="flex justify-between gap-2">
                    <Link href={`/stocks/${m.symbol}`} className="text-accent hover:underline">
                      {m.symbol}
                    </Link>
                    <Chg value={m.changePercent} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
