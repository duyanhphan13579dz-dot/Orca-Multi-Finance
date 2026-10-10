"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { Badge, fmtNum, FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";
import { ArrowDownRight, ArrowUpRight, Crosshair, HelpCircle, ShieldAlert, Timer, TrendingDown, TrendingUp, Zap } from "lucide-react";
import type { DerivativeScalpResult } from "@/lib/services/derivatives-scalp";

const TF = ["1m", "5m", "15m"] as const;

const DIR_UI: Record<string, { label: string; tone: "up" | "down" | "neutral"; desc: string }> = {
  "watch-long": { label: "CANH LONG", tone: "up", desc: "Ưu tiên mở vị thế Long khi giá retest hỗ trợ" },
  "watch-short": { label: "CANH SHORT", tone: "down", desc: "Ưu tiên mở vị thế Short khi giá chạm kháng cự" },
  neutral: { label: "QUAN SÁT", tone: "neutral", desc: "Thị trường giằng co, đứng ngoài chờ breakout" },
};

export function DerivativeScalpPanel({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<(typeof TF)[number]>("5m");
  const { data, meta, isLoading } = useApi<DerivativeScalpResult>(
    `/api/v1/derivatives/${encodeURIComponent(symbol)}/scalp?tf=${tf}`,
    { refreshInterval: 15_000 },
  );

  return (
    <Panel
      className="h-full !flex !flex-col min-h-0 [&_.panel-body]:!flex-1 [&_.panel-body]:!min-h-0 [&_.panel-body]:!overflow-y-auto [&_.panel-body]:!py-3 [&_.panel-body]:!px-3.5"
      title={
        <span className="flex items-center gap-2">
          <Zap className="size-4 text-accent-primary" /> Scalping Intelligence · {symbol}
          {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
        </span>
      }
      right={
        <div className="seg">
          {TF.map((x) => (
            <button
              key={x}
              type="button"
              data-active={tf === x}
              onClick={() => setTf(x)}
              className="text-xs px-2.5 py-1"
            >
              {x}
            </button>
          ))}
        </div>
      }
    >
      {isLoading && !data ? (
        <Loading rows={6} />
      ) : !data ? (
        <Unavailable title="Chưa đủ dữ liệu scalping realtime" meta={meta} />
      ) : (
        <ScalpDetails result={data} />
      )}
    </Panel>
  );
}

function ScalpDetails({ result }: { result: DerivativeScalpResult }) {
  const s = result.signal;
  const dir = DIR_UI[s.direction] ?? DIR_UI.neutral;
  const setup = s.primarySetup;

  const basisColor =
    s.basis == null
      ? "text-text-muted"
      : s.basis > 4
        ? "text-amber-400"
        : s.basis < -4
          ? "text-sky-400"
          : "text-text-primary";

  return (
    <div className="space-y-3.5 text-xs">
      {/* 1. Header Tín hiệu chính */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-base p-2.5">
        <div className="flex items-center gap-2">
          <Badge tone={dir.tone}>
            <span className="text-[12px] font-bold tracking-wide">{dir.label}</span>
          </Badge>
          <div>
            <div className="text-[11px] text-text-muted">{dir.desc}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-text-muted">Độ tin cậy</div>
          <div className="num font-bold text-text-primary">
            {s.strength}/100 <span className="text-[10px] text-text-secondary">(Điểm {s.score >= 0 ? "+" : ""}{s.score})</span>
          </div>
        </div>
      </div>

      {/* 2. Khối Basis & Flow Phái sinh */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
          <div className="flex items-center justify-between text-text-muted text-[11px]">
            <span>Độ lệch Basis</span>
            <span className="uppercase text-[10px] font-medium">{s.basisStatus}</span>
          </div>
          <div className={`mt-1 text-base font-bold num ${basisColor}`}>
            {s.basis != null ? `${s.basis >= 0 ? "+" : ""}${s.basis.toFixed(1)}` : "—"}{" "}
            <span className="text-[11px] font-normal text-text-muted">điểm</span>
          </div>
          <div className="mt-1 text-[10px] text-text-secondary">
            So với VN30: {s.spotPrice ? s.spotPrice.toFixed(1) : "—"}
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-elevated/40 p-2.5">
          <div className="flex items-center justify-between text-text-muted text-[11px]">
            <span>Dòng tiền (Flow)</span>
            {s.flowConfidence != null && (
              <span className="text-[10px]">{Math.round(s.flowConfidence * 100)}%</span>
            )}
          </div>
          <div className="mt-1 text-sm font-semibold capitalize text-text-primary">
            {s.flowKind ? s.flowKind.replace(/_/g, " ") : "Cân bằng"}
          </div>
          <div className="mt-1 text-[10px] text-text-secondary">
            OI: {s.openInterest != null ? s.openInterest.toLocaleString("vi-VN") : "—"} HĐ
          </div>
        </div>
      </div>

      {/* 3. Setup vào lệnh chiến thuật (Primary Setup) */}
      {setup && (
        <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-accent-primary text-[11px]">
              <Crosshair className="size-3.5" />
              Chiến lược: {setup.strategy}
            </span>
            <Badge tone={setup.direction === "BUY" ? "up" : setup.direction === "SELL" ? "down" : "neutral"}>
              {setup.direction === "BUY" ? "MỞ LONG" : "MỞ SHORT"}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-accent-primary/20 pt-2 text-center">
            <div>
              <div className="text-[10px] text-text-muted">Vùng vào lệnh</div>
              <div className="num font-bold text-text-primary mt-0.5">
                {setup.entryZone ? `${setup.entryZone[0]} – ${setup.entryZone[1]}` : setup.entry ?? "—"}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-rose-400 font-medium">Cắt lỗ (SL)</div>
              <div className="num font-bold text-rose-400 mt-0.5">
                {setup.stopLoss ?? "—"}
              </div>
              <div className="text-[10px] text-text-muted">
                -{setup.stopPoints} điểm
              </div>
            </div>

            <div>
              <div className="text-[10px] text-emerald-400 font-medium">Chốt lời (TP)</div>
              <div className="num font-bold text-emerald-400 mt-0.5">
                {setup.takeProfit ?? "—"}
              </div>
              <div className="text-[10px] text-text-muted">
                +{setup.targetPoints} điểm (R:R {setup.riskReward})
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Thước đo kỹ thuật & Vi mô */}
      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5 space-y-2">
        <div className="text-[11px] font-medium text-text-secondary flex items-center justify-between">
          <span>Chỉ số kỹ thuật vi mô</span>
          <span className="text-[10px] text-text-muted">Khung {s.timeframe}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded bg-surface-elevated/60 py-1">
            <div className="text-[10px] text-text-muted">VWAP</div>
            <div className="num font-semibold text-text-primary">{s.vwap ?? "—"}</div>
          </div>
          <div className="rounded bg-surface-elevated/60 py-1">
            <div className="text-[10px] text-text-muted">EMA 9/21</div>
            <div className="num font-semibold text-text-primary">{s.ema9?.toFixed(1) ?? "—"}</div>
          </div>
          <div className="rounded bg-surface-elevated/60 py-1">
            <div className="text-[10px] text-text-muted">RSI(7)</div>
            <div className="num font-semibold text-text-primary">{s.rsi7?.toFixed(0) ?? "—"}</div>
          </div>
          <div className="rounded bg-surface-elevated/60 py-1">
            <div className="text-[10px] text-text-muted">ATR(14)</div>
            <div className="num font-semibold text-text-primary">{s.atr?.toFixed(1) ?? "—"} đ</div>
          </div>
        </div>

        {/* Hỗ trợ / Kháng cự */}
        <div className="pt-1 flex items-center justify-between text-[11px] border-t border-border-subtle/60">
          <span className="text-text-muted">Hỗ trợ phiên:</span>
          <span className="num font-medium text-emerald-400">
            {s.micro.support.slice(0, 2).map((x) => x.toFixed(1)).join(" · ") || "—"}
          </span>
          <span className="text-text-muted ml-2">Kháng cự phiên:</span>
          <span className="num font-medium text-rose-400">
            {s.micro.resistance.slice(0, 2).map((x) => x.toFixed(1)).join(" · ") || "—"}
          </span>
        </div>
      </div>

      {/* 5. Bằng chứng định lượng */}
      {s.evidence.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-text-secondary">Bằng chứng định lượng:</div>
          <ul className="space-y-1 rounded-md bg-surface-elevated/30 p-2 text-[11px] text-text-secondary">
            {s.evidence.map((ev, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-accent-primary mt-0.5">•</span>
                <span>{ev}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 6. Cảnh báo rủi ro & Ký quỹ VSDC */}
      {s.riskNotes.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-amber-400 flex items-center gap-1">
            <ShieldAlert className="size-3" /> Lưu ý quản trị rủi ro & Ký quỹ:
          </div>
          <ul className="space-y-1 rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] text-amber-300/90">
            {s.riskNotes.map((rn, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span>⚠</span>
                <span>{rn}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
