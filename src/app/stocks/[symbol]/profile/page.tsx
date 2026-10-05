/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarDays, ExternalLink, Gauge, Globe2, RefreshCw, Users, Waypoints } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { StockCompanyPackage } from "@/lib/services/stock-company";
import { Badge, fmtCompact, fmtNum, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";

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
            <div className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current text-accent" />
              <span>{insightText(item)}</span>
            </div>
            {object && (object.source || object.confidence) && (
              <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-ink-3">
                {object.source && <span>{object.source}</span>}
                {object.confidence && (
                  <span className="uppercase tracking-wide">Độ tin cậy: {object.confidence}</span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SectionHeading({
  eyebrow,
  title,
  count,
  tone = "accent",
}: {
  eyebrow: string;
  title: string;
  count?: number;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${
            tone === "up"
              ? "bg-up"
              : tone === "down"
                ? "bg-down"
                : tone === "warn"
                  ? "bg-accent"
                  : "bg-accent"
          }`}
        />
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{eyebrow}</div>
          <div className="text-[13px] font-semibold text-ink-1">{title}</div>
        </div>
      </div>
      {count != null ? <Badge tone="neutral">{count}</Badge> : null}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line/50 bg-bg-2/30 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</div>
      {items.length ? (
        <ul className="space-y-1.5 text-[12px] text-ink-2">
          {items.map((x, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-ink-3">—</span>
              {x}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-ink-3">Chưa có dữ liệu.</p>
      )}
    </div>
  );
}

export default function StockProfilePage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading, isValidating, mutate } = useApi<StockCompanyPackage>(
    symbol ? `/api/v1/stocks/${symbol}/profile` : null,
    { refreshInterval: 600_000, timeoutMs: 15_000, keepPreviousData: true },
  );

  useEffect(() => {
    const onRefresh = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { symbol?: string } | undefined;
      if (d?.symbol && d.symbol !== symbol) return;
      void mutate();
    };
    window.addEventListener("orca:stock-refresh", onRefresh);
    return () => window.removeEventListener("orca:stock-refresh", onRefresh);
  }, [symbol, mutate]);

  const pie = useMemo(() => {
    const list = (data?.shareholders ?? [])
      .filter((s) => s.ownershipPct != null && s.ownershipPct > 0)
      .slice(0, 8);
    return list.map((s) => ({ name: s.name, pct: s.ownershipPct ?? 0 }));
  }, [data]);

  if (!symbol || (isLoading && !res && !data)) return <Loading rows={8} />;
  if (!res?.success || !data)
    return (
      <div className="stock-workspace space-y-3 p-1">
        <Unavailable
          title={`Không lấy được hồ sơ ${symbol}`}
          note={res && !res.success ? res.error.message : "Nguồn hồ sơ đang gián đoạn."}
        />
        <button
          type="button"
          onClick={() => void mutate()}
          className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[12px] font-medium text-text-primary hover:border-accent-primary/40"
        >
          <RefreshCw className={`size-3.5 ${isValidating ? "animate-spin" : ""}`} />
          Thử tải lại hồ sơ
        </button>
      </div>
    );

  const p = data.profile;
  const swot = data.swot;
  const totalInsights =
    (data.catalysts?.length ?? 0) +
    (data.risks?.length ?? 0) +
    (swot
      ? swot.strengths.length +
        swot.weaknesses.length +
        swot.opportunities.length +
        swot.threats.length
      : 0);
  const profileMeta = res.meta;

  return (
    <main className="stock-workspace">
      <section className="company-profile-card panel panel-elevated overflow-hidden">
        <div className="company-profile-hero">
          <div className="mb-2 flex justify-end px-1">
            <button
              type="button"
              onClick={() => void mutate()}
              disabled={isValidating}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[11px] font-medium text-text-muted hover:border-accent-primary/40 hover:text-accent-primary disabled:opacity-60"
            >
              <RefreshCw className={`size-3 ${isValidating ? "animate-spin" : ""}`} />
              Làm mới hồ sơ
            </button>
          </div>
          <div className="company-profile-top">
            <div className="company-profile-identity">
              {p?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logo} alt={p.vnName ?? symbol} className="size-12 rounded-lg border border-line object-contain bg-bg-1" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded-lg border border-line bg-bg-2 text-accent">
                  <Building2 className="size-6" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[18px] font-bold tracking-tight text-ink-1">{symbol}</h1>
                  {p?.floor ? <Badge tone="neutral">{p.floor}</Badge> : null}
                  {isValidating ? <span className="text-[10px] text-ink-3">Đang làm mới…</span> : null}
                </div>
                <p className="truncate text-[13px] text-ink-2">{p?.vnName ?? p?.enName ?? "Đang cập nhật tên công ty"}</p>
                {p?.enName && p.vnName ? <p className="truncate text-[11px] text-ink-3">{p.enName}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-ink-3">
              {p?.foundDate ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1">
                  <CalendarDays className="size-3" /> {p.foundDate}
                </span>
              ) : null}
              {p?.employees != null ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1">
                  <Users className="size-3" /> {fmtNum(p.employees, 0)} NV
                </span>
              ) : null}
              {p?.website ? (
                <a
                  href={p.website.startsWith("http") ? p.website : `https://${p.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1 hover:text-accent"
                >
                  <Globe2 className="size-3" /> Website <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          </div>
          {p?.vnSummary || p?.enSummary ? (
            <p className="company-profile-summary">{p.vnSummary ?? p.enSummary}</p>
          ) : (
            <p className="company-profile-summary company-profile-summary--muted">
              {data.notes?.length ? data.notes.join(" · ") : "Chưa có mô tả doanh nghiệp — thử làm mới."}
            </p>
          )}
          {profileMeta ? <MetaLine meta={profileMeta} className="mt-2" /> : null}
        </div>
      </section>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Panel className="space-y-3">
          <SectionHeading eyebrow="Ownership" title="Cổ đông lớn" count={data.shareholders?.length} />
          {data.shareholders?.length ? (
            <ul className="space-y-2">
              {data.shareholders.slice(0, 12).map((s, i) => (
                <li key={`${s.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-line/50 px-2.5 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate text-ink-1">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">
                    {s.ownershipPct != null ? `${s.ownershipPct.toFixed(2)}%` : s.shares != null ? fmtCompact(s.shares) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">Chưa có danh sách cổ đông.</p>
          )}
          {pie.length > 0 ? (
            <div className="text-[10px] text-ink-3">Top {pie.length} cổ đông theo % sở hữu</div>
          ) : null}
        </Panel>

        <Panel className="space-y-3">
          <SectionHeading eyebrow="Research" title="Catalyst & rủi ro" count={totalInsights} tone="warn" />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold text-up">Catalyst</div>
              <InsightList items={data.catalysts ?? []} empty="Chưa có catalyst." />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-down">Rủi ro</div>
              <InsightList items={data.risks ?? []} empty="Chưa có rủi ro ghi nhận." />
            </div>
          </div>
        </Panel>
      </div>

      {swot ? (
        <Panel className="mt-3 space-y-3">
          <SectionHeading eyebrow="SWOT" title="Điểm mạnh · yếu · cơ hội · đe dọa" />
          <div className="grid gap-2 sm:grid-cols-2">
            <ListBlock title="Strengths" items={swot.strengths} />
            <ListBlock title="Weaknesses" items={swot.weaknesses} />
            <ListBlock title="Opportunities" items={swot.opportunities} />
            <ListBlock title="Threats" items={swot.threats} />
          </div>
        </Panel>
      ) : null}

      {data.valueChain ? (
        <Panel className="mt-3 space-y-3">
          <SectionHeading eyebrow="Value chain" title="Chuỗi giá trị" tone="accent" />
          <div className="grid gap-2 md:grid-cols-3">
            <ListBlock title="Đầu vào" items={data.valueChain.input} />
            <ListBlock title="Quy trình" items={data.valueChain.process} />
            <ListBlock title="Đầu ra" items={data.valueChain.output} />
          </div>
          <div className="flex items-center gap-1 text-[11px] text-ink-3">
            <Waypoints className="size-3.5" /> <ArrowRight className="size-3" /> Chuỗi suy từ hồ sơ + BCTC
          </div>
        </Panel>
      ) : null}

      {data.notes?.length ? (
        <p className="mt-3 flex items-start gap-2 text-[11px] text-ink-3">
          <Gauge className="mt-0.5 size-3.5 shrink-0" />
          {data.notes.join(" · ")}
        </p>
      ) : null}
    </main>
  );
}
