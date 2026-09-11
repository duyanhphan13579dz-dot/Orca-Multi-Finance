"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Chg, Loading, Panel, Unavailable } from "@/components/ui";
import { AiFinancialPanel } from "@/components/stocks/ai-financial-panel";
import {
  buildSnapshotMetrics,
  formatMetric,
  type Band,
  type MetricCell,
} from "@/lib/financial/fundamental-metrics";

type TabKey = "operating" | "investment" | "health" | "cashflow" | "valuation";

const TABS: { key: TabKey; label: string }[] = [
  { key: "operating", label: "1. Hiệu suất KD" },
  { key: "investment", label: "2. Hiệu suất ĐT" },
  { key: "health", label: "3. Sức khỏe TC" },
  { key: "cashflow", label: "4. Dòng tiền" },
  { key: "valuation", label: "5. Định giá" },
];

function bandClass(b?: Band): string {
  if (b === "safe") return "border-up/40 bg-up/10 text-up";
  if (b === "ok") return "border-warn/40 bg-warn/10 text-warn";
  if (b === "risk") return "border-down/40 bg-down/10 text-down";
  return "border-line/40 text-ink-3";
}

function MetricGrid({ items }: { items: MetricCell[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((m) => (
        <div key={m.key} className={`rounded-lg border px-3 py-2 ${bandClass(m.band)}`}>
          <div className="text-[10px] uppercase tracking-wide opacity-80">{m.labelVi}</div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="num text-[15px] font-semibold text-ink-2">{formatMetric(m)}</span>
            {m.delta != null && <Chg value={m.delta} className="text-[11px]" />}
          </div>
          {m.bandLabel && m.band && m.band !== "na" && (
            <div className="mt-0.5 text-[10px] font-medium">{m.bandLabel}</div>
          )}
          {m.note && <div className="mt-0.5 text-[10px] text-ink-3">{m.note}</div>}
        </div>
      ))}
    </div>
  );
}

/* ─── SVG charts ─── */

function BarDual({
  series,
  aKey,
  bKey,
  aLabel,
  bLabel,
  aColor = "#38bdf8",
  bColor = "#34d399",
}: {
  series: { period: string; [k: string]: string | number | null }[];
  aKey: string;
  bKey: string;
  aLabel: string;
  bLabel: string;
  aColor?: string;
  bColor?: string;
}) {
  if (!series.length) {
    return <p className="py-6 text-center text-[11px] text-ink-3">Không đủ dữ liệu biểu đồ.</p>;
  }
  const vals = series.flatMap((s) => [s[aKey], s[bKey]]).filter((v): v is number => typeof v === "number");
  const maxAbs = Math.max(...vals.map((v) => Math.abs(v)), 1);
  const h = 160;
  const pad = { t: 12, b: 28, l: 8, r: 8 };
  const chartH = h - pad.t - pad.b;
  const w = Math.max(300, series.length * 52);
  const gw = (w - pad.l - pad.r) / series.length;
  const barW = Math.min(16, gw * 0.35);

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="min-w-full">
        <line
          x1={pad.l}
          y1={pad.t + chartH / 2}
          x2={w - pad.r}
          y2={pad.t + chartH / 2}
          stroke="rgba(148,163,184,0.25)"
        />
        {series.map((s, i) => {
          const cx = pad.l + i * gw + gw / 2;
          const va = typeof s[aKey] === "number" ? (s[aKey] as number) : null;
          const vb = typeof s[bKey] === "number" ? (s[bKey] as number) : null;
          const bar = (v: number | null, color: string, offset: number) => {
            if (v == null) return null;
            const bh = (Math.abs(v) / maxAbs) * (chartH / 2 - 4);
            const y = v >= 0 ? pad.t + chartH / 2 - bh : pad.t + chartH / 2;
            return (
              <rect x={cx + offset} y={y} width={barW} height={Math.max(bh, 1)} fill={color} rx={2}>
                <title>{v}</title>
              </rect>
            );
          };
          return (
            <g key={s.period}>
              {bar(va, aColor, -barW - 1)}
              {bar(vb, bColor, 1)}
              <text x={cx} y={h - 8} textAnchor="middle" className="fill-ink-3" fontSize="9">
                {String(s.period).replace(/^20/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-[10px] text-ink-3">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: aColor }} />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: bColor }} />
          {bLabel}
        </span>
      </div>
    </div>
  );
}

function LineMulti({
  series,
  keys,
  colors,
}: {
  series: { period: string; [k: string]: string | number | null }[];
  keys: { key: string; label: string }[];
  colors: string[];
}) {
  if (!series.length) {
    return <p className="py-6 text-center text-[11px] text-ink-3">Không đủ dữ liệu biểu đồ.</p>;
  }
  const all = series.flatMap((s) => keys.map((k) => s[k.key])).filter((v): v is number => typeof v === "number");
  if (!all.length) {
    return <p className="py-6 text-center text-[11px] text-ink-3">Không đủ dữ liệu biểu đồ.</p>;
  }
  const minV = Math.min(...all, 0);
  const maxV = Math.max(...all, 0);
  const span = maxV - minV || 1;
  const h = 150;
  const pad = { t: 12, b: 28, l: 8, r: 8 };
  const chartH = h - pad.t - pad.b;
  const w = Math.max(300, series.length * 56);
  const chartW = w - pad.l - pad.r;
  const xAt = (i: number) => pad.l + (series.length === 1 ? chartW / 2 : (i / (series.length - 1)) * chartW);
  const yAt = (v: number) => pad.t + chartH - ((v - minV) / span) * chartH;

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="min-w-full">
        <line
          x1={pad.l}
          y1={yAt(0)}
          x2={w - pad.r}
          y2={yAt(0)}
          stroke="rgba(148,163,184,0.25)"
          strokeDasharray="4 3"
        />
        {keys.map((k, j) => {
          const pts: string[] = [];
          series.forEach((s, i) => {
            const v = s[k.key];
            if (typeof v !== "number") return;
            pts.push(`${xAt(i)},${yAt(v)}`);
          });
          if (pts.length < 2) return null;
          return (
            <polyline
              key={k.key}
              points={pts.join(" ")}
              fill="none"
              stroke={colors[j % colors.length]}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          );
        })}
        {series.map((s, i) => (
          <text key={s.period} x={xAt(i)} y={h - 8} textAnchor="middle" className="fill-ink-3" fontSize="9">
            {String(s.period).replace(/^20/, "")}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-ink-3">
        {keys.map((k, j) => (
          <span key={k.key} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: colors[j % colors.length] }} />
            {k.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RadarFour({
  values,
  labels,
}: {
  values: (number | null)[];
  labels: string[];
}) {
  // normalize each pillar 0-1 using domain heuristics
  const norms = values.map((v, i) => {
    if (v == null) return 0;
    if (i === 0) return Math.max(0, Math.min(1, 1 - v / 3)); // lower debt better
    if (i === 1) return Math.max(0, Math.min(1, v / 0.2)); // ebitda/assets
    if (i === 2) return Math.max(0, Math.min(1, v / 6)); // interest cover
    return Math.max(0, Math.min(1, v)); // fcf/ebit already ratio
  });
  const cx = 100;
  const cy = 100;
  const R = 70;
  const n = 4;
  const pt = (i: number, ratio: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + R * ratio * Math.cos(ang), cy + R * ratio * Math.sin(ang)] as const;
  };
  const poly = norms.map((r, i) => pt(i, r).join(",")).join(" ");

  return (
    <svg width="220" height="220" viewBox="0 0 200 200" className="mx-auto">
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <polygon
          key={ratio}
          points={Array.from({ length: n }, (_, i) => pt(i, ratio).join(",")).join(" ")}
          fill="none"
          stroke="rgba(148,163,184,0.2)"
        />
      ))}
      {labels.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(148,163,184,0.25)" />;
      })}
      <polygon points={poly} fill="rgba(56,189,248,0.25)" stroke="rgb(56,189,248)" strokeWidth="2" />
      {labels.map((lb, i) => {
        const [x, y] = pt(i, 1.2);
        return (
          <text key={lb} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-ink-3" fontSize="9">
            {lb}
          </text>
        );
      })}
    </svg>
  );
}

function GaugeZ({ z }: { z: number | null }) {
  const score = z == null ? 0 : Math.max(0, Math.min(5, z));
  const pct = score / 5;
  const r = 48;
  const c = Math.PI * r;
  const dash = pct * c;
  const color = z == null ? "#64748b" : z > 2.99 ? "#22c55e" : z > 1.81 ? "#eab308" : "#ef4444";
  const label = z == null ? "N/A" : z > 2.99 ? "An toàn" : z > 1.81 ? "Cảnh báo" : "Nguy hiểm";
  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="90" viewBox="0 0 140 90">
        <path
          d="M 22 78 A 48 48 0 0 1 118 78"
          fill="none"
          stroke="rgba(148,163,184,0.2)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 22 78 A 48 48 0 0 1 118 78"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
        <text x="70" y="70" textAnchor="middle" className="fill-ink-2" fontSize="18" fontWeight="600">
          {z != null ? z.toFixed(2) : "—"}
        </text>
      </svg>
      <div className="text-[11px] text-ink-3">Altman Z · {label}</div>
    </div>
  );
}

function StackedCf({
  series,
}: {
  series: { period: string; ocf: number | null; icf: number | null; fcfFin: number | null }[];
}) {
  return (
    <BarDual
      series={series.map((s) => ({
        period: s.period,
        ocf: s.ocf,
        icf: s.icf,
      }))}
      aKey="ocf"
      bKey="icf"
      aLabel="CFO (HĐKD)"
      bLabel="CFI (Đầu tư)"
      aColor="#34d399"
      bColor="#fbbf24"
    />
  );
}

/* ─── page ─── */

export default function StockFundamentalsPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  const [tab, setTab] = useState<TabKey>("operating");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 300_000,
  });

  const metrics = useMemo(() => {
    if (!data) return null;
    const closes = (data.bars ?? [])
      .map((b) => b.close)
      .filter((c): c is number => typeof c === "number");
    return buildSnapshotMetrics({
      income: (data.financials.income ?? []) as Record<string, unknown>[],
      balance: (data.financials.balance ?? []) as Record<string, unknown>[],
      cashflow: (data.financials.cashflow ?? []) as Record<string, unknown>[],
      price: data.quote?.price ?? null,
      closes,
      shares: data.financialHealth?.anchors?.shares ?? null,
      growthYoy: (data.financialGrowth?.yoy ?? []).map((g) => ({
        metric: g.metric,
        changePct: g.changePct,
      })),
      growthQoq: (data.financialGrowth?.qoq ?? []).map((g) => ({
        metric: g.metric,
        changePct: g.changePct,
      })),
    });
  }, [data]);

  if (!symbol || (isLoading && !res)) return <Loading rows={12} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được phân tích cơ bản ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn BCTC đang gián đoạn."}
      />
    );
  }

  if (!metrics) return <Loading rows={8} />;

  const fm = data.financialMeta;

  return (
    <div className="space-y-3">
      <Panel
        title="Phân tích cơ bản — 5 nhóm chỉ số"
        right={
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-md px-2 py-0.5 text-[11px] ${
                  tab === t.key ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
          <span>
            Kỳ: <strong className="text-ink-2">{fm?.latestPeriod ?? "—"}</strong>
          </span>
          <span>
            Nguồn: <strong className="text-ink-2">{fm?.primarySource ?? "vndirect-fs"}</strong>
          </span>
          <span>Số liệu từ snapshot Báo cáo tài chính · thiếu dữ liệu → "Không đủ dữ liệu"</span>
        </div>

        {tab === "operating" && (
          <div className="space-y-4">
            <MetricGrid items={metrics.operating} />
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">Doanh thu vs LNST (cột)</div>
                <BarDual
                  series={metrics.seriesIncome}
                  aKey="revenue"
                  bKey="netIncome"
                  aLabel="Doanh thu thuần"
                  bLabel="LN sau thuế"
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">ROE / ROA theo kỳ (đường)</div>
                <LineMulti
                  series={metrics.seriesRoe}
                  keys={[
                    { key: "roe", label: "ROE" },
                    { key: "roa", label: "ROA" },
                  ]}
                  colors={["#38bdf8", "#a78bfa"]}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">Biên LN gộp & ròng (đường)</div>
              <LineMulti
                series={metrics.seriesIncome}
                keys={[
                  { key: "grossMargin", label: "Biên gộp" },
                  { key: "netMargin", label: "Biên ròng" },
                ]}
                colors={["#fbbf24", "#34d399"]}
              />
            </div>
          </div>
        )}

        {tab === "investment" && (
          <div className="space-y-4">
            <MetricGrid items={metrics.investment} />
            <p className="text-[11px] text-ink-3">
              Beta / Sharpe / Alpha / cổ tức cần chuỗi giá VN-Index và lịch sử cổ tức — sẽ bổ sung khi nguồn
              sẵn sàng. TSR hiện tính từ bars giá (chưa gồm cổ tức).
            </p>
            {data.bars.length > 2 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">Giá đóng cửa (đường)</div>
                <LineMulti
                  series={data.bars.slice(-60).map((b, i) => ({
                    period: String(i + 1),
                    close: b.close,
                  }))}
                  keys={[{ key: "close", label: "Giá" }]}
                  colors={["#c9a227"]}
                />
              </div>
            )}
          </div>
        )}

        {tab === "health" && (
          <div className="space-y-4">
            <div className="text-[12px] font-medium text-ink-2">Khung năng lực trả nợ (4 trụ)</div>
            <MetricGrid items={metrics.debtPillars} />
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">Radar 4 trụ</div>
                <RadarFour
                  values={metrics.debtPillars.map((p) => p.value)}
                  labels={["Nợ/VCSH", "EBITDA/TS", "Trả lãi", "FCF/EBIT"]}
                />
              </div>
              <div className="flex flex-col items-center justify-center">
                <GaugeZ z={metrics.raw.altman} />
                <div className="mt-3 w-full">
                  <MetricGrid items={metrics.healthExtra} />
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">Xu hướng Nợ/VCSH & FCF/EBIT</div>
              <LineMulti
                series={metrics.debtPillarSeries}
                keys={[
                  { key: "debtEquity", label: "Nợ/VCSH" },
                  { key: "fcfEbit", label: "FCF/EBIT" },
                ]}
                colors={["#f87171", "#34d399"]}
              />
            </div>
          </div>
        )}

        {tab === "cashflow" && (
          <div className="space-y-4">
            <MetricGrid items={metrics.cashflow} />
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">CFO vs CFI theo kỳ</div>
                <StackedCf series={metrics.seriesCf} />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">LNST vs CFO (chất lượng LN)</div>
                <BarDual
                  series={metrics.seriesNiVsOcf}
                  aKey="ni"
                  bKey="ocf"
                  aLabel="LNST"
                  bLabel="CFO"
                  aColor="#a78bfa"
                  bColor="#34d399"
                />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-ink-3">FCF theo kỳ</div>
              <BarDual
                series={metrics.seriesCf.map((s) => ({
                  period: s.period,
                  fcf: s.fcf,
                  zero: 0,
                }))}
                aKey="fcf"
                bKey="zero"
                aLabel="FCF"
                bLabel=""
                aColor="#38bdf8"
                bColor="transparent"
              />
            </div>
          </div>
        )}

        {tab === "valuation" && (
          <div className="space-y-4">
            <MetricGrid items={metrics.valuation} />
            <p className="text-[11px] text-ink-3">
              P/E · P/B · EV/EBITDA tính từ giá hiện tại + snapshot BCTC (cần đủ SL cổ phiếu). DCF đầy đủ và
              so sánh ngành sẽ bổ sung khi có peers & mô hình dự phóng.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {metrics.valuation
                .filter((m) => ["pe", "pb", "eve"].includes(m.key))
                .map((m) => (
                  <div key={m.key} className="rounded-lg border border-line/50 px-3 py-3 text-center">
                    <div className="text-[10px] text-ink-3">{m.labelVi}</div>
                    <div className="num mt-1 text-2xl font-semibold text-ink-2">{formatMetric(m)}</div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Panel>

      <AiFinancialPanel symbol={symbol} />

      <Panel title="Nguồn đối chiếu (VNDIRECT DStock)">
        <ul className="space-y-1.5 text-[12px]">
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bang-can-doi-ke-toan/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Bảng cân đối kế toán — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-ket-qua-kinh-doanh/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kết quả kinh doanh — {symbol}
            </a>
          </li>
          <li>
            <a
              className="text-accent underline-offset-2 hover:underline"
              href={`https://dstock.vndirect.com.vn/bao-cao-luu-chuyen-tien-te/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lưu chuyển tiền tệ — {symbol}
            </a>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
