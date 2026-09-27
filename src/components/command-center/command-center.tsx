"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { Meta, IndexQuote, Quote } from "@/lib/types";
import { sectorOf, VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, MetaLine } from "@/components/ui";

const RATING_VI: Record<string, string> = {
  BULLISH: "Tích cực",
  "MODERATELY BULLISH": "Hơi tích cực",
  NEUTRAL: "Trung lập",
  MIXED: "Trộn lẫn",
  "MODERATELY BEARISH": "Hơi tiêu cực",
  BEARISH: "Tiêu cực",
};

const RATING_TAG: Record<string, string> = {
  BULLISH: "text-up border-up/40 bg-up/10",
  "MODERATELY BULLISH": "text-up border-up/30 bg-up/5",
  NEUTRAL: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  MIXED: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  "MODERATELY BEARISH": "text-down border-down/30 bg-down/5",
  BEARISH: "text-down border-down/40 bg-down/10",
};

const PRIORITY_SECTORS = [
  "Ngân hàng",
  "Bất động sản",
  "Chứng khoán",
  "Thép",
  "Dầu khí",
  "Bán lẻ",
  "Bảo hiểm",
  "Công nghệ",
  "Thực phẩm & Đồ uống",
  "Điện lực",
];

function pct(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}

function tonePct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-text-muted";
  if (p > 0.05) return "text-up";
  if (p < -0.05) return "text-down";
  return "text-text-secondary";
}

function TickerStrip({
  indices,
  crossAsset,
}: {
  indices: IndexQuote[] | null;
  crossAsset: MarketIntel["crossAsset"];
}) {
  const items: { label: string; value: string; chg: number | null; sub?: string; href?: string }[] = [];

  for (const i of (indices ?? []).slice(0, 4)) {
    items.push({
      label: i.code,
      value: fmtNum(i.value, 2),
      chg: i.changePercent ?? null,
      sub: i.volume != null ? fmtCompact(i.volume) : undefined,
      href: `/market/index/${encodeURIComponent(i.code)}`,
    });
  }

  for (const c of crossAsset.slice(0, 6)) {
    items.push({
      label: c.key,
      value: c.value != null ? fmtNum(c.value, c.key === "USDVND" ? 0 : 2) : "—",
      chg: c.changePercent ?? null,
      sub: c.unit,
    });
  }

  if (!items.length) return null;

  return (
    <div className="cc-ticker">
      {items.map((t) => {
        const inner = (
          <>
            <span className="cc-ticker-label">{t.label}</span>
            <span className="cc-ticker-row">
              <strong className="num">{t.value}</strong>
              <em className={tonePct(t.chg)}>{pct(t.chg)}</em>
            </span>
            {t.sub ? <span className="cc-ticker-sub">{t.sub}</span> : null}
          </>
        );
        return t.href ? (
          <Link key={t.label} href={t.href} className="cc-ticker-item hover:border-border-default">
            {inner}
          </Link>
        ) : (
          <div key={t.label} className="cc-ticker-item">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function MarketPulse({ intel }: { intel: MarketIntel }) {
  const c = intel.condition;
  const score = Math.round(c.score);
  const needle = Math.max(0, Math.min(100, score));
  const tagCls = RATING_TAG[c.rating] ?? RATING_TAG.NEUTRAL;
  const headline =
    c.drivers[0] ??
    (score >= 57
      ? "Thị trường nghiêng tích cực"
      : score <= 43
        ? "Thị trường nghiêng tiêu cực"
        : "Thị trường trung tính / phân hóa");

  const metrics = c.components.filter((x) => x.available && x.score != null).slice(0, 6);

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>MARKET PULSE</h2>
        <span className={`cc-tag ${tagCls}`}>{RATING_VI[c.rating] ?? c.rating}</span>
      </div>
      <div className="cc-pulse-main">
        <div className="cc-score">
          {score}
          <span>/100</span>
        </div>
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] text-text-primary">{headline}</b>
          <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">
            {c.risks[0] ? `Rủi ro: ${c.risks[0]}` : intel.sessionHint}
          </p>
          <p className="mt-0.5 text-[10px] text-text-muted">
            Tin cậy {c.confidence} · phủ dữ liệu {Math.round(c.coverage * 100)}%
          </p>
        </div>
      </div>
      <div className="cc-scale">
        <i style={{ left: `${needle}%` }} />
      </div>
      <div className="cc-scale-labels">
        <span>BEAR</span>
        <span>NEUTRAL</span>
        <span>BULL</span>
      </div>
      {metrics.length > 0 ? (
        <div className="cc-metric-grid">
          {metrics.map((m) => {
            const s = Math.round(m.score as number);
            const risk = m.key === "globalRisk";
            return (
              <div key={m.key}>
                <div className="flex justify-between gap-1">
                  <label>{m.label.replace(/ \(.*\)/, "")}</label>
                  <b className="num">{s}</b>
                </div>
                <div className="cc-bar">
                  <i className={risk ? "risk" : undefined} style={{ width: `${s}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function BreadthPanel({ intel }: { intel: MarketIntel }) {
  const b = intel.breadth;
  const tot = (b.advancers || 0) + (b.decliners || 0) + (b.unchanged || 0) || 1;
  const upW = (b.advancers / tot) * 100;
  const dnW = (b.decliners / tot) * 100;
  const flW = Math.max(0, 100 - upW - dnW);
  const ad = b.adRatio ?? (b.decliners > 0 ? b.advancers / b.decliners : null);
  const net = b.netAdvances ?? b.advancers - b.decliners;

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>MARKET BREADTH</h2>
        <span className="text-[10px] text-text-muted">HOSE · HNX · UPCOM</span>
      </div>
      {!b.available ? (
        <p className="px-3 py-4 text-[11px] text-text-muted">{b.note || "Chưa có độ rộng."}</p>
      ) : (
        <>
          <div className="cc-breadth-nums">
            <div>
              <b className="text-up">{b.advancers}</b>
              <span>TĂNG</span>
            </div>
            <div>
              <b className="text-down">{b.decliners}</b>
              <span>GIẢM</span>
            </div>
            <div>
              <b className="text-text-secondary">{b.unchanged}</b>
              <span>ĐỨNG</span>
            </div>
          </div>
          <div className="cc-split-bar">
            <i className="bg-up" style={{ width: `${upW}%` }} />
            <i className="bg-down" style={{ width: `${dnW}%` }} />
            <i className="bg-slate-500" style={{ width: `${flW}%` }} />
          </div>
          <div className="cc-mini-table">
            <div>
              <span>A/D Ratio</span>
              <b className="num">{ad != null ? ad.toFixed(2) : "—"}</b>
            </div>
            <div>
              <span>Net Advances</span>
              <b className={`num ${net >= 0 ? "text-up" : "text-down"}`}>
                {net >= 0 ? "+" : ""}
                {net}
              </b>
            </div>
            {b.regimeVi ? (
              <div className="col-span-2">
                <span>Chế độ</span>
                <b>{b.regimeVi}</b>
              </div>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}

function MoneyFlowPanel({ intel }: { intel: MarketIntel }) {
  const f = intel.flow;
  const net = f.foreignNet;
  const liq = intel.liquidity;

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>MONEY FLOW</h2>
        <span className="text-[10px] text-text-muted">TỶ VND</span>
      </div>
      <div className="flex items-end justify-between px-3 pt-3">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Khối ngoại</span>
        <b className={`num text-[16px] ${net != null && net >= 0 ? "text-up" : net != null ? "text-down" : ""}`}>
          {net != null ? `${net >= 0 ? "+" : ""}${fmtCompact(net)}` : "—"}
        </b>
      </div>
      <div className="mt-2 space-y-1.5 border-t border-border-subtle/60 px-3 py-2">
        <div className="flex justify-between text-[11px] text-text-muted">
          <span>Tự doanh</span>
          <b className={`num ${f.propNet != null && f.propNet >= 0 ? "text-up" : f.propNet != null ? "text-down" : "text-text-secondary"}`}>
            {f.propNet != null ? `${f.propNet >= 0 ? "+" : ""}${fmtCompact(f.propNet)}` : "—"}
          </b>
        </div>
        <div className="flex justify-between text-[11px] text-text-muted">
          <span>ETF</span>
          <b className={`num ${f.etfNet != null && f.etfNet >= 0 ? "text-up" : f.etfNet != null ? "text-down" : "text-text-secondary"}`}>
            {f.etfNet != null ? `${f.etfNet >= 0 ? "+" : ""}${fmtCompact(f.etfNet)}` : "—"}
          </b>
        </div>
        {liq.available && liq.valueTraded != null ? (
          <div className="flex justify-between text-[11px] text-text-muted">
            <span>GTGD phiên</span>
            <b className="num text-text-secondary">{fmtCompact(liq.valueTraded)}</b>
          </div>
        ) : null}
      </div>
      {f.note ? <p className="px-3 pb-2 text-[10px] text-text-muted line-clamp-2">{f.note}</p> : null}
    </article>
  );
}

function LiquidityPanel({ intel }: { intel: MarketIntel }) {
  const l = intel.liquidity;
  const vsBaseline =
    l.valueTraded != null && l.baseline != null && l.baseline > 0
      ? (l.valueTraded / l.baseline - 1) * 100
      : null;

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>LIQUIDITY</h2>
        {l.available ? <span className="cc-tag text-up border-up/40 bg-up/10">LIVE</span> : null}
      </div>
      <div className="flex items-end justify-between gap-2 px-3 pt-3">
        <b className="num text-[22px] font-semibold text-text-primary">
          {l.valueTraded != null ? fmtCompact(l.valueTraded) : "—"}
        </b>
        {vsBaseline != null ? (
          <span className={`text-[11px] ${vsBaseline >= 0 ? "text-up" : "text-down"}`}>
            {pct(vsBaseline, 1)} vs Avg
          </span>
        ) : null}
      </div>
      <p className="px-3 pb-3 pt-1 text-[10px] text-text-muted line-clamp-2">
        {l.note || (l.available ? "Giá trị giao dịch phiên hiện tại" : "Chưa có dữ liệu thanh khoản")}
      </p>
    </article>
  );
}

type SectorRow = {
  name: string;
  avgPct: number;
  up: number;
  down: number;
  flat: number;
};

function buildSectors(quotes: Quote[]): SectorRow[] {
  const order = [
    ...PRIORITY_SECTORS,
    ...VN_SECTOR_MAP.map((s) => s.name).filter((n) => !PRIORITY_SECTORS.includes(n)),
  ];
  const rows: SectorRow[] = [];
  for (const name of order) {
    if (rows.length >= 8) break;
    const list = quotes.filter((q) => sectorOf(q.symbol) === name);
    if (list.length < 3) continue;
    let sum = 0;
    let n = 0;
    let up = 0;
    let down = 0;
    let flat = 0;
    for (const q of list) {
      const p = q.changePercent;
      if (p == null || !Number.isFinite(p)) continue;
      sum += p;
      n++;
      if (p > 0.05) up++;
      else if (p < -0.05) down++;
      else flat++;
    }
    if (!n) continue;
    rows.push({ name, avgPct: sum / n, up, down, flat });
  }
  return rows.sort((a, b) => b.avgPct - a.avgPct);
}

function SectorRotation({ quotes }: { quotes: Quote[] }) {
  const rows = useMemo(() => buildSectors(quotes), [quotes]);
  if (!rows.length) {
    return (
      <article className="cc-panel">
        <div className="cc-panel-head">
          <h2>SECTOR ROTATION</h2>
        </div>
        <p className="px-3 py-4 text-[11px] text-text-muted">Chưa đủ dữ liệu ngành.</p>
      </article>
    );
  }
  const maxAbs = Math.max(0.3, ...rows.map((r) => Math.abs(r.avgPct)));

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>SECTOR ROTATION</h2>
        <span className="text-[10px] text-text-muted">1D · theo mã bảng giá</span>
      </div>
      <div className="divide-y divide-border-subtle/50">
        {rows.map((r) => {
          const w = Math.min(100, (Math.abs(r.avgPct) / maxAbs) * 100);
          const up = r.avgPct >= 0;
          return (
            <div key={r.name} className="grid grid-cols-[7rem_1fr_3rem_4.5rem] items-center gap-2 px-3 py-1.5">
              <span className="truncate text-[12px] font-medium text-text-primary" title={r.name}>
                {r.name}
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-base">
                <div className={`h-full rounded-full ${up ? "bg-up/80" : "bg-down/80"}`} style={{ width: `${w}%` }} />
              </div>
              <span className={`num text-right text-[11px] font-semibold ${tonePct(r.avgPct)}`}>
                {pct(r.avgPct)}
              </span>
              <span className="text-right text-[10px] text-text-muted">
                {r.up}↑ {r.down}↓ {r.flat}=
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border-subtle/60 px-3 py-1.5 text-right">
        <Link href="/stocks" className="text-[11px] text-accent-primary hover:underline">
          Mở bảng điện →
        </Link>
      </div>
    </article>
  );
}

function TopMovers({ quotes }: { quotes: Quote[] }) {
  const { gainers, losers } = useMemo(() => {
    const valid = quotes.filter((q) => q.changePercent != null && Number.isFinite(q.changePercent));
    const gainers = [...valid].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 5);
    const losers = [...valid].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 5);
    return { gainers, losers };
  }, [quotes]);

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>TOP MOVERS</h2>
        <span className="text-[10px] text-text-muted">Theo %</span>
      </div>
      <div className="grid grid-cols-2 gap-0 border-b border-border-subtle/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        <span>Gainers</span>
        <span className="text-right sm:text-left">Losers</span>
      </div>
      <div className="divide-y divide-border-subtle/40">
        {Array.from({ length: 5 }).map((_, i) => {
          const g = gainers[i];
          const l = losers[i];
          return (
            <div key={i} className="grid grid-cols-2 gap-2 px-3 py-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-1">
                {g ? (
                  <>
                    <Link href={`/stocks/${g.symbol}`} className="font-bold text-accent-primary hover:underline">
                      {g.symbol}
                    </Link>
                    <span className="num text-up">{pct(g.changePercent)}</span>
                  </>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1">
                {l ? (
                  <>
                    <Link href={`/stocks/${l.symbol}`} className="font-bold text-accent-primary hover:underline">
                      {l.symbol}
                    </Link>
                    <span className="num text-down">{pct(l.changePercent)}</span>
                  </>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function AiBrief({ intel }: { intel: MarketIntel }) {
  const c = intel.condition;
  const summary =
    c.drivers[0] && c.risks[0]
      ? `${c.drivers[0]} Đồng thời cần lưu ý: ${c.risks[0]}`
      : c.drivers[0] || c.risks[0] || intel.sessionHint || "Đang tổng hợp brief thị trường…";

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>ORCA AI MARKET BRIEF</h2>
        <span className="cc-tag border-violet-500/40 bg-violet-500/10 text-violet-300">AI</span>
      </div>
      <p className="px-3 pt-2 text-[12px] leading-relaxed text-text-secondary">
        <strong className="text-text-primary">{RATING_VI[c.rating] ?? c.rating}</strong>
        {" · "}
        {summary}
      </p>
      <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Động lực</label>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-text-secondary">
            {(c.drivers.length ? c.drivers : ["Chưa đủ tín hiệu"]).slice(0, 4).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Rủi ro</label>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-text-secondary">
            {(c.risks.length ? c.risks : ["Chưa nhận diện rủi ro nổi bật"]).slice(0, 4).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border-subtle/60 px-3 py-2">
        <Link href="/agent" className="text-[11px] text-accent-primary hover:underline">
          Hỏi Orca Agent chi tiết →
        </Link>
      </div>
    </article>
  );
}

export function CommandCenter({
  intel,
  meta,
  quotes,
}: {
  intel: MarketIntel;
  meta: Meta | null;
  quotes: Quote[];
}) {
  return (
    <div className="cc-root space-y-2.5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-text-primary sm:text-lg">
              MARKET COMMAND CENTER
            </h1>
            <Badge tone={intel.session.trading ? "up" : "neutral"}>{intel.session.labelVi}</Badge>
            {meta ? <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} /> : null}
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Global → Vietnam · {intel.sessionHint}
          </p>
        </div>
        {meta ? <MetaLine meta={meta} /> : null}
      </header>

      <TickerStrip indices={intel.indices} crossAsset={intel.crossAsset} />

      <MarketPulse intel={intel} />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <BreadthPanel intel={intel} />
        <MoneyFlowPanel intel={intel} />
        <LiquidityPanel intel={intel} />
      </div>

      <div className="grid gap-2.5 lg:grid-cols-[1.15fr_0.85fr]">
        <SectorRotation quotes={quotes} />
        <TopMovers quotes={quotes} />
      </div>

      <AiBrief intel={intel} />

      <p className="text-center text-[10px] text-text-muted">
        Pha 1 · Pulse · Breadth · Flow · Sector · Movers · Brief — pha 2: Global regime & transmission
      </p>
    </div>
  );
}
