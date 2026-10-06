import type { Metadata } from "next";
import DerivativesDashboard from "@/components/derivatives-dashboard";

export const metadata: Metadata = {
  title: "Phái sinh | ORCA Financial",
  description: "ORCA Derivatives Intelligence: VN30 Futures, OI, basis, futures curve và risk calculator.",
};

export default function DerivativesPage() {
  return <DerivativesDashboard />;
}
