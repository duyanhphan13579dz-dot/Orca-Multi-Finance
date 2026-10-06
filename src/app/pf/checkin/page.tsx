import type { Metadata } from "next";
import { PfCheckin } from "@/components/personal-finance/pf-checkin";

export const metadata: Metadata = { title: "Check-in tháng" };

export default function Page() {
  return <PfCheckin />;
}
