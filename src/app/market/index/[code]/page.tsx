"use client";

import Link from "next/link";
import { use } from "react";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import type { IndexDetail } from "@/lib/services/market-intel";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { Activity, ArrowLeft, Gauge, Layers, TrendingDown, TrendingUp } from "lucide-react";

/**
 * INDEX DETAIL — VN-INDEX / VN30 / HNX-INDEX / UPCOM.
 * Price & performance · chart · buying/selling pressure (participation-based)
 * · flows · contributors (weight × change) · market intelligence summary.
 */
export default function IndexDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { settings } = useSettings();
  const { res, data, meta, isLoading } = useApi<IndexDetail>(`/api/v1/market/index/${encodeURIComponent(code)}`, { refreshInterval: 20_000 });

  if (isLoading && !res) return <Loading rows={10} />;
  if (!res?.success || !data) {
    return <Unavailable title={`Không nhận diện được chỉ số "${code.toUpperCase()}"`} note={res && !res.success ? res.error.message : undefined} />;
  }

  const q = data.quote;
  return (
    <div className="space-y-3">
      <Link href="/" className="inline-flex items-center gap-1 text-[11.5px] text-text-muted hover:text-accent-primary">
        <ArrowLeft className="size-3.5" /> Market Command Center
      </Link>

      {/* header */}
      <Panel pad={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 p-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.name}</h1>
              <Badge tone="accent">{data.exchange}</Badge>
              <Badge tone={data.session.trading ? "up" : "neutral"}>{data.session.labelVi}</Badge>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
            </div>
            {q ? (
              <div className="num mt-1 flex items-baseline gap-3">
                <span className="text-[30px] font-semibold leading-none">{fmtNum(q.value, 2)}</span>
                <Chg value={q.changePercent} className="text-[15px]" />
                <span className="text-[12px] text-text-muted">{q.change >= 0 ? "+" : ""}{fmtNum(q.change, 2)} điểm</span>
              </div>
            ) : (
              <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-text-secondary">{data.note}</p>
            )}
          </div>
          {q?.volume != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Khối lượng</div>
              <div className="num text-[14px]">{fmtCompact(q.volume)}</div>
            </div>
          )}
        </div>
        <div className="border-t border-border-subtle px-4 py-2"><MetaLine meta={meta} /></div>
      </Panel>

      {/* chart */}
      <OrcaChart symbol={data.code} assetType="stock" defaultTimeframe="1d" height={400} title={`${data.name} — biểu đồ`} />

      <div className="grid grid-cols-12 gap-3">
        {/* pressure */}
        <Panel className="col-span-12 lg:col-span-4" title={<span className="flex items-center gap-2"><Gauge className="size-4 text-accent-primary" /> Áp lực mua / bán</span>}>
          {data.pressure.available ? (
            <div className="space-y-2">
              <div className="flex h-3 overflow-hidden rounded-full bg-surface-modal">
                <div className="bg-positive" style={{ width: `${data.pressure.buying}%` }} />
                <div className="bg-negative" style={{ width: `${data.pressure.selling}%` }} />
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-up">Mua <b className="num">{data.pressure.buying}%</b></span>
                <span className={`num ${(data.pressure.net ?? 0) >= 0 ? "text-up" : "text-down"}`}>net {data.pressure.net! >= 0 ? "+" : ""}{data.pressure.net}</span>
                <span className="text-down">Bán <b className="num">{data.pressure.selling}%</b></span>
              </div>
              <p className="text-[10.5px] leading-relaxed text-text-muted">{data.pressure.basis}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="h-3 rounded-full bg-surface-modal" />
              <p className="text-[11px] leading-relaxed text-text-muted">{data.pressure.basis}</p>
            </div>
          )}
        </Panel>

        {/* breadth */}
        <Panel className="col-span-12 lg:col-span-4" title={<span className="flex items-center gap-2"><Layers className="size-4 text-accent-primary" /> Độ rộng</span>}>
          {data.breadth.available ? (
            <div className="flex gap-2">
              <span className="flex-1 rounded-md bg-up/10 p-2.5 text-center text-[13px] text-up">↑ <b className="num">{data.breadth.advancers}</b></span>
              <span className="flex-1 rounded-md bg-down/10 p-2.5 text-center text-[13px] text-down">↓ <b className="num">{data.breadth.decliners}</b></span>
              <span className="flex-1 rounded-md bg-surface-elevated p-2.5 text-center text-[13px] text-text-muted">— <b className="num">{data.breadth.unchanged}</b></span>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-text-muted">{data.breadth.note}</p>
          )}
        </Panel>

        {/* intel summary */}
        <Panel className="col-span-12 lg:col-span-4" title={<span className="flex items-center gap-2"><Activity className="size-4 text-accent-primary" /> Market Intelligence</span>}>
          <dl className="space-y-1 text-[12px]">
            {[
              ["Xu hướng", data.intel.trend],
              ["Momentum score", data.intel.momentum],
              ["Độ rộng", data.intel.breadthState],
              ["Thanh khoản", data.intel.liquidity],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <dt className="text-text-muted">{k}</dt>
                <dd className="num text-text-primary">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        {/* contributors */}
        <Panel className="col-span-12" pad={false} title="Cổ phiếu tác động chỉ số">
          {data.contributors.positive.length + data.contributors.negative.length === 0 ? (
            <div className="p-4"><Unavailable title="Chưa có dữ liệu cấu phần" note="Cần VNStock/VNDirect cho giá cấu phần và tỷ trọng rổ chỉ số." /></div>
          ) : (
            <div className="grid gap-3 p-3 md:grid-cols-2">
              {([["Đóng góp tích cực", data.contributors.positive, "up"], ["Đóng góp tiêu cực", data.contributors.negative, "down"]] as const).map(([title, rows, tone]) => (
                <div key={title} className="panel-inset p-2.5">
                  <div className={`mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest ${tone === "up" ? "text-positive" : "text-negative"}`}>
                    {tone === "up" ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />} {title}
                  </div>
                  <ul className="space-y-0.5">
                    {rows.map((r) => (
                      <li key={r.symbol} className="flex items-center justify-between text-[12px]">
                        <Link href={`/stocks/${r.symbol}`} className="font-semibold hover:text-accent-primary">{r.symbol}</Link>
                        <span className="flex items-center gap-2">
                          <Chg value={r.changePercent} className="text-[11px]" arrow={false} />
                          {r.indexPoints != null && <span className="num w-14 text-right text-[11px] text-text-muted">{r.indexPoints >= 0 ? "+" : ""}{r.indexPoints.toFixed(2)}đ</span>}
                        </span>
                      </li>
                    ))}
                    {!rows.length && <li className="text-[11px] text-text-muted">—</li>}
                  </ul>
                </div>
              ))}
              <p className="col-span-full text-[10.5px] text-text-muted">{data.contributors.note}</p>
            </div>
          )}
        </Panel>

        {/* constituents */}
        {data.constituents.length > 0 && (
          <Panel className="col-span-12" pad={false} title={`Cấu phần theo dõi (${data.constituents.length} mã)`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wider text-text-muted">
                    <th className="px-3.5 py-2 font-medium">Mã</th>
                    <th className="py-2 font-medium">Doanh nghiệp</th>
                    <th className="py-2 font-medium">Ngành</th>
                    <th className="py-2 text-right font-medium">Giá</th>
                    <th className="py-2 pr-3.5 text-right font-medium">± %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.constituents.map((c) => (
                    <tr key={c.symbol} className="row-hover border-b border-border-subtle/40">
                      <td className="px-3.5 py-2"><Link href={`/stocks/${c.symbol}`} className="font-semibold hover:text-accent-primary">{c.symbol}</Link></td>
                      <td className="max-w-72 truncate py-2 text-text-muted">{c.name ?? "—"}</td>
                      <td className="py-2 text-[11px] text-text-muted">{c.sector ?? "—"}</td>
                      <td className="num py-2 text-right">{c.price != null ? fmtNum(c.price, 2) : "—"}</td>
                      <td className="py-2 pr-3.5 text-right"><Chg value={c.changePercent} arrow={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>

      <p className="text-[10.5px] text-text-muted">
        Múi giờ hiển thị: {settings.profile.timezone}. Mọi cấu phần đều gắn nguồn + timestamp + freshness; phần thiếu dữ liệu được đánh dấu UNAVAILABLE thay vì ước lượng.
      </p>
    </div>
  );
}
