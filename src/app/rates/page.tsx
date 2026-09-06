"use client";

import { useApi } from "@/lib/hooks";
import { VnbDatasetLinks, VnbRatesView, type VnbDataSnapshot } from "@/components/vnb-data-tables";

/**
 * /rates — LÃI SUẤT & TIỀN TỆ
 * Dữ liệu trực tiếp từ data.vietnambiz.vn/currency-interest-rate (WiFeed/WiGroup):
 * M2, tín dụng, tỷ giá trung tâm/NHTM/tự do, lãi suất liên ngân hàng,
 * chiết khấu, tái cấp vốn, huy động. Không mock — mọi số là chỉ số WiFeed.
 */
export default function RatesPage() {
  const { data, meta, isLoading } = useApi<VnbDataSnapshot>("/api/v1/vietnambiz-data", { refreshInterval: 10 * 60_000 });

  return (
    <>
      <VnbRatesView snapshot={data} meta={meta} isLoading={isLoading} />
      <VnbDatasetLinks active="rates" />
    </>
  );
}
