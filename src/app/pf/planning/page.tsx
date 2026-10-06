import type { Metadata } from "next";
import { PfPlanning } from "@/components/personal-finance/pf-planning";

export const metadata: Metadata = { title: "Kế hoạch PF" };

export default function Page() {
  return <PfPlanning />;
}
