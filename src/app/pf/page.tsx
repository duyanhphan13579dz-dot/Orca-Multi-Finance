import type { Metadata } from "next";
import { PfDashboard } from "@/components/personal-finance/pf-dashboard";

export const metadata: Metadata = {
  title: "Tài chính cá nhân",
  description: "Orca Wallet — quản lý thu chi, thuế, mục tiêu trong Orca Multi Finance",
};

export default function PersonalFinancePage() {
  return <PfDashboard />;
}
