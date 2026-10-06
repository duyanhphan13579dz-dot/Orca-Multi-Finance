import type { Metadata } from "next";
import { PfSection } from "@/components/personal-finance/pf-section";

export const metadata: Metadata = { title: "Kế hoạch" };

export default function Page() {
  return (
    <PfSection
      title="Kế hoạch"
      desc="Mục tiêu, projection nghỉ hưu, giả định lạm phát/lợi suất"
    />
  );
}
