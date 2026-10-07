"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { WyckoffScreener } from "@/components/wyckoff-screener";
import { CanslimScreener } from "@/components/canslim-screener";
import { MinerviniScreener } from "@/components/minervini-screener";
import { ElliottScreener } from "@/components/elliott-screener";
import { ValuationScreener } from "@/components/valuation-screener";
import { FundamentalScreener } from "@/components/fundamental-screener";
import { CandlestickScreener } from "@/components/candlestick-screener";
import { DivergenceScreener } from "@/components/divergence-screener";
import { AlphaBetaScreener } from "@/components/alpha-beta-screener";
import { Loading, Panel } from "@/components/ui";
import { FlatsIcon } from "@/components/screener-icons";
import { VnScreener, CryptoScreener } from "./screener-panels";

type Universe =
  | "stocks"
  | "crypto"
  | "wyckoff"
  | "canslim"
  | "minervini"
  | "elliott"
  | "valuation"
  | "fundamental"
  | "candlestick"
  | "divergence"
  | "alpha-beta";

const UNIVERSE_TABS: { id: Universe; label: string }[] = [
  { id: "stocks", label: "Cổ phiếu VN ⭐" },
  { id: "divergence", label: "Phân kỳ" },
  { id: "alpha-beta", label: "Hệ số cổ phiếu" },
  { id: "candlestick", label: "Mẫu nến" },
  { id: "canslim", label: "CANSLIM" },
  { id: "minervini", label: "Minervini" },
  { id: "wyckoff", label: "Wyckoff" },
  { id: "elliott", label: "Sóng Elliott" },
  { id: "valuation", label: "Định giá P" },
  { id: "fundamental", label: "Chỉ số cơ bản" },
  { id: "crypto", label: "Tiền mã hóa" },
];

function parseUniverse(raw: string | null): Universe {
  const allowed = new Set(UNIVERSE_TABS.map((t) => t.id));
  if (raw && allowed.has(raw as Universe)) return raw as Universe;
  return "stocks";
}

function ScreenerInner() {
  const params = useSearchParams();
  const [universe, setUniverse] = useState<Universe>(() => parseUniverse(params.get("universe")));

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FlatsIcon /> Bộ lọc tài sản
          </h1>
          <p className="mt-1 text-[12px] text-text-muted">
            Ưu tiên thị trường chứng khoán Việt Nam — chạy hoàn toàn trên dữ liệu thật mới nhất, không minh họa bằng dữ
            liệu giả.
          </p>
          <div className="seg-scroll mt-3">
            <div className="seg" role="tablist" aria-label="Chọn bộ lọc">
              {UNIVERSE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={universe === tab.id}
                  data-active={universe === tab.id}
                  onClick={() => setUniverse(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1.5 hidden text-[10px] text-text-muted sm:block md:hidden">
            Vuốt ngang để xem thêm bộ lọc (Định giá P, Chỉ số cơ bản…)
          </p>
          <p className="mt-1.5 text-[10px] text-text-muted sm:hidden">← Vuốt ngang để chọn thêm bộ lọc →</p>
        </div>
      </Panel>
      {universe === "crypto" ? (
        <CryptoScreener />
      ) : universe === "alpha-beta" ? (
        <AlphaBetaScreener defaultSector={params.get("sector")} />
      ) : universe === "divergence" ? (
        <DivergenceScreener />
      ) : universe === "candlestick" ? (
        <CandlestickScreener defaultSector={params.get("sector")} />
      ) : universe === "wyckoff" ? (
        <WyckoffScreener defaultSector={params.get("sector")} />
      ) : universe === "canslim" ? (
        <CanslimScreener defaultSector={params.get("sector")} />
      ) : universe === "minervini" ? (
        <MinerviniScreener defaultSector={params.get("sector")} />
      ) : universe === "elliott" ? (
        <ElliottScreener defaultSector={params.get("sector")} />
      ) : universe === "valuation" ? (
        <ValuationScreener defaultSector={params.get("sector")} />
      ) : universe === "fundamental" ? (
        <FundamentalScreener defaultSector={params.get("sector")} />
      ) : (
        <VnScreener defaultSector={params.get("sector")} />
      )}
    </div>
  );
}

export default function ScreenerPage() {
  return (
    <Suspense fallback={<Loading rows={8} />}>
      <ScreenerInner />
    </Suspense>
  );
}
