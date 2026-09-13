/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarDays, ExternalLink, Gauge, Globe2, Users, Waypoints } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { StockCompanyPackage } from "@/lib/services/stock-company";
import { Badge, fmtCompact, fmtNum, Loading, MetaLine, Panel, PanelMetric, Unavailable } from "@/components/ui";

type Insight = string | { text: string; source?: string; confidence?: "high" | "medium" | "low"; meta?: { source?: string } };

type Tone = "up" | "down" | "accent" | "warn";

function insightText(item: Insight) {
  return typeof item === "string" ? item : item.text;
}

function InsightList({ items, empty }: { items: Insight[]; empty: string }) {
  if (!items.length) return <p className="text-[12px] text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => {
        const object = typeof item === "string" ? null : item;
        return (
          <li key={`${insightText(item)}-${index}`} className="rounded-md border border-line/60 bg-bg-2/40 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
            <div className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current text-accent" /><span>{insightText(item)}</span></div>
            {object && (object.source || object.confidence) && (
              <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-ink-3">
                {object.source && <span>{object.source}</span>}
                {object.confidence && <span className="uppercase tracking-wide">Độ tin cậy: {object.confidence}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SectionHeading({ eyebrow, title, count, tone = "accent" }: { eyebrow: string; title: string; count?: number; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><span className={`size-2 rounded-full ${tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : tone === "warn" ? "bg-warn" : "bg-accent"}`} /><div><div className="text-[10px] uppercase tracking-[0.16em] text-ink-3">{eyebrow}</div><h2 className="text-[14px] font-semibold text-ink">{title}</h2></div></div>
      {count != null && <Badge tone={tone}>{count} insight</Badge>}
    </div>
  );
}

function ValueChainStep({ index, label, items, tone }: { index: string; label: string; items: string[]; tone: Tone }) {
  return (
    <div className="relative flex min-h-[150px] flex-col gap-3 rounded-lg border border-line/70 bg-bg-2/45 p-3">
      <div className="flex items-center justify-between"><Badge tone={tone}>{index}</Badge><span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{items.length} mục</span></div>
      <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
      {items.length ? <ul className="flex flex-col gap-2 text-[11px] leading-relaxed text-ink-2">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="text-ink-3">—</span>{x}</li>)}</ul> : <p className="text-[11px] text-ink-3">Chưa có dữ liệu.</p>}
    </div>
  );
}

export default function StockProfilePage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => { params.then((p) => setSymbol(p.symbol.toUpperCase())); }, [params]);

  const { res, data, isLoading } = useApi<StockCompanyPackage>(symbol ? `/api/v1/stocks/${symbol}/profile` : null, { refreshInterval: 600_000 });
  const pie = useMemo(() => {
    const list = (data?.shareholders ?? []).filter((s) => s.ownershipPct != null && s.ownershipPct > 0).slice(0, 8);
    return list.map((s) => ({ name: s.name, pct: s.ownershipPct ?? 0 }));
  }, [data]);

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data) return <Unavailable title={`Không lấy được hồ sơ ${symbol}`} note={res && !res.success ? res.error.message : "Nguồn hồ sơ đang gián đoạn."} />;

  const p = data.profile;
  const swot = data.swot;
  const totalInsights = (data.catalysts?.length ?? 0) + (data.risks?.length ?? 0) + (swot ? swot.strengths.length + swot.weaknesses.length + swot.opportunities.length + swot.threats.length : 0);
  const profileMeta = res.meta;

  return (
    <main className="flex flex-col gap-5">
      <section className="panel panel-elevated overflow-hidden">
        <div className="border-b border-line/70 bg-gradient-to-br from-accent/10 via-transparent to-transparent p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row">
              {p?.logo ? <img src={p.logo} alt={p.vnName ?? symbol} className="!h-14 !w-14 max-h-14 max-w-14 shrink-0 rounded-lg border border-line bg-white object-contain" /> : <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-2 text-accent"><Building2 /></div>}
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-accent/15 px-2 py-0.5 text-[12px] font-bold tracking-wide text-accent">{symbol}</span>{p?.floor && <Badge>{p.floor}</Badge>}</div><h1 className="mt-2 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{p?.vnName ?? symbol}</h1>{p?.enName && <p className="truncate text-[12px] text-ink-3">{p.enName}</p>}<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-3"><span className="inline-flex items-center gap-1"><Waypoints /> Hồ sơ doanh nghiệp</span>{p?.website && <a className="inline-flex items-center gap-1 text-accent hover:underline" href={p.website} target="_blank" rel="noreferrer">Website <ExternalLink /></a>}</div></div>
            </div>
            <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto lg:max-w-[48%]"><PanelMetric label="Nhân sự" value={p?.employees != null ? fmtNum(p.employees, 0) : "—"} tone="neutral" /><PanelMetric label="Ngày thành lập" value={p?.foundDate ? p.foundDate : "—"} tone="neutral" /><PanelMetric label="Tín hiệu nghiên cứu" value={totalInsights || "—"} detail="SWOT + catalyst + risk" tone={totalInsights ? "up" : "warn"} /></div>
          </div>
          {p?.vnSummary && <p className="mt-5 max-w-4xl text-[12px] leading-relaxed text-ink-2">{p.vnSummary}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5"><MetaLine meta={profileMeta} />{p?.taxCode && <span className="text-[10px] text-ink-3">MST {p.taxCode}</span>}{p?.vnAddress && <span className="inline-flex items-center gap-1 text-[10px] text-ink-3"><Globe2 />{p.vnAddress}</span>}</div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
        <Panel title={<SectionHeading eyebrow="Research snapshot" title="SWOT doanh nghiệp" count={swot ? swot.strengths.length + swot.weaknesses.length + swot.opportunities.length + swot.threats.length : 0} />} subtitle="Các luận điểm được suy ra từ hồ sơ, BCTC và dữ liệu thị trường.">
          {!swot ? <p className="text-[12px] text-ink-3">SWOT sẽ được dựng từ dữ liệu có kiểm chứng — không điền nội dung suy đoán.</p> : <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-up/20 bg-up/5 p-3"><h3 className="mb-2 text-[11px] font-semibold text-up">S · Điểm mạnh</h3><InsightList items={swot.strengths as Insight[]} empty="Chưa có luận điểm." /></div><div className="rounded-lg border border-down/20 bg-down/5 p-3"><h3 className="mb-2 text-[11px] font-semibold text-down">W · Điểm yếu</h3><InsightList items={swot.weaknesses as Insight[]} empty="Chưa có luận điểm." /></div><div className="rounded-lg border border-accent/20 bg-accent/5 p-3"><h3 className="mb-2 text-[11px] font-semibold text-accent">O · Cơ hội</h3><InsightList items={swot.opportunities as Insight[]} empty="Chưa có luận điểm." /></div><div className="rounded-lg border border-warn/20 bg-warn/5 p-3"><h3 className="mb-2 text-[11px] font-semibold text-warn">T · Thách thức</h3><InsightList items={swot.threats as Insight[]} empty="Chưa có luận điểm." /></div></div>}
        </Panel>
        <div className="flex flex-col gap-3"><Panel title={<SectionHeading eyebrow="Growth drivers" title="Catalyst tăng trưởng" count={data.catalysts.length} tone="up" />}><InsightList items={data.catalysts as Insight[]} empty="Chưa có catalyst đã xác thực." /></Panel><Panel title={<SectionHeading eyebrow="Downside watch" title="Yếu tố rủi ro" count={data.risks.length} tone="warn" />}><InsightList items={data.risks as Insight[]} empty="Chưa có rủi ro đã xác thực." /></Panel></div>
      </div>

      <Panel title={<SectionHeading eyebrow="Business model" title="Chuỗi giá trị doanh nghiệp" />} subtitle="Dòng chảy từ đầu vào đến sản phẩm và doanh thu.">
        {data.valueChain ? <div className="grid gap-2 md:grid-cols-3 md:items-stretch"><ValueChainStep index="01" label="Input · Đầu vào" items={data.valueChain.input} tone="accent" /><div className="hidden items-center justify-center md:flex"><ArrowRight className="text-ink-3" /></div><ValueChainStep index="02" label="Process · Vận hành" items={data.valueChain.process} tone="up" /><div className="hidden items-center justify-center md:flex"><ArrowRight className="text-ink-3" /></div><ValueChainStep index="03" label="Output · Đầu ra" items={data.valueChain.output} tone="warn" /></div> : <p className="text-[12px] text-ink-3">Chuỗi giá trị sẽ được điền từ phân tích ngành hoặc tài liệu IR.</p>}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]"><Panel title={<SectionHeading eyebrow="Ownership" title="Cổ đông lớn" count={data.shareholders.length} />}><div className="overflow-x-auto">{data.shareholders.length ? <table className="w-full text-[11px]"><thead><tr className="border-b border-line text-left text-ink-3"><th className="py-2 pr-2">Cổ đông</th><th className="py-2 pr-2">Vai trò</th><th className="num py-2 text-right">SL CP</th><th className="num py-2 text-right">%</th></tr></thead><tbody>{data.shareholders.slice(0, 15).map((s, i) => <tr key={i} className="border-b border-line/40"><td className="max-w-[180px] truncate py-2 pr-2 text-ink-2">{s.name}</td><td className="py-2 pr-2 text-ink-3">{s.role ?? "—"}</td><td className="num py-2 text-right">{s.shares != null ? fmtCompact(s.shares) : "—"}</td><td className="num py-2 text-right">{s.ownershipPct != null ? `${s.ownershipPct.toFixed(2)}%` : "—"}</td></tr>)}</tbody></table> : <p className="text-[12px] text-ink-3">Chưa có dữ liệu cổ đông.</p>}</div></Panel><Panel title={<SectionHeading eyebrow="Concentration" title="Phân bố sở hữu" />}><div className="flex flex-col gap-2">{pie.length ? pie.map((s) => <div key={s.name}><div className="mb-1 flex justify-between text-[11px]"><span className="max-w-[70%] truncate text-ink-2">{s.name}</span><span className="num text-ink-3">{s.pct.toFixed(2)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-bg-2"><div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.min(100, Math.max(2, s.pct))}%` }} /></div></div>) : <p className="text-[12px] text-ink-3">Chưa đủ dữ liệu để vẽ phân bố.</p>}<p className="text-[10px] text-ink-3">Top cổ đông theo dữ liệu VNDirect.</p></div></Panel></div>

      <Panel title={<SectionHeading eyebrow="Governance" title="Hội đồng quản trị" count={data.board.length} />}><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{data.board.length ? data.board.map((b, i) => <div key={i} className="rounded-md border border-line/60 bg-bg-2/40 p-3 text-[12px]"><div className="font-medium text-ink">{b.name}</div><div className="mt-1 text-ink-3">{b.role}</div></div>) : <p className="text-[12px] text-ink-3">Chưa có dữ liệu HĐQT từ nguồn hiện tại.</p>}</div></Panel>
      {data.notes.length > 0 && <p className="flex items-center gap-2 text-[11px] text-warn/90"><Gauge />{data.notes.join(" • ")}</p>}
    </main>
  );
}
