"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { VN_SECTOR_MAP, sectorOf } from "@/lib/vn/master";
import type { CryptoMarketRow, Quote, IndexQuote } from "@/lib/types";
import { WyckoffScreener } from "@/components/wyckoff-screener";
import { Badge, Chg, fmtCompact, fmtNum, FreshnessDot, Loading, MetaLine, Panel, priceDigits, Unavailable } from "@/components/ui";
import { FlatsIcon, Play } from "@/components/screener-icons";

type CryptoRows = { rows: CryptoMarketRow[] };
type StocksData = { indices: IndexQuote[] | null; quotes: Quote[] | null };

const VN_BOARD = "VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD";

function ScreenerInner() {
  const params = useSearchParams();
  const rawU = params.get("universe");
  const [universe, setUniverse] = useState<"stocks" | "crypto" | "wyckoff">(rawU === "crypto" ? "crypto" : rawU === "wyckoff" ? "wyckoff" : "stocks");
  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FlatsIcon /> Asset Screener
          </h1>
          <p className="mt-1 text-[12px] text-text-muted">
            Ưu tiên thị trường chứng khoán Việt Nam — chạy hoàn toàn trên dữ liệu thật mới nhất, không minh họa bằng dữ liệu giả.
          </p>
          <div className="seg mt-3">
            <button data-active={universe === "stocks"} onClick={() => setUniverse("stocks")}>Cổ phiếu VN ⭐</button>
            <button data-active={universe === "wyckoff"} onClick={() => setUniverse("wyckoff")}>Wyckoff</button>
            <button data-active={universe === "crypto"} onClick={() => setUniverse("crypto")}>Crypto</button>
          </div>
        </div>
      </Panel>
      {universe === "crypto" ? <CryptoScreener /> : universe === "wyckoff" ? <WyckoffScreener defaultSector={params.get("sector")} /> : <VnScreener defaultSector={params.get("sector")} />}
    </div>
  );
}
