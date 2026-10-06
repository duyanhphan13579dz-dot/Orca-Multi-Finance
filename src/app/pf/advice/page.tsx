import type { Metadata } from "next";
import { PfAdvice } from "@/components/personal-finance/pf-advice";

export const metadata: Metadata = { title: "Lời khuyên PF" };

export default function Page() {
  return <PfAdvice />;
}
