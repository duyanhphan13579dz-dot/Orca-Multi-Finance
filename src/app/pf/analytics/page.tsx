import type { Metadata } from "next";
import { PfSection } from "@/components/personal-finance/pf-section";

export const metadata: Metadata = { title: "Phân tích" };

export default function Page() {
  return (
    <PfSection title="Phân tích" desc="Cashflow, tỷ lệ cố định, emergency fund, DTI" />
  );
}
