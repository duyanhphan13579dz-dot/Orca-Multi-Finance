"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { NewsArticle } from "@/lib/types";
import { fmtCompact } from "@/components/ui";

function pct(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}

/** Deterministic spark heights from liquidity numbers (no extra API). */
function sparkHeights(value: number | null, baseline: number | null): number[] {
  const seed = Math.abs(Math.round((value ?? 1e13) / 1e9)) || 42;
  const ratio =
    value != null && baseline != null && baseline > 0 ? Math.min(1.4, Math.max(0.55, value / baseline)) : 1;
  const out: number[] = [];
  let s = seed % 997;
  for (let i = 0; i < 12; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const wave = 0.35 + 0.55 * ((i + 1) / 12) * ratio;
    const noise = (s % 40) / 100;
    out.push(Math.min(98, Math.max(12, (wave + noise) * 70)));
  }
  return out;
}

export function LiquiditySparkPanel({ intel }: { intel: MarketIntel }) {
  const l = intel.liquidity;
  const vsBaseline =
    l.valueTraded != null && l.baseline != null && l.baseline > 0
      ? (l.valueTraded / l.baseline - 1) * 100
      : null;
  const heights = useMemo(
    () => sparkHeights(l.valueTraded, l.baseline),
    [l.valueTraded, l.baseline],
  );

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>LIQUIDITY</h2>
        {l.available ? (
          <span className="cc-tag text-up border-up/40 bg-up/10">LIVE</span>
        ) : (
          <span className="text-[10px] text-text-muted">—</span>
        )}
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
      <div className="cc-spark" aria-hidden>
        {heights.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="flex justify-between px-3 pb-1 text-[9px] text-text-muted">
        <span>Mở cửa</span>
        <span>Giữa phiên</span>
        <span>Hiện tại</span>
      </div>
      <p className="px-3 pb-2 text-[10px] text-text-muted line-clamp-2">
        {l.note ||
          (l.available
            ? "GTGD phiên · spark minh họa xu hướng tương đối (không phải OHLC phút)"
            : "Chưa có dữ liệu thanh khoản")}
      </p>
    </article>
  );
}

const CAT_VI: Record<string, string> = {
  market: "TT",
  corporate: "DN",
  macro: "VĨ MÔ",
  crypto: "CRYPTO",
  forex: "FX",
  commodities: "HH",
  general: "TIN",
};

function timeLabel(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    });
  } catch {
    return "—";
  }
}

export function NewsFlowPanel({ articles }: { articles: NewsArticle[] }) {
  const list = articles.slice(0, 8);
  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>NEWS FLOW</h2>
        <span className="text-[10px] text-text-muted">MỚI NHẤT</span>
      </div>
      {!list.length ? (
        <p className="px-3 py-4 text-[11px] text-text-muted">Chưa có tin trong payload intel.</p>
      ) : (
        <div className="divide-y divide-border-subtle/40">
          {list.map((a) => (
            <a
              key={a.id}
              href={a.url || "/news"}
              target={a.url ? "_blank" : undefined}
              rel={a.url ? "noopener noreferrer" : undefined}
              className="grid grid-cols-[2.6rem_3.4rem_1fr_auto] items-center gap-2 px-3 py-2 text-[11px] hover:bg-surface-elevated/40"
            >
              <time className="num text-text-muted">{timeLabel(a.publishedAt)}</time>
              <span className="truncate text-text-muted" title={a.source}>
                {a.source}
              </span>
              <b className="line-clamp-2 font-medium leading-snug text-text-primary">{a.title}</b>
              <em className="not-italic rounded border border-border-subtle px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
                {CAT_VI[a.category] ?? a.category}
              </em>
            </a>
          ))}
        </div>
      )}
      <div className="border-t border-border-subtle/60 px-3 py-1.5 text-right">
        <a href="/news" className="text-[11px] text-accent-primary hover:underline">
          Tất cả tin →
        </a>
      </div>
    </article>
  );
}

export type CcTab = "all" | "vn" | "global" | "flow" | "news";

const TABS: { id: CcTab; label: string }[] = [
  { id: "all", label: "TỔNG QUAN" },
  { id: "vn", label: "VIỆT NAM" },
  { id: "global", label: "QUỐC TẾ" },
  { id: "flow", label: "DÒNG VỐN" },
  { id: "news", label: "NEWS" },
];

export function CommandTabs({
  active,
  onChange,
}: {
  active: CcTab;
  onChange: (t: CcTab) => void;
}) {
  return (
    <nav className="cc-tabs" role="tablist" aria-label="Command center sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={active === t.id ? "active" : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/** Show section if tab is all or matches group */
export function showSection(tab: CcTab, group: "vn" | "global" | "flow" | "news" | "core"): boolean {
  if (tab === "all") return true;
  if (group === "core") return tab === "vn" || tab === "all";
  return tab === group;
}

export function Section({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  if (!show) return null;
  return <>{children}</>;
}

/** Tab state wrapper used by CommandCenter */
export function useCommandTab() {
  return useState<CcTab>("all");
}
