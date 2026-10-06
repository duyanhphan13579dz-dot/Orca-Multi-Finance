import type { Metadata } from "next";
import { PfSection } from "@/components/personal-finance/pf-section";

export const metadata: Metadata = { title: "Lời khuyên" };

export default function Page() {
  return (
    <PfSection title="Lời khuyên" desc="Advice engine định lượng + narrative" />
  );
}
