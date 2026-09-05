"use client";

/**
 * Back-compat wrapper — all existing imports keep working while the chart
 * framework now lives in src/chart/*.
 */
import { OrcaFinancialChart } from "@/chart/OrcaFinancialChart";

export const OrcaChart = OrcaFinancialChart;
export default OrcaFinancialChart;
