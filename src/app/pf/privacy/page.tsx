import type { Metadata } from "next";
import { PfPrivacy } from "@/components/personal-finance/pf-privacy";

export const metadata: Metadata = { title: "Riêng tư & dữ liệu" };

export default function Page() {
  return <PfPrivacy />;
}
