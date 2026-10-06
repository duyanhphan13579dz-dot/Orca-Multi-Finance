import type { Metadata } from "next";
import { PfSection } from "@/components/personal-finance/pf-section";

export const metadata: Metadata = { title: "Check-in tháng" };

export default function Page() {
  return (
    <PfSection
      title="Check-in tháng"
      desc="Nhập thu nhập, chi tiêu, tài sản, nợ theo kỳ YYYY-MM"
    />
  );
}
