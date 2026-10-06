import type { Metadata } from "next";
import { PfAnalytics } from "@/components/personal-finance/pf-analytics";

export const metadata: Metadata = { title: "Phân tích PF" };

export default function Page() {
  return <PfAnalytics />;
}
