"use client";

import { useEffect, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { PriceAlertMonitorHost } from "@/components/price-alert-monitor-host";
import { PatternAlertMonitorHost } from "@/components/pattern-alert-monitor-host";
import { ErrorBoundary } from "@/components/error-boundary";
import { prefetchMarketSnapshot } from "@/components/ticker-tape";
import { prefetchApi } from "@/lib/hooks";

const globalSwrCache = new Map();

/**
 * Ưu tiên kéo dữ liệu toàn hệ thống theo thứ tự:
 * 1. Khi mở web (t = 0s -> 2s): Ưu tiên tuyệt đối trang tổng quan (VN30, market snapshot, intel, global).
 *    Toàn bộ tài nguyên mạng & CPU tập trung phục vụ Dashboard xuất hiện tức thì và mượt mà nhất.
 * 2. Trong 20s tiếp theo (t = 2.5s -> 22s): Kéo dần dần, lần lượt dữ liệu cho tất cả các trang còn lại.
 *    Dữ liệu gọi về 1 hub tổng nên được xếp hàng (pipeline) giãn cách đều đặn để tránh nghẽn băng thông,
 *    đồng thời tận dụng requestIdleCallback để không làm gián đoạn tương tác của người dùng.
 * 3. 20-25s sau khi mở trang tổng quan thành công: Dữ liệu của tất cả các trang khác đã được hoàn thiện
 *    100% trong cache với trạng thái mới nhất, đảm bảo khi người dùng chuyển sang bất kỳ trang nào tiếp
 *    theo đều mở ra ngay lập tức, không bị giật, không lỗi và không bị rơi vào trạng thái không khả dụng.
 */
function WarmCriticalApis() {
  useEffect(() => {
    // 1. Chỉ nạp dữ liệu trang tổng quan trước tiên (t = 0s -> 2s)
    prefetchApi("/api/v1/stocks?board=vn30", 6_000);
    const tIntel = window.setTimeout(() => prefetchApi("/api/v1/market/intel", 12_000), 200);
    const tGlobal = window.setTimeout(() => prefetchApi("/api/v1/market/global", 10_000), 500);

    // Không nạp ngầm nếu người dùng bật chế độ tiết kiệm dữ liệu mạng
    const navAny = typeof navigator !== "undefined" ? (navigator as unknown as { connection?: { saveData?: boolean } }) : null;
    if (navAny?.connection?.saveData) {
      return () => {
        clearTimeout(tIntel);
        clearTimeout(tGlobal);
      };
    }

    // 2. Trong 20s tiếp theo (t = 2.5s -> 22s): Kéo dần dần, lần lượt dữ liệu cho các trang còn lại
    const backgroundQueue: { urls: string[]; timeout: number; delay: number }[] = [
      // Nhịp 1 (~2.5s): Bảng giá Cổ phiếu VN đầy đủ (/stocks, /heatmap tab VN, Dashboard full)
      {
        urls: ["/api/v1/stocks?board=full"],
        timeout: 12_000,
        delay: 2_500,
      },
      // Nhịp 2 (~4.8s): Thị trường Tiền mã hóa (/crypto và tab crypto của /heatmap)
      {
        urls: ["/api/v1/crypto/markets?limit=120", "/api/v1/crypto/markets?limit=60"],
        timeout: 10_000,
        delay: 4_800,
      },
      // Nhịp 3 (~7.0s): Thị trường Ngoại hối & Tỷ giá (/forex)
      {
        urls: ["/api/v1/forex/markets"],
        timeout: 10_000,
        delay: 7_000,
      },
      // Nhịp 4 (~9.2s): Thị trường Hàng hóa & Nguyên liệu (/commodities)
      {
        urls: ["/api/v1/commodities"],
        timeout: 10_000,
        delay: 9_200,
      },
      // Nhịp 5 (~11.5s): Thị trường Phái sinh VN30 (/derivatives)
      {
        urls: [
          "/api/v1/derivatives/snapshot?core=1",
          "/api/v1/derivatives/regime?underlying=VN30",
        ],
        timeout: 8_000,
        delay: 11_500,
      },
      // Nhịp 6 (~13.8s): Kinh tế vĩ mô & Lãi suất tiền tệ (/macro-economic, /currency-interest-rate)
      {
        urls: [
          "/api/v1/macro-economic",
          "/api/v1/currency-interest-rate",
        ],
        timeout: 10_000,
        delay: 13_800,
      },
      // Nhịp 7 (~16.2s): Bộ lọc kỹ thuật & cơ bản (/screener)
      {
        urls: [
          "/api/v1/stocks?symbols=VCB,BID,CTG,TCB,MBB,VPB,ACB,STB,HDB,VIB,LPB,SHB,FPT,HPG,VNM,VIC,VHM,VRE,NVL,PDR,GAS,PLX,MSN,MWG,SSI,VND,HCM,VCI,SHS,BSR,POW,REE,KDH,DXG,DCM,DPM,DGC,VHC,SAB,PNJ,GMD",
          "/api/v1/screener/fundamental",
          "/api/v1/screener/valuation",
          "/api/v1/screener/canslim",
        ],
        timeout: 12_000,
        delay: 16_200,
      },
      // Nhịp 8 (~18.6s): Tin tức thời gian thực & Phân tích tâm lý (/news)
      {
        urls: [
          "/api/v1/news?limit=50",
          "/api/v1/news/sentiment?limit=40",
        ],
        timeout: 10_000,
        delay: 18_600,
      },
      // Nhịp 9 (~21.0s): Bản tin Báo cáo phân tích (/reports) & Danh mục theo dõi (/watchlist)
      {
        urls: [
          "/api/v1/reports?type=morning_brief&limit=7",
          "/api/v1/watchlist",
        ],
        timeout: 10_000,
        delay: 21_000,
      },
    ];

    const timers: number[] = [];
    for (const item of backgroundQueue) {
      const t = window.setTimeout(() => {
        const runBatch = () => {
          for (const url of item.urls) {
            prefetchApi(url, item.timeout);
          }
        };

        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
          (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback(
            runBatch,
            { timeout: 1_500 },
          );
        } else {
          runBatch();
        }
      }, item.delay);
      timers.push(t);
    }

    return () => {
      window.clearTimeout(tIntel);
      window.clearTimeout(tGlobal);
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);
  return null;
}

export function ClientProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    prefetchMarketSnapshot();
  }, []);

  return (
    <SWRConfig
      value={{
        provider: () => globalSwrCache,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        keepPreviousData: true,
        dedupingInterval: 4_000,
        focusThrottleInterval: 28_000,
        errorRetryCount: 2,
        errorRetryInterval: 10_000,
        shouldRetryOnError: true,
        suspense: false,
        revalidateIfStale: true,
      }}
    >
      <ErrorBoundary name="app-root">
        <PriceAlertMonitorHost />
        <PatternAlertMonitorHost />
        <WarmCriticalApis />
        {children}
      </ErrorBoundary>
    </SWRConfig>
  );
}
