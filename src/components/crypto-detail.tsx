"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import type { CandlePattern, CryptoMarketRow, TechnicalSnapshot } from "@/lib/types";

/** Client-local shape — never import from server-only services into client components. */
interface CryptoDetail {
  symbol: string;
  baseAsset: string;
  ticker: CryptoMarketRow;
  klines: unknown[];
  interval: string;
  technical: TechnicalSnapshot | null;
  patterns: CandlePattern[];
  funding: { fundingRate: number; markPrice?: number; nextFundingTime?: number } | null;
  openInterest: { openInterest: number; time: number } | null;
  fundingStatus: "ok" | "unavailable";
}
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { OrcaChart } from "@/components/orca-chart";
import { TechnicalPanel } from "@/components/technical-panel";
import { ScalpPanel } from "@/components/scalp-panel";
import { CryptoTradeDesk } from "@/components/crypto-trade-desk";
import { AddToWatchlist } from "@/components/watchlist-button";
import { useSettings } from "@/lib/settings";
import { usePrefCurrency } from "@/lib/fx-pref";
import { Flame, Fuel } from "lucide-react";

const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

export function CryptoDetailPage({ symbol }: { symbol: string }) {
  const { settings } = useSettings();
  const { fmtUsd } = usePrefCurrency();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>(
    (settings.dashboard.defaultTimeframe as (typeof INTERVALS)[number]) || "1h",
  );
  const { data, meta, isLoading } = useApi<CryptoDetail>(`/api/v1/crypto/${encodeURIComponent(symbol)}?interval=${interval}`, {
    refreshInterval: 20_000,
  });

  if (isLoading && !data) return <Loading rows={10} />;
  if (!data)
    return (
      <Unavailable
        title={`Không lấy được dữ liệu ${symbol}`}
        note="Binance không phản hồi hoặc ký hiệu không tồn tại. Kiểm tra /system."
        meta={meta}
      />
    );

  const t = data.ticker;
  const tech = data.technical;
  const digits = priceDigits(t.price);
  const fundingTone = data.funding
    ? data.funding.fundingRate > 0.0005
      ? "up"
      : data.funding.fundingRate < -0.0005
        ? "down"
        : "neutral"
    : "neutral";

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.baseAsset}/USDT</h1>
              <Badge tone="accent">{data.symbol}</Badge>
              <Badge tone="neutral">Binance Spot</Badge>
              <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
              <AddToWatchlist assetType="crypto" symbol={data.symbol} />
            </div>
            <div className="num mt-1 flex items-baseline gap-3">
              <span className="text-[28px] font-semibold">{fmtNum(t.price, digits)}</span>
              <Chg value={t.changePercent} className="text-[14px]" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <HeadStat label="Cao 24h" value={fmtNum(t.high24h ?? t.price, digits)} />
            <HeadStat label="Thấp 24h" value={fmtNum(t.low24h ?? t.price, digits)} />
            <HeadStat label="Vol 24h" value={`$${fmtCompact(t.quoteVolume)}`} />
            <HeadStat label="Giao dịch" value={fmtCompact(t.trades ?? 0)} />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2">
          <div className="seg">
            {INTERVALS.map((x) => (
              <button key={x} type="button" data-active={interval === x} onClick={() => setInterval(x)}>
                {x}
              </button>
            ))}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12">
          <OrcaChart
            symbol={data.symbol}
            assetType="crypto"
            defaultTimeframe={interval}
            height={440}
            title={`${data.baseAsset}/USDT`}
          />
        </div>

        <div className="col-span-12 space-y-3 xl:col-span-4">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Fuel className="size-4 text-accent" /> Futures context
              </span>
            }
          >
            {data.fundingStatus === "ok" && data.funding ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Funding rate</span>
                  <Badge tone={fundingTone as "up" | "down" | "neutral"}>
                    {(data.funding.fundingRate * 100).toFixed(4)}%
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Open interest</span>
                  <span className="num text-[14px]">
                    {data.openInterest ? fmtCompact(data.openInterest.openInterest) : "—"}
                  </span>
                </div>
                <p className="pt-1 text-[11px] leading-relaxed text-ink-3">
                  Funding dương cao = phe Long đang trả phí cho Short (định giá đòn bẩy nóng); funding âm sâu thường đi kèm
                  kỳ vọng hồi.
                </p>
              </div>
            ) : (
              <Unavailable
                title="Dữ liệu futures tạm giới hạn"
                note="Binance futures (fapi) chặn theo vùng địa lý tại máy chủ hiện tại. Spot & kỹ thuật vẫn cập nhật bình thường."
              />
            )}
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Flame className="size-4 text-accent" /> Đọc nhanh
              </span>
            }
          >
            <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink-2">
              <li>
                Vol 24h quy đổi đạt <b className="num">${fmtCompact(t.quoteVolume)}</b> —{" "}
                {(t.quoteVolume ?? 0) > 1e9
                  ? "thanh khoản rất dày"
                  : (t.quoteVolume ?? 0) > 1e8
                    ? "thanh khoản tốt"
                    : "thanh khoản trung bình"}
                .
              </li>
              {tech?.rsi14 != null && (
                <li>
                  RSI(14) ở <b className="num">{tech.rsi14.toFixed(0)}</b> —{" "}
                  {tech.rsi14 >= 70 ? "vùng quá mua" : tech.rsi14 <= 30 ? "vùng quá bán" : "vùng trung tính"}.
                </li>
              )}
              {tech && (
                <li>
                  Giá đang {t.price >= (tech.sma.sma50 ?? 0) ? "trên" : "dưới"} SMA50,{" "}
                  {t.price >= (tech.sma.sma200 ?? 0) ? "trên" : "dưới"} SMA200.
                </li>
              )}
              {data.patterns.length > 0 && <li>Mô hình nến: {data.patterns.map((p) => p.nameVi).join(", ")}.</li>}
              <li className="text-ink-3">Phân tích thuần định lượng từ dữ liệu Binance — không phải khuyến nghị.</li>
            </ul>
          </Panel>
        </div>

        <div className="col-span-12 xl:col-span-8">
          <CryptoTradeDesk symbol={data.symbol} />
        </div>

        <div className="col-span-12">
          <ScalpPanel symbol={data.symbol} />
        </div>

        <div className="col-span-12">
          <TechnicalPanel tech={tech} patterns={data.patterns} />
        </div>
      </div>
    </div>
  );
}

function HeadStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  );
}
