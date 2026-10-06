import type { Metadata } from "next";
import { PfSection } from "@/components/personal-finance/pf-section";

export const metadata: Metadata = { title: "Báo cáo" };

export default function Page() {
  return (
    <PfSection title="Báo cáo" desc="Tổng hợp kỳ và xuất dữ liệu" />
  );
}
