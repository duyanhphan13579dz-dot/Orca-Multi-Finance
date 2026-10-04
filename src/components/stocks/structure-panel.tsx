"use client";

import { memo } from "react";
import { useApi } from "@/lib/hooks";
import type { StructureAnalysis } from "@/lib/engines/wyckoff-elliott";
import { Badge, FreshnessDot, Loading, Panel } from "@/components/ui";
import { Layers } from "lucide-react";

type AlphaBeta = {
  beta: number | null;
  betaAdj: number | null;
  betaUp: number | null;
  betaDown: number | null;
  alphaAnnual: number | null;
  alphaT: number | null;
  r2: number | null;
  n: number;
  profileVi: string;
  profile: string;
  quality?: { reliable: boolean; flags: string[] };
  summary: string;
  benchmark?: string;
};

type Data = StructureAnalysis & { symbol: string; alphaBeta?: AlphaBeta | null };

function biasTone(b: string): "up" | "down" | "neutral" {
  if (b === "bullish") return "up";
  if (b === "bearish") return "down";
  return "neutral";
}

const VOL_VI: Record<string, string> = {
  rising: "tăng",
  falling: "giảm",
  flat: "đi ngang",
};

export const StockStructurePanel = memo(function StockStructurePanel({ symbol }: { symbol: string }) {
  const { data, meta, isLoading } = useApi<Data>(
    symbol ? `/api/v1/stocks/${encodeURIComponent(symbol)}/structure` : null,
    { refreshInterval: 120_000 },
  );

  if (isLoading && !data) {
    return (
      <Panel title="Wyckoff · Elliott">
        <Loading rows={3} />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Wyckoff · Elliott">
        <p className="text-[12px] text-text-muted">Chưa đủ chuỗi giá để đọc cấu trúc.</p>
      </Panel>
    );
  }

  const { wyckoff: w, elliott: e } = data;
  const ab = data.alphaBeta;

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Layers className="size-4 text-accent-primary" /> Wyckoff · Elliott · αβ
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
    >
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-text-secondary">{data.summary}</p>

        {ab && ab.beta != null ? (
          <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Hệ số Alpha · Beta
              </span>
              <Badge
                tone={
                  ab.profile?.includes("high_beta_low") ||
                  ((ab.alphaAnnual ?? 0) > 0 && (ab.alphaT ?? 0) >= 2)
                    ? "up"
                    : ab.profile?.includes("neg")
                      ? "down"
                      : "neutral"
                }
              >
                {ab.profileVi}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-4">
              <div>
                <div className="text-[10px] text-text-muted">α / năm</div>
                <div className={`num font-medium ${(ab.alphaAnnual ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                  {ab.alphaAnnual != null ? `${(ab.alphaAnnual * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">t-stat α</div>
                <div className="num font-medium">{ab.alphaT?.toFixed(2) ?? "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">β / β adj</div>
                <div className="num font-medium">
                  {ab.beta?.toFixed(2) ?? "—"}
                  <span className="text-text-muted"> / {ab.betaAdj?.toFixed(2) ?? "—"}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">R² · n</div>
                <div className="num font-medium">
                  {ab.r2 != null ? `${(ab.r2 * 100).toFixed(0)}%` : "—"}
                  <span className="text-text-muted"> · {ab.n}</span>
                </div>
              </div>
              {(ab.betaUp != null || ab.betaDown != null) && (
                <div className="col-span-2 sm:col-span-4">
                  <div className="text-[10px] text-text-muted">Up / Down β</div>
                  <div className="num text-[12px]">
                    {ab.betaUp?.toFixed(2) ?? "—"} / {ab.betaDown?.toFixed(2) ?? "—"}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">{ab.summary}</p>
            {ab.quality?.flags?.length ? (
              <p className="mt-1 text-[10px] text-text-muted">⚠ {ab.quality.flags.join(" · ")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Wyckoff
              </span>
              <Badge tone={biasTone(w.bias)}>{w.confidence}%</Badge>
            </div>
            <div className="text-[13px] font-medium text-text-primary">{w.phaseVi}</div>
            <div className="mt-1 text-[11px] text-text-muted">
              Khối lượng: {VOL_VI[w.volumeTrend] ?? w.volumeTrend}
              {w.range && (
                <span className="num">
                  {" "}
                  · biên {w.range.low.toLocaleString("vi-VN")} – {w.range.high.toLocaleString("vi-VN")}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border-subtle bg-background-secondary/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Elliott
              </span>
              <Badge tone={biasTone(e.bias)}>{e.confidence}%</Badge>
            </div>
            <div className="text-[13px] font-medium text-text-primary">{e.phaseVi ?? e.labelVi ?? e.waveLabel}</div>
            <div className="mt-1 text-[11px] text-text-muted">{e.summary ?? e.note ?? ""}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
});
