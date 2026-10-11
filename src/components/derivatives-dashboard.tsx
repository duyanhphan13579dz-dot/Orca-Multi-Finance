"use client";

import { useCallback, useEffect, useState } from "react";
import { clientCacheGet, clientCacheSet } from "@/lib/client-cache";
import { DerivativeScalpPanel } from "@/components/derivatives/derivative-scalp-panel";
import { ContractCalculator } from "@/components/derivatives/contract-calculator";
import { OrcaChart } from "@/components/orca-chart";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Bookmark,
  Calculator,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Flame,
  Globe,
  Info,
  Layers3,
  Maximize2,
  Minimize2,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wheat,
  Zap,
} from "lucide-react";
import type { CommodityFutureItem } from "@/app/api/v1/derivatives/commodities/route";

type Meta = { freshness?: string; partial?: boolean; note?: string; source?: string };

type ContractRow = {
  symbol: string;
  daysToExpiry?: number | null;
  multiplier?: number | null;
  quote?: {
    last?: number | null;
    changePercent?: number | null;
    change?: number | null;
    volume?: number | null;
    openInterest?: number | null;
    reference?: number | null;
    ceiling?: number | null;
    floor?: number | null;
  } | null;
  basis?: { basis?: number | null } | null;
};

type Flow = { symbol: string; kind: string; titleVi?: string; confidence?: number };

type RegimeData = {
  regime: {
    kind: string;
    titleVi: string;
    description: string;
    tone: string;
    confidence: number;
  };
  flowKind: string | null;
  curveShape: string | null;
  frontBasis: number | null;
  frontSymbol: string | null;
};

type CurveData = {
  points: Array<{ symbol: string; last: number | null }>;
  spreads: Array<{ near: string; far: string; spread: number; shape: string }>;
  note: string;
};

type Alert = { id: string; severity: string; titleVi: string; detail: string };

type DerivativeCategory = "vn30" | "commodities" | "bonds";

function fmt(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
  right,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <div className="panel-header flex items-center justify-between">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        {right ?? <Info className="size-4 text-text-muted" aria-label="Thông tin" />}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function DerivativesDashboard() {
  const initialSnap = clientCacheGet<{
    success?: boolean;
    data?: { contracts: ContractRow[]; flow: Flow[]; spot?: { price?: number | null } };
    meta?: Meta;
  }>("/api/v1/derivatives/snapshot?core=1");
  const initialRegime = clientCacheGet<{ success?: boolean; data?: RegimeData }>(
    "/api/v1/derivatives/regime?underlying=VN30",
  );

  // Danh mục tab phái sinh: vn30 (ưu tiên Việt Nam), commodities (hàng hóa quốc tế), bonds (trái phiếu CP)
  const [category, setCategory] = useState<DerivativeCategory>("vn30");

  // State VN30
  const [contracts, setContracts] = useState<ContractRow[]>(initialSnap?.data?.contracts ?? []);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("VN30F1M");
  const [spotPrice, setSpotPrice] = useState<number | null>(initialSnap?.data?.spot?.price ?? null);
  const [flow, setFlow] = useState<Flow[]>(initialSnap?.data?.flow ?? []);
  const [regime, setRegime] = useState<RegimeData | null>(initialRegime?.data ?? null);
  const [curve, setCurve] = useState<CurveData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [meta, setMeta] = useState<Meta | null>(initialSnap?.meta ?? null);
  const [loading, setLoading] = useState(!initialSnap?.data?.contracts?.length);
  const [err, setErr] = useState<string | null>(null);

  // State Hàng hóa Phái sinh Quốc tế
  const [commodities, setCommodities] = useState<CommodityFutureItem[]>([]);
  const [selectedCommoditySymbol, setSelectedCommoditySymbol] = useState<string>("CL=F");
  const [commodityLot, setCommodityLot] = useState<number>(1);

  // State Trái phiếu Chính phủ Việt Nam
  const [selectedBondSymbol, setSelectedBondSymbol] = useState<string>("GB05F1M");

  // State Biểu đồ nến tương tác (Interactive Chart)
  const [isChartExpanded, setIsChartExpanded] = useState<boolean>(true);
  const [chartTf, setChartTf] = useState<string>("5m");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [snapRes, regimeRes, curveRes, alertsRes, commRes] = await Promise.all([
        fetch("/api/v1/derivatives/snapshot?core=1").then((r) => r.json()),
        fetch("/api/v1/derivatives/regime?underlying=VN30").then((r) => r.json()),
        fetch("/api/v1/derivatives/curve?underlying=VN30").then((r) => r.json()),
        fetch("/api/v1/derivatives/alerts?underlying=VN30").then((r) => r.json()),
        fetch("/api/v1/derivatives/commodities").then((r) => r.json()).catch(() => null),
      ]);
      if (snapRes?.success) clientCacheSet("/api/v1/derivatives/snapshot?core=1", snapRes);
      if (regimeRes?.success) clientCacheSet("/api/v1/derivatives/regime?underlying=VN30", regimeRes);
      const rawContracts: ContractRow[] = snapRes?.data?.contracts ?? [];
      setContracts(rawContracts);
      setSpotPrice(snapRes?.data?.spot?.price ?? null);
      setFlow(snapRes?.data?.flow ?? []);
      setMeta(snapRes?.meta ?? null);
      setRegime(regimeRes?.data ?? null);
      setCurve(curveRes?.data ?? null);
      setAlerts(alertsRes?.data?.alerts ?? []);
      if (commRes?.success && Array.isArray(commRes.data)) {
        setCommodities(commRes.data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [snapRes, regimeRes, curveRes, alertsRes, commRes] = await Promise.all([
          fetch("/api/v1/derivatives/snapshot?core=1").then((r) => r.json()),
          fetch("/api/v1/derivatives/regime?underlying=VN30").then((r) => r.json()),
          fetch("/api/v1/derivatives/curve?underlying=VN30").then((r) => r.json()),
          fetch("/api/v1/derivatives/alerts?underlying=VN30").then((r) => r.json()),
          fetch("/api/v1/derivatives/commodities").then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (snapRes?.success) clientCacheSet("/api/v1/derivatives/snapshot?core=1", snapRes);
        if (regimeRes?.success) clientCacheSet("/api/v1/derivatives/regime?underlying=VN30", regimeRes);
        const rawContracts: ContractRow[] = snapRes?.data?.contracts ?? [];
        setContracts(rawContracts);
        setSpotPrice(snapRes?.data?.spot?.price ?? null);
        setFlow(snapRes?.data?.flow ?? []);
        setMeta(snapRes?.meta ?? null);
        setRegime(regimeRes?.data ?? null);
        setCurve(curveRes?.data ?? null);
        setAlerts(alertsRes?.data?.alerts ?? []);
        if (commRes?.success && Array.isArray(commRes.data)) {
          setCommodities(commRes.data);
        }
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const id = setInterval(() => void run(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tone =
    regime?.regime.tone === "positive"
      ? "text-emerald-400"
      : regime?.regime.tone === "negative"
        ? "text-rose-400"
        : regime?.regime.tone === "warning"
          ? "text-amber-400"
          : "text-text-muted";

  const selectedContract =
    contracts.find((c) => c.symbol === selectedSymbol) ?? contracts[0] ?? null;

  const selectedCommodity =
    commodities.find((c) => c.symbol === selectedCommoditySymbol) ?? commodities[0] ?? null;

  // Cấu hình Biểu đồ nến theo Category hiện tại
  const activeChartSymbol =
    category === "vn30"
      ? selectedContract?.symbol ?? selectedSymbol
      : category === "commodities"
        ? selectedCommodity?.chartSymbol ?? selectedCommoditySymbol
        : selectedBondSymbol;

  const activeAssetType = category === "commodities" ? "commodity" : "stock";

  const chartTitle =
    category === "vn30"
      ? `${activeChartSymbol} · HĐTL VN30 (HNX / VSDC)`
      : category === "commodities"
        ? `${selectedCommodity?.nameVi ?? activeChartSymbol} (${selectedCommodity?.exchange ?? "CME/ICE"})`
        : `${activeChartSymbol} · Trái phiếu Chính phủ Việt Nam`;

  const extraLevels =
    category === "vn30" && spotPrice != null
      ? [
          {
            label: `VN30 Cơ sở: ${fmt(spotPrice, 1)}`,
            price: spotPrice,
            color: "#38bdf8",
          },
          ...(selectedContract?.quote?.reference
            ? [
                {
                  label: `Tham chiếu: ${fmt(selectedContract.quote.reference, 1)}`,
                  price: selectedContract.quote.reference,
                  color: "#eab308",
                },
              ]
            : []),
        ]
      : [];

  return (
    <div className="space-y-4">
      {/* 1. Header Trang Phái sinh */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              Trung tâm Phái sinh & Scalping
            </h1>
            <span className="rounded-full bg-accent-primary/15 px-2.5 py-0.5 text-[10px] font-bold text-accent-primary">
              Pro Derivatives
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Biểu đồ nến trực quan đa khung thời gian · Scalping định lượng · HĐTL Chỉ số VN30 · Hàng hóa Quốc tế · Trái phiếu Chính phủ
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-border-default hover:text-text-primary transition-colors"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Làm mới dữ liệu
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {err}
        </div>
      )}

      {/* 2. THANH CHUYỂN CATEGORY: Ưu tiên số 1 cho Phái sinh Việt Nam */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-base/80 p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCategory("vn30");
              setChartTf("5m");
            }}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              category === "vn30"
                ? "bg-accent-primary text-black shadow-md font-extrabold ring-1 ring-accent-primary/50"
                : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
            }`}
          >
            <span>🇻🇳 HĐTL Chỉ số VN30</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                category === "vn30"
                  ? "bg-black/20 text-black font-semibold"
                  : "bg-accent-primary/20 text-accent-primary font-semibold"
              }`}
            >
              Ưu tiên & Scalping
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCategory("commodities");
              setChartTf("15m");
            }}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              category === "commodities"
                ? "bg-accent-primary text-black shadow-md font-extrabold ring-1 ring-accent-primary/50"
                : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
            }`}
          >
            <Globe className="size-3.5" />
            <span>🌍 Hàng hóa Phái sinh Quốc tế</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                category === "commodities"
                  ? "bg-black/20 text-black font-semibold"
                  : "bg-surface-base text-text-muted font-medium"
              }`}
            >
              CME · ICE · MXV
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCategory("bonds");
              setChartTf("1D");
            }}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              category === "bonds"
                ? "bg-accent-primary text-black shadow-md font-extrabold ring-1 ring-accent-primary/50"
                : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
            }`}
          >
            <Scale className="size-3.5" />
            <span>🇻🇳 HĐTL Trái phiếu Chính phủ</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                category === "bonds"
                  ? "bg-black/20 text-black font-semibold"
                  : "bg-surface-base text-text-muted font-medium"
              }`}
            >
              HNX · 5Y & 10Y
            </span>
          </button>
        </div>

        {/* Thông tin nhanh của nhóm đang chọn */}
        <div className="flex items-center gap-2 px-2 text-xs text-text-muted">
          {category === "vn30" && spotPrice != null && (
            <div className="flex items-center gap-1.5">
              <span>VN30 Spot:</span>
              <span className="font-bold text-accent-primary num">{fmt(spotPrice, 1)}</span>
            </div>
          )}
          {category === "commodities" && (
            <div className="flex items-center gap-1.5">
              <span>Liên thông:</span>
              <span className="font-semibold text-text-primary">Sở Giao dịch Hàng hóa VN (MXV)</span>
            </div>
          )}
          {category === "bonds" && (
            <div className="flex items-center gap-1.5">
              <span>Quy mô HĐ:</span>
              <span className="font-semibold text-text-primary">1 tỷ VNĐ / Hợp đồng</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. BỘ CHỌN HỢP ĐỒNG (SUB-SELECTOR THEO TỪNG DANH MỤC) */}
      {category === "vn30" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-base p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted px-1.5 uppercase tracking-wider">
              Chọn HĐTL VN30:
            </span>
            {(contracts.length > 0
              ? contracts
              : [
                  { symbol: "VN30F1M", daysToExpiry: 12 },
                  { symbol: "VN30F2M", daysToExpiry: 40 },
                  { symbol: "VN30F1Q", daysToExpiry: 72 },
                  { symbol: "VN30F2Q", daysToExpiry: 160 },
                ]
            ).map((c) => {
              const isSelected = (selectedContract?.symbol ?? selectedSymbol) === c.symbol;
              return (
                <button
                  key={c.symbol}
                  type="button"
                  onClick={() => setSelectedSymbol(c.symbol)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? "bg-accent-primary text-black shadow-sm font-bold"
                      : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                  }`}
                >
                  <span>{c.symbol}</span>
                  {c.quote?.last != null && (
                    <span className={`num text-[11px] ${isSelected ? "text-black/85" : "text-text-primary"}`}>
                      {c.quote.last.toFixed(1)}
                    </span>
                  )}
                  {c.daysToExpiry != null && (
                    <span className={`text-[10px] ${isSelected ? "text-black/70" : "text-text-muted"}`}>
                      ({c.daysToExpiry}d)
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedContract && (
            <div className="flex items-center gap-3 pr-2 text-xs">
              <span className="text-text-muted">Ký quỹ ban đầu:</span>
              <span className="num font-semibold text-accent-primary">
                ~{(
                  ((selectedContract.quote?.last ?? 1300) * (selectedContract.multiplier ?? 100_000) * 0.17) /
                  1_000_000
                ).toFixed(1)}{" "}
                triệu/HĐ
              </span>
            </div>
          )}
        </div>
      )}

      {category === "commodities" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-base p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted px-1.5 uppercase tracking-wider">
              Chọn Hàng hóa:
            </span>
            {commodities.map((item) => {
              const isSelected = selectedCommoditySymbol === item.symbol;
              const up = (item.changePercent ?? 0) >= 0;
              return (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() => setSelectedCommoditySymbol(item.symbol)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? "bg-accent-primary text-black shadow-sm font-bold"
                      : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                  }`}
                >
                  <span>{item.nameVi.split("(")[0].trim()}</span>
                  {item.price != null && (
                    <span className={`num text-[11px] ${isSelected ? "text-black/90 font-bold" : "text-text-primary"}`}>
                      {fmt(item.price, item.price > 100 ? 1 : 2)}
                    </span>
                  )}
                  {item.changePercent != null && (
                    <span
                      className={`text-[10px] ${
                        isSelected
                          ? "text-black/75"
                          : up
                            ? "text-emerald-400"
                            : "text-rose-400"
                      }`}
                    >
                      {up ? "+" : ""}{item.changePercent.toFixed(1)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {selectedCommodity && (
            <div className="flex items-center gap-2 pr-2 text-xs">
              <span className="text-text-muted">Ký quỹ ước tính:</span>
              <span className="num font-semibold text-accent-primary">
                {selectedCommodity.marginUsd} ({selectedCommodity.marginVndEstimate})
              </span>
            </div>
          )}
        </div>
      )}

      {category === "bonds" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-base p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-text-muted px-1.5 uppercase tracking-wider">
              Kỳ hạn Trái phiếu:
            </span>
            <button
              type="button"
              onClick={() => setSelectedBondSymbol("GB05F1M")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                selectedBondSymbol === "GB05F1M"
                  ? "bg-accent-primary text-black font-bold shadow-sm"
                  : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated"
              }`}
            >
              GB05F1M (HĐTL TPCP 5 năm)
            </button>
            <button
              type="button"
              onClick={() => setSelectedBondSymbol("GB10F1M")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                selectedBondSymbol === "GB10F1M"
                  ? "bg-accent-primary text-black font-bold shadow-sm"
                  : "border border-border-subtle bg-surface-elevated/70 text-text-secondary hover:bg-surface-elevated"
              }`}
            >
              GB10F1M (HĐTL TPCP 10 năm)
            </button>
          </div>
          <div className="text-xs text-text-muted pr-2">
            Biên độ dao động giá: <b className="text-text-primary">±3%</b> · Tỷ lệ ký quỹ: <b className="text-accent-primary">2.5%</b>
          </div>
        </div>
      )}

      {/* 4. BIỂU ĐỒ NẾN PHÁI SINH TRỰC QUAN (INTERACTIVE CANDLESTICK CHART) */}
      <Panel
        title={`Biểu đồ Phái sinh trực quan · ${chartTitle}`}
        subtitle="Nến OHLCV đa khung thời gian · Chỉ báo EMA, Bollinger, VWAP, RSI, MACD · Tích hợp vạch giá cơ sở & tham chiếu"
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-base p-1 text-xs">
              {(category === "commodities" ? ["5m", "15m", "1h", "1D"] : ["1m", "5m", "15m", "1D"]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setChartTf(tf)}
                  className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${
                    chartTf === tf
                      ? "bg-accent-primary text-black"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsChartExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-base px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
              title={isChartExpanded ? "Thu gọn biểu đồ" : "Mở rộng biểu đồ"}
            >
              {isChartExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              <span>{isChartExpanded ? "440px" : "320px"}</span>
            </button>
          </div>
        }
      >
        <div className="pt-1">
          <OrcaChart
            key={`${activeChartSymbol}-${activeAssetType}-${chartTf}`}
            symbol={activeChartSymbol}
            assetType={activeAssetType}
            defaultTimeframe={chartTf}
            height={isChartExpanded ? 440 : 320}
            title={chartTitle}
            extraLevels={extraLevels}
          />
        </div>
      </Panel>

      {/* 5. NỘI DUNG CHI TIẾT THEO TỪNG CATEGORY */}

      {/* TH 1: HĐTL CHỈ SỐ VN30 (ƯU TIÊN HÀNG ĐẦU) */}
      {category === "vn30" && (
        <>
          {/* Không gian làm việc Scalping & Chi tiết Hợp đồng */}
          <div className="grid gap-4 lg:grid-cols-12 items-start">
            {/* Cột trái: Scalping Intelligence Panel chuyên sâu cho HĐTL (7/12 cols) */}
            <div className="lg:col-span-7 h-full">
              <DerivativeScalpPanel symbol={selectedContract?.symbol ?? selectedSymbol} />
            </div>

            {/* Cột phải: Máy tính Ký quỹ & Vị thế HĐTL (5/12 cols) */}
            <div className="lg:col-span-5 h-full">
              <ContractCalculator
                symbol={selectedContract?.symbol ?? selectedSymbol}
                currentPrice={selectedContract?.quote?.last ?? 1300.0}
                multiplier={selectedContract?.multiplier ?? 100_000}
              />
            </div>
          </div>

          {/* Tổng quan Regime & Cảnh báo toàn thị trường */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Chế độ thị trường (Regime)" subtitle={regime?.regime.titleVi ?? "—"} className="lg:col-span-1">
              <div className={`text-xl font-bold ${tone}`}>{regime?.regime.kind ?? "insufficient"}</div>
              <p className="mt-1 text-xs text-text-muted leading-relaxed">
                {regime?.regime.description ?? "Chưa đủ dữ liệu tổng quan"}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary border-t border-border-subtle pt-2">
                <div>Front: <b className="text-text-primary">{regime?.frontSymbol ?? "VN30F1M"}</b></div>
                <div>Basis: <b className="text-text-primary">{regime?.frontBasis != null ? fmt(regime.frontBasis, 1) : "—"}</b></div>
                <div>Curve: <b className="text-text-primary">{regime?.curveShape ?? "Normal"}</b></div>
                <div>Flow: <b className="text-text-primary capitalize">{regime?.flowKind?.replace(/_/g, " ") ?? "Neutral"}</b></div>
              </div>
            </Panel>

            <Panel title="Cảnh báo Phái sinh (Alerts)" subtitle="Basis · Dòng tiền · Ngưỡng rủi ro" className="lg:col-span-2">
              {alerts.length === 0 ? (
                <p className="text-xs text-text-muted py-2">
                  Chưa phát hiện cảnh báo rủi ro bất thường trên các hợp đồng tương lai VN30.
                </p>
              ) : (
                <ul className="space-y-2">
                  {alerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-base p-2 text-xs">
                      <ShieldAlert
                        className={`mt-0.5 size-4 shrink-0 ${
                          a.severity === "critical"
                            ? "text-rose-400"
                            : a.severity === "warning"
                              ? "text-amber-400"
                              : "text-sky-400"
                        }`}
                      />
                      <div>
                        <div className="font-semibold text-text-primary">{a.titleVi}</div>
                        <div className="text-text-muted text-[11px]">{a.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Bảng tổng hợp tất cả Hợp đồng VN30 (Nhấp vào dòng để chuyển hợp đồng & biểu đồ) */}
          <Panel
            title="Bảng giá Hợp đồng tương lai VN30"
            subtitle="Nhấp vào từng dòng để mở biểu đồ nến & scalping cho hợp đồng đó"
          >
            <div className="table-scroll-wrap">
              <table className="w-full min-w-[580px] text-xs">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border-subtle">
                    <th className="py-2.5 pr-2">Hợp đồng</th>
                    <th className="py-2.5 pr-2">Giá khớp</th>
                    <th className="py-2.5 pr-2">Thay đổi</th>
                    <th className="py-2.5 pr-2">Basis</th>
                    <th className="py-2.5 pr-2">Khối lượng (Vol)</th>
                    <th className="py-2.5 pr-2">Vị thế mở (OI)</th>
                    <th className="py-2.5 pr-2">Đáo hạn</th>
                    <th className="py-2.5 text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-text-muted">
                        {loading ? "Đang tải dữ liệu hợp đồng tương lai…" : "Chưa có dữ liệu hợp đồng"}
                      </td>
                    </tr>
                  )}
                  {contracts.map((c) => {
                    const chg = c.quote?.changePercent;
                    const up = chg != null && chg >= 0;
                    const isSelected = (selectedContract?.symbol ?? selectedSymbol) === c.symbol;
                    return (
                      <tr
                        key={c.symbol}
                        onClick={() => setSelectedSymbol(c.symbol)}
                        className={`border-b border-border-subtle/50 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-accent-primary/10 font-medium"
                            : "hover:bg-surface-elevated/70"
                        }`}
                      >
                        <td className="py-2.5 pr-2 font-bold flex items-center gap-1.5">
                          <span className="text-text-primary">{c.symbol}</span>
                          {isSelected && (
                            <span className="rounded bg-accent-primary/20 text-accent-primary text-[10px] px-1.5 py-0.2">
                              Đang xem
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-2 font-semibold num text-text-primary">
                          {fmt(c.quote?.last ?? null, 1)}
                        </td>
                        <td className="py-2.5 pr-2 num">
                          <span
                            className={`inline-flex items-center gap-0.5 ${
                              chg == null
                                ? "text-text-muted"
                                : up
                                  ? "text-emerald-400 font-semibold"
                                  : "text-rose-400 font-semibold"
                            }`}
                          >
                            {chg != null && (up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}
                            {chg == null ? "—" : `${up ? "+" : ""}${chg.toFixed(2)}%`}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 num">
                          <span
                            className={
                              c.basis?.basis == null
                                ? "text-text-muted"
                                : c.basis.basis > 4
                                  ? "text-amber-400 font-medium"
                                  : c.basis.basis < -4
                                    ? "text-sky-400 font-medium"
                                    : "text-text-primary"
                            }
                          >
                            {c.basis?.basis != null ? `${c.basis.basis >= 0 ? "+" : ""}${fmt(c.basis.basis, 1)}` : "—"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 num text-text-secondary">
                          {c.quote?.volume != null ? c.quote.volume.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="py-2.5 pr-2 num text-text-secondary">
                          {c.quote?.openInterest != null ? c.quote.openInterest.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="py-2.5 text-text-muted">
                          {c.daysToExpiry != null ? `${c.daysToExpiry} ngày` : "—"}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSymbol(c.symbol);
                            }}
                            className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-primary hover:text-accent-primary transition-colors"
                          >
                            Xem Biểu đồ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Term Structure & Flow Engine */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Cấu trúc kỳ hạn (Term Structure)" subtitle={curve?.note ?? "Đường cong giá HĐTL"}>
              <div className="flex flex-wrap gap-2.5">
                {(curve?.points ?? []).map((p) => (
                  <div
                    key={p.symbol}
                    className="rounded-lg border border-border-subtle bg-surface-base px-3 py-2 text-center min-w-[5.5rem]"
                  >
                    <div className="text-[11px] font-medium text-text-muted">{p.symbol}</div>
                    <div className="text-base font-bold text-text-primary num mt-0.5">{fmt(p.last, 1)}</div>
                  </div>
                ))}
                {(curve?.points?.length ?? 0) === 0 && (
                  <p className="text-xs text-text-muted py-2">Đường cong kỳ hạn đang cập nhật dữ liệu phiên.</p>
                )}
              </div>
              {(curve?.spreads?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-text-muted border-t border-border-subtle pt-2">
                  {curve!.spreads.map((s) => (
                    <li key={`${s.near}-${s.far}`} className="flex justify-between">
                      <span>Chênh lệch {s.near} − {s.far}:</span>
                      <b className="num text-text-primary">{s.spread} điểm ({s.shape})</b>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Dòng tiền & Vị thế mở (Flow Engine)" subtitle="Tương quan biến động Giá và Open Interest (OI)">
              {flow.length === 0 ? (
                <p className="text-xs text-text-muted py-2">
                  Chưa đủ mẫu đo ΔOI để vẽ tín hiệu dòng tiền phiên.
                </p>
              ) : (
                <ul className="space-y-2">
                  {flow.map((f) => (
                    <li
                      key={f.symbol}
                      className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-base px-3 py-2 text-xs"
                    >
                      <span className="inline-flex items-center gap-2">
                        <TrendingUp className="size-4 text-accent-primary" />
                        <span className="font-bold text-text-primary">{f.symbol}</span>
                        <span className="text-text-muted capitalize">
                          {f.titleVi ?? f.kind.replace(/_/g, " ")}
                        </span>
                      </span>
                      <span className="text-xs font-semibold num text-accent-primary">
                        {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* TH 2: HÀNG HÓA PHÁI SINH QUỐC TẾ (CME / ICE / MXV) */}
      {category === "commodities" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-12 items-start">
            {/* Thông số hợp đồng hàng hóa đang chọn */}
            <div className="lg:col-span-7 h-full">
              <Panel
                title={`Đặc tả Hợp đồng · ${selectedCommodity?.nameVi ?? "Hàng hóa"}`}
                subtitle="Quy cách niêm yết chuẩn quốc tế liên thông Sở Giao dịch Hàng hóa Việt Nam (MXV)"
              >
                {selectedCommodity ? (
                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5">
                        <div className="text-[11px] text-text-muted">Mã hợp đồng</div>
                        <div className="font-bold text-text-primary text-sm mt-0.5">{selectedCommodity.symbol}</div>
                        <div className="text-[10px] text-accent-primary">Sàn {selectedCommodity.exchange}</div>
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5">
                        <div className="text-[11px] text-text-muted">Giá khớp hiện tại</div>
                        <div className="font-bold text-text-primary text-sm mt-0.5 num">
                          {selectedCommodity.price != null ? fmt(selectedCommodity.price, 2) : "—"}
                        </div>
                        <div
                          className={`text-[10px] font-semibold ${
                            (selectedCommodity.changePercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {(selectedCommodity.changePercent ?? 0) >= 0 ? "+" : ""}
                          {selectedCommodity.changePercent?.toFixed(2)}%
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5">
                        <div className="text-[11px] text-text-muted">Quy mô Hợp đồng</div>
                        <div className="font-semibold text-text-primary mt-0.5">{selectedCommodity.contractSize}</div>
                        <div className="text-[10px] text-text-muted">Đơn vị: {selectedCommodity.unit}</div>
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5">
                        <div className="text-[11px] text-text-muted">Bước giá tối thiểu</div>
                        <div className="font-semibold text-text-primary mt-0.5">{selectedCommodity.tickSize}</div>
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5">
                        <div className="text-[11px] text-text-muted">Ký quỹ ban đầu (USD)</div>
                        <div className="font-bold text-accent-primary mt-0.5">{selectedCommodity.marginUsd}</div>
                      </div>
                      <div className="rounded-lg border border-border-subtle bg-surface-base p-2.5">
                        <div className="text-[11px] text-text-muted">Ký quỹ ước tính (VND)</div>
                        <div className="font-bold text-emerald-400 mt-0.5">{selectedCommodity.marginVndEstimate}</div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border-subtle bg-surface-base/60 p-3 leading-relaxed text-text-secondary">
                      <div className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
                        <Sparkles className="size-3.5 text-accent-primary" />
                        Cơ chế giao dịch Hàng hóa Phái sinh tại Việt Nam:
                      </div>
                      Giao dịch hợp pháp thông qua <b>Sở Giao dịch Hàng hóa Việt Nam (MXV)</b> được Bộ Công Thương cấp phép.
                      Không chịu thuế chuyển nhượng trên từng giao dịch, thanh toán T+0 hai chiều (Long/Short) 24/5 liên thông trực tiếp sàn CME Group (NYMEX, COMEX, CBOT) và ICE châu Âu.
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted py-2">Đang tải thông số hợp đồng hàng hóa…</p>
                )}
              </Panel>
            </div>

            {/* Máy tính Ký quỹ Hàng hóa Phái sinh */}
            <div className="lg:col-span-5 h-full">
              <Panel
                title="Máy tính Vị thế Hàng hóa"
                subtitle="Quy đổi Ký quỹ & Giá trị Hợp đồng sang VNĐ"
                right={<Calculator className="size-4 text-accent-primary" />}
              >
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[11px] text-text-muted mb-1">Số lượng hợp đồng (Lots):</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCommodityLot((p) => Math.max(1, p - 1))}
                        className="rounded border border-border-subtle bg-surface-base px-2.5 py-1 text-sm font-bold hover:bg-surface-elevated"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={commodityLot}
                        onChange={(e) => setCommodityLot(Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 rounded border border-border-subtle bg-surface-base px-2.5 py-1 text-center font-bold text-text-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setCommodityLot((p) => p + 1)}
                        className="rounded border border-border-subtle bg-surface-base px-2.5 py-1 text-sm font-bold hover:bg-surface-elevated"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {selectedCommodity && (
                    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-base p-3">
                      <div className="flex justify-between">
                        <span className="text-text-muted">Tổng vốn ký quỹ yêu cầu (USD):</span>
                        <b className="text-accent-primary num">
                          ~{(
                            parseFloat(selectedCommodity.marginUsd.replace(/[^0-9.]/g, "") || "5000") * commodityLot
                          ).toLocaleString("en-US")}{" "}
                          USD
                        </b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-muted">Tổng vốn ký quỹ quy đổi (VNĐ):</span>
                        <b className="text-emerald-400 num">
                          ~{(
                            (parseFloat(selectedCommodity.marginUsd.replace(/[^0-9.]/g, "") || "5000") *
                              commodityLot *
                              25450) /
                            1_000_000
                          ).toFixed(1)}{" "}
                          triệu VNĐ
                        </b>
                      </div>
                      <div className="flex justify-between border-t border-border-subtle pt-2">
                        <span className="text-text-muted">Tỷ giá tham chiếu:</span>
                        <span className="text-text-primary">25,450 VND / USD</span>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          </div>

          {/* Bảng giá đầy đủ 9 Hợp đồng tương lai Hàng hóa Quốc tế */}
          <Panel
            title="Bảng giá Hàng hóa Phái sinh Quốc tế (MXV / CME / ICE)"
            subtitle="Nhấp vào từng dòng để mở biểu đồ nến & thông số hợp đồng tương ứng"
          >
            <div className="table-scroll-wrap">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border-subtle">
                    <th className="py-2.5 pr-2">Mã & Hàng hóa</th>
                    <th className="py-2.5 pr-2">Nhóm</th>
                    <th className="py-2.5 pr-2">Sàn</th>
                    <th className="py-2.5 pr-2">Giá khớp</th>
                    <th className="py-2.5 pr-2">Thay đổi</th>
                    <th className="py-2.5 pr-2">Quy cách HĐ</th>
                    <th className="py-2.5 pr-2">Ký quỹ (USD)</th>
                    <th className="py-2.5 text-right">Xem Biểu đồ</th>
                  </tr>
                </thead>
                <tbody>
                  {commodities.map((item) => {
                    const isSelected = selectedCommoditySymbol === item.symbol;
                    const up = (item.changePercent ?? 0) >= 0;
                    return (
                      <tr
                        key={item.symbol}
                        onClick={() => setSelectedCommoditySymbol(item.symbol)}
                        className={`border-b border-border-subtle/50 cursor-pointer transition-colors ${
                          isSelected ? "bg-accent-primary/10 font-medium" : "hover:bg-surface-elevated/70"
                        }`}
                      >
                        <td className="py-2.5 pr-2">
                          <div className="font-bold text-text-primary">{item.symbol}</div>
                          <div className="text-[11px] text-text-muted">{item.nameVi}</div>
                        </td>
                        <td className="py-2.5 pr-2">
                          <span className="rounded bg-surface-elevated px-2 py-0.5 text-[10px] text-text-secondary font-medium">
                            {item.groupVi}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 font-semibold text-text-primary">{item.exchange}</td>
                        <td className="py-2.5 pr-2 font-bold num text-text-primary">
                          {item.price != null ? fmt(item.price, item.price > 100 ? 1 : 2) : "—"}
                        </td>
                        <td className="py-2.5 pr-2 num">
                          <span
                            className={`inline-flex items-center gap-0.5 ${
                              up ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"
                            }`}
                          >
                            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                            {up ? "+" : ""}
                            {item.changePercent != null ? `${item.changePercent.toFixed(2)}%` : "—"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-2 text-text-secondary">{item.contractSize}</td>
                        <td className="py-2.5 pr-2 font-semibold text-accent-primary num">{item.marginUsd}</td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCommoditySymbol(item.symbol);
                            }}
                            className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent-primary hover:text-accent-primary transition-colors"
                          >
                            Chọn Nến
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* TH 3: HĐTL TRÁI PHIẾU CHÍNH PHỦ VIỆT NAM (HNX / VSDC) */}
      {category === "bonds" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Đặc tả HĐTL Trái phiếu Chính phủ 5 Năm (GB05F)"
              subtitle="Quy chuẩn niêm yết HNX & Trung tâm Lưu ký VSDC"
            >
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Tài sản cơ sở:</span>
                  <b className="text-text-primary">Trái phiếu Chính phủ kỳ hạn 5 năm chuẩn</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Quy mô hợp đồng:</span>
                  <b className="text-text-primary">1,000,000,000 VNĐ (1 tỷ đồng)</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Mệnh giá TPCP cơ sở:</span>
                  <b className="text-text-primary">100,000 VNĐ</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Lãi suất danh nghĩa coupon:</span>
                  <b className="text-accent-primary">5.0% / năm (trả lãi định kỳ hàng năm)</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Biên độ dao động giá:</span>
                  <b className="text-text-primary">±3% so với giá tham chiếu</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Tỷ lệ ký quỹ ban đầu (IM):</span>
                  <b className="text-emerald-400">~2.5% (~25 triệu VNĐ / HĐ)</b>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">Phương thức thanh toán:</span>
                  <b className="text-text-primary">Chuyển giao vật chất (Physical Delivery) / Bù trừ</b>
                </div>
              </div>
            </Panel>

            <Panel
              title="Đặc tả HĐTL Trái phiếu Chính phủ 10 Năm (GB10F)"
              subtitle="Công cụ phòng ngừa rủi ro lãi suất dài hạn cho Định chế Tài chính"
            >
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Tài sản cơ sở:</span>
                  <b className="text-text-primary">Trái phiếu Chính phủ kỳ hạn 10 năm chuẩn</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Quy mô hợp đồng:</span>
                  <b className="text-text-primary">1,000,000,000 VNĐ (1 tỷ đồng)</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Mệnh giá TPCP cơ sở:</span>
                  <b className="text-text-primary">100,000 VNĐ</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Lãi suất danh nghĩa coupon:</span>
                  <b className="text-accent-primary">5.0% / năm</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Biên độ dao động giá:</span>
                  <b className="text-text-primary">±3%</b>
                </div>
                <div className="flex justify-between py-1 border-b border-border-subtle">
                  <span className="text-text-muted">Tỷ lệ ký quỹ ban đầu (IM):</span>
                  <b className="text-emerald-400">~2.5% (~25 triệu VNĐ / HĐ)</b>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">Đối tượng tham gia chính:</span>
                  <b className="text-text-primary">Ngân hàng Thương mại, Quỹ Đầu tư, Bảo hiểm</b>
                </div>
              </div>
            </Panel>
          </div>

          <Panel
            title="Ý nghĩa & Chiến lược Giao dịch HĐTL Trái phiếu Chính phủ"
            subtitle="Cơ chế bảo vệ danh mục trái phiếu và dự báo đường cong lợi suất (Yield Curve)"
          >
            <div className="grid gap-3 sm:grid-cols-3 text-xs leading-relaxed text-text-secondary">
              <div className="rounded-lg border border-border-subtle bg-surface-base p-3">
                <div className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-accent-primary" />
                  Hedging Lãi suất
                </div>
                Khi lãi suất thị trường có xu hướng tăng, giá trái phiếu giảm. Các tổ chức nắm giữ danh mục TPCP có thể Short HĐTL để bù đắp thâm hụt giá trị danh mục cơ sở.
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-base p-3">
                <div className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
                  <TrendingUp className="size-3.5 text-emerald-400" />
                  Định giá Đường cong
                </div>
                Chênh lệch giá giữa GB05F (5 năm) và GB10F (10 năm) phản ánh kỳ vọng của thị trường về độ dốc đường cong lãi suất (Steepening / Flattening) của nền kinh tế Việt Nam.
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-base p-3">
                <div className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
                  <Scale className="size-3.5 text-sky-400" />
                  Đòn bẩy Vốn An toàn
                </div>
                Với tỷ lệ ký quỹ chỉ 2.5%, nhà đầu tư tổ chức có thể giao dịch vị thế TPCP tương đương 40 lần quy mô vốn ký quỹ ban đầu mà không phải huy động tiền mặt ngay.
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Footer Ghi chú */}
      <p className="text-xs text-text-muted flex items-center gap-1.5 pt-2">
        <Layers3 className="size-3.5" />
        Hệ thống Phái sinh Toàn diện ORCA · Nguồn chuẩn VSDC / HNX & Liên thông Hàng hóa Quốc tế MXV / CME Group ·
        Không bịa số liệu · Tích hợp Biểu đồ nến & Scalping định lượng
      </p>
    </div>
  );
}
