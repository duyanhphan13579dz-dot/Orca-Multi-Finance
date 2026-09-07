import type { Metadata } from "next";
import { EconomicDataPage } from "@/components/economic-data-page";
import { ECONOMIC_DATASETS } from "@/lib/economic-data";

export const metadata: Metadata = {
  title: ECONOMIC_DATASETS["currency-interest-rate"].title,
  description: ECONOMIC_DATASETS["currency-interest-rate"].description,
};

export default function CurrencyInterestRatePage() {
  return <EconomicDataPage key="currency-interest-rate" dataset="currency-interest-rate" />;
}
