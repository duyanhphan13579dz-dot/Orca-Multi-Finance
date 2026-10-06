import type { Metadata } from "next";
import { PfSection } from "@/components/personal-finance/pf-section";

export const metadata: Metadata = { title: "Riêng tư & dữ liệu" };

export default function Page() {
  return (
    <PfSection
      title="Riêng tư & dữ liệu"
      desc="Consent, xóa dữ liệu local, không lưu số tài khoản"
    />
  );
}
