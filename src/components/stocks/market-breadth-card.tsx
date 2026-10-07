"use client";

import { useApi } from "@/lib/hooks";
import { FreshnessDot, Loading, fmtCompact } from "@/components/ui";
import { Activity, TrendingDown, TrendingUp, Minus } from "lucide-react";

type IntelLite = {
  condition?: {
    score?: number;
    rating?: string;
    confidence?: string;
    drivers?: string[];
    risks?: string[];
  };
  breadth?: {
    advancers?: number;
    decliners?: number;
    unchanged?: number;
    available?: boolean;
    advancePct?: number | null;
    adRatio?: number | null;
    regimeVi?: string | null;
  };
  flow?: {
    foreignNet?: number | null;
    propNet?: number | null;
    available?: boolean;
  };
  session?: { labelVi?: string; trading?: boolean };
};

function ratingVi(r?: string): string {
  switch (r) {
    case "BULLISH":
      return "Lạc quan";
    case "MODERATELY BULLISH":
      return "Nghiêng mua";
    case "NEUTRAL":
      return "Trung tính";
    case "MIXED":
      return "Trộn lẫn";
    case "MODERATELY BEARISH":
      return "Nghiêng bán";
    case "BEARISH":
      return "Bi quan";
    default:
      return r || "—";
  }
}

/** Compact market-breadth panel for stock detail (side of chart). */
export function MarketBreadthCard() {
  const { data, meta, isLoading } = useApi<IntelLite>("/api/v1/market/intel", {
    refreshInterval: 45_000,
  });

  if (isLoading && !data) {
    return (
      <div className="stock-breadth-card">
        <div className="stock-breadth-head">
          <span className="stock-breadth-title">Độ rộng thị trường</span>
        </div>
        <Loading rows={4} />
      </div>
    );
  }

  const breadth = data?.breadth;
  const flow = data?.flow;
  const score = data?.condition?.score;
  const rating = data?.condition?.rating;
  const conf = data?.condition?.confidence;
  const s = score != null && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
  const needle = s ?? 50;
  const tone = needle >= 62 ? "up" : needle <= 38 ? "down" : "neutral";
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-amber-300";

  const adv = breadth?.advancers;
  const dec = breadth?.decliners;
  const unch = breadth?.unchanged;
  const denom = (adv ?? 0) + (dec ?? 0) + (unch ?? 0);
  const buyPct = denom > 0 && adv != null ? (adv / denom) * 100 : null;
  const sellPct = denom > 0 && dec != null ? (dec / denom) * 100 : null;
  const flatPct =
    denom > 0 && unch != null
      ? (unch / denom) * 100
      : buyPct != null && sellPct != null
        ? Math.max(0, 100 - buyPct - sellPct)
        : null;

  return (
    <div className="stock-breadth-card">
      <div className="stock-breadth-head">
        <span className="stock-breadth-title">
          <Activity className="size-3.5 shrink-0 text-accent-primary" aria-hidden />
          Độ rộng thị trường
        </span>
        {meta ? <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} /> : null}
      </div>

      <div className="stock-breadth-score">
        <div className="stock-breadth-score-main">
          <span className={`stock-breadth-score-num num ${toneClass}`}>
            {s != null ? Math.round(s) : "—"}
          </span>
          <span className={`stock-breadth-score-label ${toneClass}`}>{ratingVi(rating)}</span>
        </div>
        <div className="stock-breadth-score-meta">
          {conf ? <span>Tin cậy {conf}</span> : null}
          {data?.session?.labelVi ? <span>{data.session.labelVi}</span> : null}
        </div>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500">
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-surface-base shadow"
          style={{ left: `${needle}%` }}
          title={`Score ${needle}`}
        />
      </div>

      <div className="stock-breadth-stats">
        <div className="stock-breadth-stat stock-breadth-stat--up">
          <TrendingUp className="stock-breadth-stat-icon" aria-hidden />
          <div className="stock-breadth-stat-body">
            <div className="stock-breadth-stat-label">Tăng</div>
            <div className="stock-breadth-stat-value num">{adv ?? "—"}</div>
          </div>
        </div>
        <div className="stock-breadth-stat stock-breadth-stat--flat">
          <Minus className="stock-breadth-stat-icon" aria-hidden />
          <div className="stock-breadth-stat-body">
            <div className="stock-breadth-stat-label">Đứng</div>
            <div className="stock-breadth-stat-value num">{unch ?? "—"}</div>
          </div>
        </div>
        <div className="stock-breadth-stat stock-breadth-stat--down">
          <TrendingDown className="stock-breadth-stat-icon" aria-hidden />
          <div className="stock-breadth-stat-body">
            <div className="stock-breadth-stat-label">Giảm</div>
            <div className="stock-breadth-stat-value num">{dec ?? "—"}</div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-base/80">
        <div className="bg-up/80 transition-all" style={{ width: `${buyPct ?? 33}%` }} />
        <div className="bg-amber-400/50 transition-all" style={{ width: `${flatPct ?? 34}%` }} />
        <div className="bg-down/80 transition-all" style={{ width: `${sellPct ?? 33}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-text-muted">
        <span className="text-up">{buyPct != null ? `${buyPct.toFixed(0)}%` : "—"}</span>
        <span>{flatPct != null ? `${flatPct.toFixed(0)}%` : "—"}</span>
        <span className="text-down">{sellPct != null ? `${sellPct.toFixed(0)}%` : "—"}</span>
      </div>

      {breadth?.regimeVi || breadth?.adRatio != null ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
          {breadth.regimeVi ? (
            <span>
              Chế độ: <strong className="text-text-primary">{breadth.regimeVi}</strong>
            </span>
          ) : null}
          {breadth.adRatio != null ? (
            <span className="num">A/D {breadth.adRatio.toFixed(2)}</span>
          ) : null}
        </div>
      ) : null}

      {flow?.available && (flow.foreignNet != null || flow.propNet != null) ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border-subtle pt-2 text-[10px] text-text-muted">
          {flow.foreignNet != null ? (
            <span>
              Ngoại net{" "}
              <span className={flow.foreignNet >= 0 ? "text-up" : "text-down"}>
                {flow.foreignNet >= 0 ? "+" : ""}
                {fmtCompact(flow.foreignNet)}
              </span>
            </span>
          ) : null}
          {flow.propNet != null ? (
            <span>
              Tự doanh{" "}
              <span className={flow.propNet >= 0 ? "text-up" : "text-down"}>
                {flow.propNet >= 0 ? "+" : ""}
                {fmtCompact(flow.propNet)}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {data?.condition?.drivers?.[0] ? (
        <p className="mt-2 line-clamp-2 text-[10px] leading-snug text-text-secondary">
          {data.condition.drivers[0]}
        </p>
      ) : null}
    </div>
  );
}
