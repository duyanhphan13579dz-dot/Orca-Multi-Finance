"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { Meta } from "@/lib/types";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Activity, ArrowRight, BrainCircuit, Globe2, TrendingUp } from "lucide-react";

export function Dashboard() {
  const { data, meta, isLoading, isValidating, mutate, error } = useApi<MarketIntel>("/api/v1/market/intel", {
    refreshInterval: 12_000,
    timeoutMs: 18_000,
  });
  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Loading rows={6} />
        <Loading rows={8} />
        <p className="text-center text-[11px] text-text-muted">Đang dựng Market Intelligence từ VNDirect…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <Unavailable
          title="Market Intelligence Engine đang kết nối lại"
          note={
            error
              ? "Mất kết nối tạm thời tới provider — tự thử lại sau vài giây. Hoặc mở /system."
              : "Payload chưa sẵn sàng — đang đồng bộ VNDirect. Thử làm mới."
          }
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void mutate()}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary hover:border-border-default hover:text-text-primary"
          >
            {isValidating ? "Đang tải…" : "Thử lại ngay"}
          </button>
        </div>
      </div>
    );
  }
  return <IntelView intel={data} meta={meta} />;
}

const RATING_TONE: Record<string, "up" | "down" | "warn" | "neutral"> = {
  BULLISH: "up",
  "MODERATELY BULLISH": "up",
  NEUTRAL: "neutral",
  MIXED: "warn",
  "MODERATELY BEARISH": "down",
  BEARISH: "down",
};

const RATING_VI: Record<string, string> = {
  BULLISH: "Tích cực",
  "MODERATELY BULLISH": "Hơi tích cực",
  NEUTRAL: "Trung lập",
  MIXED: "Trộn lẫn",
  "MODERATELY BEARISH": "Hơi tiêu cực",
  BEARISH: "Tiêu cực",
};

function IntelView({ intel, meta }: { intel: MarketIntel; meta: Meta | null }) {
  const c = intel.condition;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-text-primary">Market Intelligence</h1>
            <Badge tone={intel.session.trading ? "up" : "neutral"}>{intel.session.labelVi}</Badge>
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </div>
          <p className="mt-0.5 text-[12px] text-text-secondary">{intel.sessionHint}</p>
          {intel.vnDataNote && <p className="mt-1 text-[11px] text-text-muted">{intel.vnDataNote}</p>}
        </div>
        {meta && <MetaLine meta={meta} />}
      </div>

      {intel.indicesAvailable ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {intel.indices!.slice(0, 4).map((i) => (
            <Link
              key={i.code}
              href={`/market/index/${encodeURIComponent(i.code)}`}
              className="panel-inset flex flex-col gap-0.5 p-2.5 transition hover:border-border-default"
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{i.code}</span>
              <span className="num text-[15px] font-semibold text-text-primary">{fmtNum(i.value, 2)}</span>
              <Chg value={i.changePercent} className="text-[11px]" />
            </Link>
          ))}
        </div>
      ) : (
        <Unavailable title="Chỉ số VN chưa sẵn sàng" note="Đang kết nối VNDirect / SSI." />
      )}

      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <BrainCircuit className="size-3.5 text-accent-primary" />
            Trạng thái thị trường
          </span>
        }
        right={<Badge tone={RATING_TONE[c.rating] ?? "neutral"}>{RATING_VI[c.rating] ?? c.rating}</Badge>}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="flex items-end gap-2">
              <span className="num text-3xl font-semibold text-text-primary">{Math.round(c.score)}</span>
              <span className="mb-1 text-[11px] text-text-muted">/ 100 · {c.confidence}</span>
            </div>
            <ScoreBar score={c.score} />
            <p className="mt-2 text-[11px] text-text-secondary">Cross-asset: {c.crossAssetState}</p>
            {c.drivers.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-text-secondary">
                {c.drivers.slice(0, 4).map((d) => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
            )}
            {c.risks.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-warning">
                {c.risks.slice(0, 3).map((d) => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            {c.components.map((comp) => (
              <div key={comp.key} className="flex items-center gap-2 text-[12px]">
                <span className="w-24 shrink-0 text-text-muted">{comp.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-modal">
                  <div
                    className={`h-full rounded-full ${
                      !comp.available || comp.score == null
                        ? "bg-border-default"
                        : comp.score >= 55
                          ? "bg-positive"
                          : comp.score <= 45
                            ? "bg-negative"
                            : "bg-warning"
                    }`}
                    style={{
                      width: `${comp.available && comp.score != null ? Math.max(4, Math.min(100, comp.score)) : 4}%`,
                    }}
                  />
                </div>
                <span className="num w-8 text-right text-text-secondary">
                  {comp.available && comp.score != null ? Math.round(comp.score) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <Panel
          className="col-span-12 md:col-span-6 xl:col-span-4"
          title={
            <span className="flex items-center gap-1.5">
              <Activity className="size-3.5" /> Độ rộng thị trường
            </span>
          }
        >
          {intel.breadth.available ? (
            <BreadthView
              a={intel.breadth.advancers}
              d={intel.breadth.decliners}
              u={intel.breadth.unchanged}
              source={intel.breadth.source}
              adRatio={intel.breadth.adRatio}
              advancePct={intel.breadth.advancePct}
              netAdvances={intel.breadth.netAdvances}
              regimeVi={intel.breadth.regimeVi}
            />
          ) : (
            <Unavailable title="Breadth chưa có" note={intel.breadth.note} />
          )}
        </Panel>

        <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Dòng vốn thị trường">
          <div className="space-y-2">
            {(
              [
                ["Khối ngoại", intel.flow.foreignNet],
                ["Tự doanh", intel.flow.propNet],
                ["ETF", intel.flow.etfNet],
              ] as const
            ).map(([label, val]) => (
              <div key={label} className="flex items-center justify-between text-[12px]">
                <span className="text-text-secondary">{label}</span>
                <span
                  className={`num font-medium ${
                    val == null ? "text-text-muted" : val >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {val == null ? "—" : fmtCompact(val)}
                </span>
              </div>
            ))}
            <p className="text-[10px] text-text-muted">{intel.flow.note}</p>
          </div>
        </Panel>

        <Panel className="col-span-12 xl:col-span-4" title="Thanh khoản">
          {intel.liquidity.available ? (
            <div>
              <div className="text-[11px] text-text-muted">GTGD phiên</div>
              <div className="num text-[18px] font-semibold text-text-primary">
                {fmtCompact(intel.liquidity.valueTraded!)}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">{intel.liquidity.note}</p>
            </div>
          ) : (
            <Unavailable title="Thanh khoản" note={intel.liquidity.note} />
          )}
        </Panel>
      </div>

      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <TrendingUp className="size-3.5" /> Đóng góp chỉ số
          </span>
        }
      >
        {intel.contributors.positive.length + intel.contributors.negative.length === 0 ? (
          <Unavailable title="Chưa có đóng góp" note={intel.contributors.note} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <ContribList
              title="Đóng góp tích cực"
              rows={intel.contributors.positive}
              tone="up"
              hasWeights={intel.contributors.hasWeights}
            />
            <ContribList
              title="Đóng góp tiêu cực"
              rows={intel.contributors.negative}
              tone="down"
              hasWeights={intel.contributors.hasWeights}
            />
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <Panel
          className="col-span-12 lg:col-span-5"
          title={
            <span className="flex items-center gap-1.5">
              <Globe2 className="size-3.5" /> Cross-asset
            </span>
          }
        >
          {intel.crossAsset.length === 0 ? (
            <Unavailable title="Cross-asset chưa sẵn sàng" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {intel.crossAsset.map((x) => (
                <div key={x.key} className="rounded-md border border-border-subtle px-2 py-1.5">
                  <div className="text-[10px] text-text-muted">{x.label}</div>
                  <div className="num text-[13px] font-medium">{fmtNum(x.value, 2)}</div>
                  <Chg value={x.changePercent} className="text-[11px]" />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          className="col-span-12 lg:col-span-7"
          title="Dòng tin thị trường"
          right={
            <Link href="/news" className="text-[11px] text-text-muted hover:text-text-secondary">
              Xem tất cả <ArrowRight className="inline size-3" />
            </Link>
          }
        >
          {!intel.news.length ? (
            <Unavailable title="Luồng tin chưa khả dụng" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {intel.news.slice(0, 8).map((n, idx) => (
                <li key={idx} className="py-2">
                  <a
                    href={n.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-text-primary hover:text-accent-primary"
                  >
                    {n.title}
                  </a>
                  <div className="mt-0.5 text-[10px] text-text-muted">
                    {n.source ?? "news"}
                    {n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleString("vi-VN")}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex justify-end">
        <Link
          href="/system"
          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary"
        >
          System health <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="mt-2">
      <div className="relative h-2 overflow-hidden rounded-full bg-gradient-to-r from-negative via-warning to-positive">
        <div
          className="absolute top-0 h-full w-[3px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]"
          style={{ left: `calc(${Math.max(1, Math.min(99, score))}% - 1.5px)` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] uppercase tracking-wider text-text-muted">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
    </div>
  );
}

function BreadthView({
  a,
  d,
  u,
  source,
  adRatio,
  advancePct,
  netAdvances,
  regimeVi,
}: {
  a: number;
  d: number;
  u: number;
  source: string;
  adRatio?: number | null;
  advancePct?: number | null;
  netAdvances?: number | null;
  regimeVi?: string | null;
}) {
  const tot = Math.max(1, a + d + u);
  const ratioLabel = adRatio == null ? "—" : adRatio >= 10 ? ">10" : adRatio.toFixed(2);
  const pctLabel = advancePct != null ? `${advancePct.toFixed(1)}%` : "—";
  const netLabel = netAdvances == null ? "—" : `${netAdvances >= 0 ? "+" : ""}${netAdvances}`;
  const regimeTone =
    regimeVi?.includes("Mở") || regimeVi?.includes("tăng")
      ? "up"
      : regimeVi?.includes("Thu") || regimeVi?.includes("giảm")
        ? "down"
        : "neutral";
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <span className="flex-1 rounded-md bg-up/10 p-2 text-center text-[13px] text-up">
          ↑ <b className="num">{a}</b>
        </span>
        <span className="flex-1 rounded-md bg-down/10 p-2 text-center text-[13px] text-down">
          ↓ <b className="num">{d}</b>
        </span>
        <span className="flex-1 rounded-md bg-surface-elevated p-2 text-center text-[13px] text-text-muted">
          — <b className="num">{u}</b>
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-modal">
        <div className="bg-positive" style={{ width: `${(a / tot) * 100}%` }} />
        <div className="bg-border-default" style={{ width: `${(u / tot) * 100}%` }} />
        <div className="bg-negative" style={{ width: `${(d / tot) * 100}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-md border border-border-subtle bg-surface-elevated px-1.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-text-muted">A/D</div>
          <div className="num text-[13px] font-semibold text-text-primary">{ratioLabel}</div>
        </div>
        <div className="rounded-md border border-border-subtle bg-surface-elevated px-1.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-text-muted">% tăng</div>
          <div className="num text-[13px] font-semibold text-text-primary">{pctLabel}</div>
        </div>
        <div className="rounded-md border border-border-subtle bg-surface-elevated px-1.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-text-muted">Net</div>
          <div
            className={`num text-[13px] font-semibold ${
              netAdvances == null ? "text-text-muted" : netAdvances >= 0 ? "text-up" : "text-down"
            }`}
          >
            {netLabel}
          </div>
        </div>
      </div>
      {regimeVi ? (
        <div className="flex items-center justify-between gap-2">
          <Badge tone={regimeTone}>{regimeVi}</Badge>
          <span className="text-[10px] text-text-muted">{source}</span>
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">{source}</div>
      )}
    </div>
  );
}

function ContribList({
  title,
  rows,
  tone,
  hasWeights,
}: {
  title: string;
  rows: { symbol: string; changePercent: number; indexPoints: number | null }[];
  tone: "up" | "down";
  hasWeights: boolean;
}) {
  return (
    <div className="panel-inset p-2.5">
      <div
        className={`mb-1.5 text-[10px] font-semibold uppercase tracking-widest ${
          tone === "up" ? "text-positive" : "text-negative"
        }`}
      >
        {title}
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.symbol} className="flex items-center justify-between text-[12px]">
            <Link href={`/stocks/${r.symbol}`} className="font-semibold hover:text-accent-primary">
              {r.symbol}
            </Link>
            <span className="flex items-center gap-2">
              <Chg value={r.changePercent} className="text-[11px]" arrow={false} />
              {hasWeights && r.indexPoints != null && (
                <span className="num w-14 text-right text-[11px] text-text-muted">
                  {r.indexPoints >= 0 ? "+" : ""}
                  {r.indexPoints.toFixed(2)}đ
                </span>
              )}
            </span>
          </li>
        ))}
        {!rows.length && <li className="text-[11px] text-text-muted">—</li>}
      </ul>
    </div>
  );
}
