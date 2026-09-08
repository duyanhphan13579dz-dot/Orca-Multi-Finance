"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import type { MarketIntel } from "@/lib/services/market-intel";
import type { Meta } from "@/lib/types";
import { VN_SECTOR_MAP } from "@/lib/vn/master";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Activity, ArrowRight, ArrowUpRight, BrainCircuit, Factory, Globe2, KeyRound, Layers, Scale, TrendingUp } from "lucide-react";

/**
 * ORCA REAL-TIME MARKET INTELLIGENCE COMMAND CENTER
 * Vietnam market → condition engine → cross-asset context → breadth → flow →
 * contributors → analyst intelligence. Every widget shows source + freshness.
 */

export function Dashboard() {
  const { data, meta, isLoading } = useApi<MarketIntel>("/api/v1/market/intel", { refreshInterval: 20_000 });
  if (isLoading && !data) return <div className="space-y-3"><Loading rows={6} /><Loading rows={8} /></div>;
  if (!data) return <Unavailable title="Market Intelligence Engine chưa sẵn sàng" note="Không dựng được payload. Kiểm tra /system." />;
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
  "MODERATELY BULLISH": "Nghiêng tích cực",
  NEUTRAL: "Trung tính",
  MIXED: "Phân hóa",
  "MODERATELY BEARISH": "Nghiêng tiêu cực",
  BEARISH: "Tiêu cực",
};

function IntelView({ intel, meta }: { intel: MarketIntel; meta: Meta | null }) {
  const { settings } = useSettings();
  const c = intel.condition;
  const tz = settings.profile.timezone;

  return (
    <div className="space-y-3">
      {/* ============== 1. VIETNAM MARKET ============== */}
      <Panel
        pad={false}
        title={
          <span className="flex items-center gap-2">
            <Activity className="size-4 text-accent-primary" /> Thị trường Việt Nam
            <Badge tone="accent">CORE</Badge>
          </span>
        }
        right={
          <span className="flex items-center gap-2">
            <Badge tone={intel.session.trading ? "up" : "neutral"}>{intel.session.labelVi}</Badge>
            <FreshnessDot status={meta?.sections?.vn_stocks} />
          </span>
        }
      >
        {intel.indicesAvailable ? (
          <div className="grid grid-cols-2 gap-2 p-2.5 sm:p-3 md:grid-cols-4">
            {intel.indices!.slice(0, 4).map((i, n) => (
              <Link key={i.code} href={`/market/index/${i.code}`} className={`hover-lift flex min-h-[88px] flex-col justify-between rounded-xl border p-3 active:scale-[0.99] ${n === 0 ? "border-accent-primary/40 bg-accent-primary/5" : "border-border-subtle bg-surface-elevated"}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-semibold ${n === 0 ? "text-accent-primary" : "text-text-secondary"}`}>{i.code}</span>
                  <ArrowUpRight className="size-3 text-text-muted" />
                </div>
                <div className="num mt-1 text-[19px] font-semibold leading-none sm:text-[20px]">{fmtNum(i.value, 2)}</div>
                <div className="flex items-center justify-between">
                  <Chg value={i.changePercent} className="text-[11.5px]" arrow={false} />
                  {i.volume != null && <span className="num text-[10px] text-text-muted">KL {fmtCompact(i.volume)}</span>}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-[1.2fr_1fr]">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <KeyRound className="size-4 text-warning" />
                <span className="text-[13.5px] font-semibold">Chỉ số VN đang UNAVAILABLE</span>
              </div>
              <p className="text-[12.5px] leading-relaxed text-text-secondary">
                VN-INDEX · VN30 · HNX-INDEX · UPCOM-INDEX cần <b>VNStock</b> (primary) + <b>VNDirect</b> (validation). Market Condition Engine bên dưới vẫn chạy với các cấu phần sẵn có và <b>tự hạ độ tin cậy</b> thay vì suy diễn số liệu trong nước.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["VNINDEX", "VN30", "HNXINDEX", "UPCOM"].map((k) => (
                  <Link key={k} href={`/market/index/${k}`} className="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-muted hover:border-accent-primary/40 hover:text-accent-primary">
                    {k} →
                  </Link>
                ))}
              </div>
            </div>
            <div className="panel-inset p-3 text-[11px] text-text-muted">
              <div className="mb-1 font-semibold uppercase tracking-widest text-text-secondary">Session engine</div>
              {intel.sessionHint}
            </div>
          </div>
        )}
      </Panel>

      {/* ============== 2. MARKET CONDITION ============== */}
      <Panel
        pad={false}
        title={<span className="flex items-center gap-2"><Scale className="size-4 text-accent-primary" /> Đánh giá trạng thái thị trường</span>}
        right={<span className="text-[10px] text-text-muted">Quantitative Market State Engine</span>}
      >
        <div className="grid gap-4 p-4 lg:grid-cols-[300px_1fr]">
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-[26px] font-bold leading-none ${RATING_TONE[c.rating] === "up" ? "text-up" : RATING_TONE[c.rating] === "down" ? "text-down" : RATING_TONE[c.rating] === "warn" ? "text-warn" : "text-text-primary"}`}>
                {RATING_VI[c.rating]}
              </span>
              <span className="num text-[13px] text-text-muted">{c.score}/100</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <Badge tone={c.confidence === "HIGH" ? "up" : c.confidence === "MEDIUM" ? "warn" : "down"}>Confidence {c.confidence}</Badge>
              <span className="text-text-muted">độ phủ dữ liệu {(c.coverage * 100).toFixed(0)}%</span>
            </div>
            <ScoreBar score={c.score} />
            <div className="mt-3 space-y-1">
              {c.components.map((cp) => (
                <div key={cp.key} className="group relative" title={`${cp.formula}${cp.note ? ` · ${cp.note}` : ""}`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={cp.available ? "text-text-secondary" : "text-text-muted line-through decoration-text-muted/40"}>{cp.label}</span>
                    <span className="num text-text-muted">{cp.score != null ? cp.score.toFixed(0) : "n/a"} <span className="text-[9px]">w{(cp.weight * 100).toFixed(0)}</span></span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-modal">
                    <div className={`h-full rounded-full ${(cp.score ?? 50) >= 55 ? "bg-positive" : (cp.score ?? 50) <= 45 ? "bg-negative" : "bg-warning"}`} style={{ width: `${cp.score ?? 0}%`, opacity: cp.available ? 1 : 0.25 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-positive"><TrendingUp className="size-3" /> Động lực chính</div>
              <ul className="space-y-1 text-[12.5px] leading-relaxed text-text-secondary">
                {c.drivers.map((d, i) => <li key={i}>▸ {d}</li>)}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-negative">Rủi ro chính</div>
              <ul className="space-y-1 text-[12.5px] leading-relaxed text-text-secondary">
                {c.risks.map((r, i) => <li key={i}>▸ {r}</li>)}
              </ul>
            </div>
            <p className="text-[10.5px] text-text-muted">
              Điểm số sinh bởi công thức có trọng số minh bạch (hover từng cấu phần để xem công thức). LLM chỉ diễn giải, không quyết định trạng thái.
            </p>
          </div>
        </div>
      </Panel>

      {/* ============== 3. CROSS-ASSET ============== */}
      <Panel
        pad={false}
        title={<span className="flex items-center gap-2"><Globe2 className="size-4 text-accent-primary" /> Cross-Asset — bối cảnh quốc tế</span>}
        right={
          <Badge tone={c.crossAssetState === "RISK ON" ? "up" : c.crossAssetState === "RISK OFF" ? "down" : c.crossAssetState === "MIXED" ? "warn" : "neutral"}>
            {c.crossAssetState}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-2 p-2.5 sm:p-3 md:grid-cols-3 xl:grid-cols-6">
          {intel.crossAsset.map((x) => (
            <div key={x.key} className="rounded-lg border border-border-subtle bg-surface-elevated p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-text-secondary">{x.key}</span>
                {x.quality !== "VALID" && <Badge tone="warn">{x.quality}</Badge>}
              </div>
              <div className="num mt-1 text-[15px] font-semibold">
                {x.value != null ? fmtNum(x.value, x.value >= 1000 ? 0 : 2) : "—"}
              </div>
              <Chg value={x.changePercent} className="text-[11px]" arrow={false} />
              <div className="mt-1 truncate text-[9px] text-text-muted" title={`${x.source}${x.sourceTimestamp ? ` · ${new Date(x.sourceTimestamp).toLocaleString("vi-VN", { timeZone: tz })}` : ""}`}>
                {x.source.split(" (")[0]}
                {x.sourceTimestamp && ` · ${new Date(x.sourceTimestamp).toLocaleTimeString("vi-VN", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}`}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ============== 4. BREADTH + FLOW ============== */}
      <div className="grid grid-cols-12 gap-3">
        <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={<span className="flex items-center gap-2"><Layers className="size-4 text-accent-primary" /> Độ rộng thị trường</span>}>
          {intel.breadth.available ? (
            <BreadthView a={intel.breadth.advancers} d={intel.breadth.decliners} u={intel.breadth.unchanged} source={intel.breadth.source} />
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2 text-[13px]">
                <span className="flex-1 rounded-md bg-up/10 p-2 text-center text-up">↑ <b>—</b></span>
                <span className="flex-1 rounded-md bg-down/10 p-2 text-center text-down">↓ <b>—</b></span>
                <span className="flex-1 rounded-md bg-surface-elevated p-2 text-center text-text-muted">— <b>—</b></span>
              </div>
              <p className="text-[11px] leading-relaxed text-text-muted">{intel.breadth.note}</p>
            </div>
          )}
        </Panel>

        <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Dòng vốn thị trường">
          <div className="space-y-1.5">
            {[
              ["Khối ngoại", intel.flow.foreignNet],
              ["Tự doanh", intel.flow.propNet],
              ["ETF", intel.flow.etfNet],
            ].map(([label, v]) => (
              <div key={String(label)} className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
                <span className="text-[12px] text-text-secondary">{String(label)}</span>
                {v == null ? <Badge tone="warn">UNAVAILABLE</Badge> : <span className="num text-[12.5px]">{fmtCompact(v as number)}</span>}
              </div>
            ))}
            <p className="text-[10.5px] leading-relaxed text-text-muted">{intel.flow.note}</p>
          </div>
        </Panel>

        <Panel className="col-span-12 xl:col-span-4" title="Thanh khoản">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-text-secondary">Giá trị giao dịch (rổ theo dõi)</span>
              <span className="num text-[15px] font-semibold">{intel.liquidity.valueTraded != null ? fmtCompact(intel.liquidity.valueTraded) : "—"}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-text-muted">{intel.liquidity.note}</p>
            <div className="rounded-md bg-surface-elevated p-2 text-[11px] text-text-muted">
              Sector taxonomy: <b className="text-text-secondary">{VN_SECTOR_MAP.length}</b> nhóm ngành ·{" "}
              <Link href="/stocks" className="text-accent-primary hover:underline">mở bảng giá VN →</Link>
            </div>
          </div>
        </Panel>
      </div>

      {/* ============== 5. CONTRIBUTORS ============== */}
      <Panel
        pad={false}
        title={<span className="flex items-center gap-2"><Factory className="size-4 text-accent-primary" /> Cổ phiếu tác động chỉ số</span>}
        right={<Link href="/market/index/VNINDEX" className="flex items-center gap-1 text-[11px] text-accent-primary hover:underline">VN-Index detail <ArrowRight className="size-3" /></Link>}
      >
        {intel.contributors.positive.length + intel.contributors.negative.length === 0 ? (
          <div className="p-4">
            <Unavailable title="Chưa có dữ liệu cấu phần chỉ số" note="Cần VNStock/VNDirect cho giá cổ phiếu và tỷ trọng rổ chỉ số. Engine tính đóng góp = giá trị chỉ số × tỷ trọng × %thay đổi — không suy đoán từ mã tăng mạnh nhất." />
          </div>
        ) : (
          <div className="grid gap-3 p-3 md:grid-cols-2">
            <ContribList title="Đóng góp tích cực" rows={intel.contributors.positive} tone="up" hasWeights={intel.contributors.hasWeights} />
            <ContribList title="Đóng góp tiêu cực" rows={intel.contributors.negative} tone="down" hasWeights={intel.contributors.hasWeights} />
            <p className="col-span-full text-[10.5px] text-text-muted">{intel.contributors.note}</p>
          </div>
        )}
      </Panel>

      {/* ============== 6. NEWS + ACTIONS ============== */}
      <div className="grid grid-cols-12 gap-3">
        <Panel className="col-span-12 lg:col-span-8" title="Dòng tin thị trường" right={<Link href="/news" className="text-[11px] text-accent-primary hover:underline">Tất cả</Link>}>
          {!intel.news.length ? <Unavailable title="Luồng tin chưa khả dụng" /> : (
            <ul className="divide-y divide-border-subtle/60">
              {intel.news.map((n) => (
                <li key={n.id} className="row-hover flex items-start gap-3 px-1.5 py-2">
                  <span className="num mt-1 shrink-0 text-[10px] text-text-muted">{new Date(n.publishedAt).toLocaleTimeString("vi-VN", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}</span>
                  <div className="min-w-0">
                    <a href={n.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[13px] leading-snug text-text-primary hover:text-accent-primary">{n.title}</a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                      <span>{n.source}</span>
                      {n.relatedSector && <Badge tone="accent">{n.relatedSector}</Badge>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="col-span-12 space-y-3 lg:col-span-4">
          <Link href="/agent" className="panel hover-lift flex items-start gap-3 p-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-primary/10 text-accent-primary"><BrainCircuit className="size-4" /></span>
            <span>
              <span className="block text-[13px] font-medium">Hỏi AI Agent</span>
              <span className="block text-[11px] text-text-muted">Fetch-first · VN equity analyst</span>
            </span>
          </Link>
          <Link href="/reports" className="panel hover-lift flex items-start gap-3 p-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-primary/10 text-accent-primary"><Activity className="size-4" /></span>
            <span>
              <span className="block text-[13px] font-medium">Report Center</span>
              <span className="block text-[11px] text-text-muted">Morning Brief · Market Summary</span>
            </span>
          </Link>
          <div className="panel p-3">
            <MetaLine meta={meta} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="mt-2">
      <div className="relative h-2 overflow-hidden rounded-full" style={{ background: "linear-gradient(90deg,#ee5f75,#f5a524,#2ec27e)" }}>
        <div className="absolute inset-y-0 w-[3px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]" style={{ left: `calc(${Math.max(1, Math.min(99, score))}% - 1.5px)` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] uppercase tracking-wider text-text-muted">
        <span>Bearish</span><span>Neutral</span><span>Bullish</span>
      </div>
    </div>
  );
}

function BreadthView({ a, d, u, source }: { a: number; d: number; u: number; source: string }) {
  const tot = Math.max(1, a + d + u);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <span className="flex-1 rounded-md bg-up/10 p-2 text-center text-[13px] text-up">↑ <b className="num">{a}</b></span>
        <span className="flex-1 rounded-md bg-down/10 p-2 text-center text-[13px] text-down">↓ <b className="num">{d}</b></span>
        <span className="flex-1 rounded-md bg-surface-elevated p-2 text-center text-[13px] text-text-muted">— <b className="num">{u}</b></span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-modal">
        <div className="bg-positive" style={{ width: `${(a / tot) * 100}%` }} />
        <div className="bg-border-default" style={{ width: `${(u / tot) * 100}%` }} />
        <div className="bg-negative" style={{ width: `${(d / tot) * 100}%` }} />
      </div>
      <p className="text-[10.5px] text-text-muted">
        {a > d ? "Sắc xanh chiếm ưu thế — nhịp tăng có sự tham gia rộng." : a < d ? "Sắc đỏ chiếm ưu thế — áp lực bán lan rộng." : "Cân bằng."} Nguồn: {source}.
      </p>
    </div>
  );
}

function ContribList({ title, rows, tone, hasWeights }: { title: string; rows: { symbol: string; changePercent: number; indexPoints: number | null }[]; tone: "up" | "down"; hasWeights: boolean }) {
  return (
    <div className="panel-inset p-2.5">
      <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-widest ${tone === "up" ? "text-positive" : "text-negative"}`}>{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.symbol} className="flex items-center justify-between text-[12px]">
            <Link href={`/stocks/${r.symbol}`} className="font-semibold hover:text-accent-primary">{r.symbol}</Link>
            <span className="flex items-center gap-2">
              <Chg value={r.changePercent} className="text-[11px]" arrow={false} />
              {hasWeights && r.indexPoints != null && <span className="num w-14 text-right text-[11px] text-text-muted">{r.indexPoints >= 0 ? "+" : ""}{r.indexPoints.toFixed(2)}đ</span>}
            </span>
          </li>
        ))}
        {!rows.length && <li className="text-[11px] text-text-muted">—</li>}
      </ul>
    </div>
  );
}
