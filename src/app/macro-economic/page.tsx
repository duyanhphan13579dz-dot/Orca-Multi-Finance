import type { Metadata } from "next";
import { EconomicDataPage } from "@/components/economic-data-page";
import { ECONOMIC_DATASETS } from "@/lib/economic-data";

export const metadata: Metadata = {
  title: ECONOMIC_DATASETS["macro-economic"].title,
  description: ECONOMIC_DATASETS["macro-economic"].description,
};

export default function MacroEconomicPage() {
  return <EconomicDataPage key="macro-economic" dataset="macro-economic" />;
}
