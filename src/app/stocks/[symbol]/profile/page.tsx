"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { StockCompanyPackage } from "@/lib/services/stock-company";
import { fmtCompact, fmtNum, Loading, Panel, Unavailable } from "@/components/ui";

export default function StockProfilePage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<StockCompanyPackage>(
    symbol ? `/api/v1/stocks/${symbol}/profile` : null,
    { refreshInterval: 600_000 },
  );

  const pie = useMemo(() => {
    const list = (data?.shareholders ?? [])
      .filter((s) => s.ownershipPct != null && s.ownershipPct > 0)
      .slice(0, 8);
    const total = list.reduce((a, s) => a + (s.ownershipPct ?? 0), 0);
    return list.map((s) => ({
      name: s.name,
      pct: s.ownershipPct ?? 0,
      shareOfChart: total > 0 ? (s.ownershipPct ?? 0) / total : 0,
    }));
  }, [data]);

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được hồ sơ ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn hồ sơ đang gián đoạn."}
      />
    );
  }

  const p = data.profile;

  return (
    <div className="space-y-3">
      <Panel title="Giới thiệu doanh nghiệp">
        {!p ? (
          <p className="text-[12px] text-ink-3">Chưa có hồ sơ từ VNDirect.</p>
        ) : (
          <div className="space-y-2 text-[12px]">
            <div className="flex flex-wrap items-start gap-3">
              {p.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logo} alt={p.vnName ?? symbol} className="h-12 w-12 rounded border border-line object-contain bg-white" />
              ) : null}
              <div>
                <div className="text-[15px] font-semibold text-ink">{p.vnName ?? symbol}</div>
                {p.enName && <div className="text-ink-3">{p.enName}</div>}
                <div className="mt-1 text-ink-3">
                  {[p.floor, p.foundDate ? `Thành lập ${p.foundDate}` : null, p.taxCode ? `MST ${p.taxCode}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
            {p.vnSummary && <p className="leading-relaxed text-ink-2">{p.vnSummary}</p>}
            <div className="grid gap-1 text-ink-3 sm:grid-cols-2">
              {p.vnAddress && <div>Địa chỉ: {p.vnAddress}</div>}
              {p.phone && <div>ĐT: {p.phone}</div>}
              {p.website && (
                <div>
                  Web:{" "}
                  <a className="text-accent hover:underline" href={p.website} target="_blank" rel="noreferrer">
                    {p.website}
                  </a>
                </div>
              )}
              {p.email && <div>Email: {p.email}</div>}
              {p.employees != null && <div>Nhân sự: {fmtNum(p.employees, 0)}</div>}
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Cổ đông lớn">
          {!data.shareholders.length ? (
            <p className="text-[12px] text-ink-3">Chưa có dữ liệu cổ đông.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="py-1.5 pr-2">Cổ đông</th>
                    <th className="py-1.5 pr-2">Vai trò</th>
                    <th className="num py-1.5 text-right">SL CP</th>
                    <th className="num py-1.5 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shareholders.slice(0, 15).map((s, i) => (
                    <tr key={i} className="border-b border-line/40">
                      <td className="max-w-[180px] truncate py-1.5 pr-2 text-ink-2">{s.name}</td>
                      <td className="py-1.5 pr-2 text-ink-3">{s.role ?? "—"}</td>
                      <td className="num py-1.5 text-right">{s.shares != null ? fmtCompact(s.shares) : "—"}</td>
                      <td className="num py-1.5 text-right">
                        {s.ownershipPct != null ? `${s.ownershipPct.toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Phân bố cổ đông (top)">
          {!pie.length ? (
            <p className="text-[12px] text-ink-3">Chưa đủ dữ liệu để vẽ phân bố.</p>
          ) : (
            <div className="space-y-2">
              {pie.map((s) => (
                <div key={s.name}>
                  <div className="mb-0.5 flex justify-between text-[11px]">
                    <span className="max-w-[70%] truncate text-ink-2">{s.name}</span>
                    <span className="num text-ink-3">{s.pct.toFixed(2)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-bg-2">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${Math.min(100, Math.max(2, s.pct))}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-ink-3">Biểu đồ thanh theo % sở hữu (VNDirect). Biểu đồ tròn đầy đủ sẽ bổ sung sau.</p>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Hội đồng quản trị">
        {data.board.length ? (
          <ul className="text-[12px]">
            {data.board.map((b, i) => (
              <li key={i}>
                {b.name} — {b.role}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-3">Chưa có dữ liệu HĐQT từ nguồn hiện tại (sẽ gắn khi có SSI / IR).</p>
        )}
      </Panel>

      <Panel title="Chuỗi giá trị (Input → Process → Output)">
        {data.valueChain ? (
          <div className="grid gap-2 md:grid-cols-3 text-[12px]">
            <div>
              <div className="text-[10px] uppercase text-ink-3">Input</div>
              <ul>{data.valueChain.input.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-3">Process</div>
              <ul>{data.valueChain.process.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
            <div>
              <div className="text-[10px] uppercase text-ink-3">Output</div>
              <ul>{data.valueChain.output.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">
            Khung chuỗi giá trị sẽ được điền từ phân tích ngành / tài liệu IR — chưa tự sinh số liệu giả.
          </p>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Catalyst tăng trưởng">
          {data.catalysts.length ? (
            <ul className="text-[12px]">{data.catalysts.map((c, i) => <li key={i}>· {c}</li>)}</ul>
          ) : (
            <p className="text-[12px] text-ink-3">Chưa có catalyst đã xác thực từ nguồn dữ liệu.</p>
          )}
        </Panel>
        <Panel title="Yếu tố rủi ro">
          {data.risks.length ? (
            <ul className="text-[12px]">{data.risks.map((c, i) => <li key={i}>· {c}</li>)}</ul>
          ) : (
            <p className="text-[12px] text-ink-3">Chưa có danh sách rủi ro đã xác thực từ nguồn dữ liệu.</p>
          )}
        </Panel>
      </div>

      <Panel title="Phân tích SWOT">
        {data.swot ? (
          <div className="grid gap-2 md:grid-cols-2 text-[12px]">
            <div>
              <strong>S</strong>
              <ul>{data.swot.strengths.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
            <div>
              <strong>W</strong>
              <ul>{data.swot.weaknesses.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
            <div>
              <strong>O</strong>
              <ul>{data.swot.opportunities.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
            <div>
              <strong>T</strong>
              <ul>{data.swot.threats.map((x, i) => <li key={i}>· {x}</li>)}</ul>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">
            SWOT sẽ được dựng từ BCTC + hồ sơ + tin tức có kiểm chứng — không điền nội dung suy đoán.
          </p>
        )}
      </Panel>

      {data.notes.length > 0 && (
        <p className="text-[11px] text-warn/90">{data.notes.join(" • ")}</p>
      )}
    </div>
  );
}
