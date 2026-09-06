"use client";

import { useApi } from "@/lib/hooks";
import { VnbDatasetLinks, VnbMacroView, type VnbDataSnapshot } from "@/components/vnb-data-tables";

/**
 * /macro — KINH TẾ VĨ MÔ VIỆT NAM
 * Dữ liệu trực tiếp từ data.vietnambiz.vn/macro-economic (WiFeed/WiGroup).
 * Hiển thị kỳ công bố, kỳ hiện tại/kỳ trước (màu so sánh), Δ, ngày công bố
 * tiếp theo. Không mock — mọi số là chỉ số WiFeed công bố.
 */
export default function MacroPage() {
  const { data, meta, isLoading } = useApi<VnbDataSnapshot>("/api/v1/vietnambiz-data", { refreshInterval: 10 * 60_000 });

  return (
    <>
      <VnbMacroView snapshot={data} meta={meta} isLoading={isLoading} />
      <VnbDatasetLinks active="macro" />
    </>
  );
}
