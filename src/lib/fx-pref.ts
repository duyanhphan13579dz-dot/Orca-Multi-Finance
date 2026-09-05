"use client";

import { useApi } from "./hooks";
import { useSettings } from "./settings";
import type { ForexMarket } from "./services/forex";

/**
 * Currency display preference — converts USD-denominated figures to ₫ using
 * the LIVE USD/VND rate from the forex engine (never a hardcoded rate).
 */
export function usePrefCurrency(): {
  currency: "USD" | "VND";
  vndRate: number | null;
  fmtUsd: (v: number | null | undefined, suffixCompact?: boolean) => string;
} {
  const { settings } = useSettings();
  const wantsVnd = settings.appearance.currency === "VND";
  const { data } = useApi<ForexMarket>(wantsVnd ? "/api/v1/forex/markets" : null, { refreshInterval: 300_000 });
  const vndRate = data?.rows.find((r) => r.pair === "USDVND")?.price ?? null;
  const locale = settings.appearance.numberFormat;

  const fmtUsd = (v: number | null | undefined): string => {
    if (v == null || !Number.isFinite(v)) return "—";
    if (wantsVnd && vndRate) {
      const vnd = v * vndRate;
      if (vnd >= 1e12) return `₫${(vnd / 1e12).toLocaleString(locale, { maximumFractionDigits: 2 })} nghìn tỷ`;
      if (vnd >= 1e9) return `₫${(vnd / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })} tỷ`;
      if (vnd >= 1e6) return `₫${(vnd / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })}tr`;
      return `₫${vnd.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
    }
    const abs = Math.abs(v);
    if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(2)}`;
  };

  return { currency: settings.appearance.currency, vndRate, fmtUsd };
}
