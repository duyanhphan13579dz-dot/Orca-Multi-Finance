"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import type { VnStockDetail } from "@/lib/services/stocks";
import { Loading, Panel, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { TechRecoPanel } from "@/components/stocks/tech-reco-panel";

export default function StockOverviewPage({ params }: { params: Promise<{ symbol: string }> }) {
  const [symbol, setSymbol] = useState("");
  useEffect(() => {
    params.then((p) => setSymbol(p.symbol.toUpperCase()));
  }, [params]);

  const { res, data, isLoading } = useApi<VnStockDetail>(symbol ? `/api/v1/stocks/${symbol}` : null, {
    refreshInterval: 30_000,
  });

  if (!symbol || (isLoading && !res)) return <Loading rows={8} />;
  if (!res?.success || !data) {
    return (
      <Unavailable
        title={`Không lấy được tổng quan ${symbol}`}
        note={res && !res.success ? res.error.message : "Nguồn thị trường đang gián đoạn."}
      />
    );
  }

  const q = data.quote;

  return (
    <div className="space-y-3">
      {q || data.bars.length > 0 ? (
        <OrcaChart
          symbol={data.symbol}
          assetType="stock"
          defaultTimeframe="1d"
          height={400}
          title={data.symbol}
          extraLevels={[
            ...(q?.ceilingPrice != null
              ? [{ label: "Trần", price: q.ceilingPrice, color: "rgba(181,140,255,0.7)" }]
              : []),
            ...(q?.referencePrice != null
              ? [{ label: "Tham chiếu", price: q.referencePrice, color: "rgba(245,165,36,0.7)" }]
              : []),
            ...(q?.floorPrice != null
              ? [{ label: "Sàn", price: q.floorPrice, color: "rgba(56,189,248,0.7)" }]
              : []),
          ]}
        />
      ) : (
        <Panel title="Biểu đồ">
          <p className="text-[12px] text-ink-3">Chưa có chuỗi giá để vẽ biểu đồ.</p>
        </Panel>
      )}

      <TechRecoPanel symbol={data.symbol} />

      {data.technical ? <TechnicalPanel tech={data.technical} patterns={data.patterns} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Trạng thái cổ phiếu">
          {data.technical ? (
            <ul className="space-y-1 text-[12px] text-ink-2">
              <li>
                Xu hướng:{" "}
                <strong>
                  {String((data.technical.trend as { label?: string } | null)?.label ?? data.technical.trend ?? "—")}
                </strong>
              </li>
              <li>RSI(14): {data.technical.rsi14 != null ? data.technical.rsi14.toFixed(1) : "—"}</li>
              <li>
                Biến động 30d:{" "}
                {data.technical.volatility30d != null
                  ? `${(data.technical.volatility30d * 100).toFixed(1)}%`
                  : "—"}
              </li>
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">Chưa đủ dữ liệu kỹ thuật.</p>
          )}
        </Panel>

        <Panel title="Tâm lý · sổ lệnh · dòng tiền · NN">
          <p className="text-[12px] text-ink-3">
            Sổ lệnh, dòng tiền theo mã và nước ngoài mua/bán sẽ gắn khi có SSI Flashconnect / depth feed. API VNDirect
            công khai hiện chưa đủ cho order book theo mã.
          </p>
        </Panel>
      </div>

      {data.notes.length > 0 && <p className="text-[11px] text-warn/90">{data.notes.join(" • ")}</p>}
    </div>
  );
}
