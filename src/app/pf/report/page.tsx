import type { Metadata } from "next";
import { PfReport } from "@/components/personal-finance/pf-report";

export const metadata: Metadata = { title: "Báo cáo PF" };

export default function Page() {
  return <PfReport />;
}
