import type { Metadata } from "next";
import PersonalFinanceApp from "@/features/personal-finance/App";

export const metadata: Metadata = {
  title: "Tài chính cá nhân",
  description: "Quản lý dòng tiền, tài sản, mục tiêu và sức khỏe tài chính cá nhân cùng ORCA.",
  openGraph: {
    title: "ORCA Financial — Tài chính cá nhân",
    description: "Quản lý dòng tiền, tài sản, mục tiêu và sức khỏe tài chính cá nhân cùng ORCA.",
    siteName: "ORCA Financial",
    locale: "vi_VN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ORCA Financial — Tài chính cá nhân",
    description: "Quản lý dòng tiền, tài sản, mục tiêu và sức khỏe tài chính cá nhân cùng ORCA.",
  },
};

export default function PersonalFinancePage() {
  return <PersonalFinanceApp />;
}
