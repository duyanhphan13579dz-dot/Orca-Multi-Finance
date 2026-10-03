"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * ORCA Settings System — client store + server persistence.
 * Instant hydration from localStorage (no flash), debounced sync to
 * /api/v1/settings when authenticated, <html> attribute application for
 * theme/density/font-size, and a module-level snapshot for non-hook utils
 * (formatters, hooks).
 */

export interface UserSettings {
  profile: {
    displayName: string;
    avatarStyle: "orca" | "initials-ocean" | "initials-slate" | "initials-amber" | "custom";
    /** Data URL (jpeg) sau khi crop 160px — đồng bộ qua /api/v1/settings khi đăng nhập */
    avatarUrl: string | null;
    language: "vi" | "en";
    timezone: string; // IANA
    region: "vn" | "global";
  };
  appearance: {
    mode: "navy" | "light" | "system";
    density: "compact" | "normal" | "comfortable";
    fontSize: "sm" | "md" | "lg";
    numberFormat: "en-US" | "vi-VN";
    currency: "USD" | "VND";
  };
  dashboard: {
    widgets: { id: string; visible: boolean; order: number }[];
    defaultAsset: string;
    defaultMarket: "stocks" | "crypto" | "forex" | "commodities";
    defaultTimeframe: "15m" | "1h" | "4h" | "1d";
  };
  realtime: {
    liveUpdates: boolean;
    lowDataMode: boolean;
    refreshSeconds: number; // 5 | 10 | 15 | 30 | 60
    autoReconnect: boolean;
    backgroundRefresh: boolean;
  };
  chart: {
    chartType: "candles" | "area" | "line" | "baseline" | "bar";
    volume: boolean;
    grid: boolean;
    crosshairMagnet: boolean;
    logScale: boolean;
    indicators: { ema: boolean; ma10: boolean; ma20: boolean; ma50: boolean; ma100: boolean; ma200: boolean; bollinger: boolean; vwap: boolean; rsi: boolean; macd: boolean; srLevels: boolean };
    /** Tham số chỉ báo tùy chỉnh (chuẩn TradingView-style per-indicator settings) */
    indicatorParams: {
      emaPeriods: [number, number]; // fast/slow, mặc định 20/50
      rsiPeriod: number; // mặc định 14
      macdFast: number; // 12
      macdSlow: number; // 26
      macdSignal: number; // 9
      bollingerPeriod: number; // 20
      bollingerStdDev: number; // 2
    };
    /** Nhớ các đường ngang user vẽ theo symbol (per-symbol persistence) */
    drawingHorizontals: Record<string, number[]>;
  };
  reports: {
    /** Server-controlled schedule (REPORT_MORNING_TIME env) — chỉ đọc để hiển thị; chỉnh trên server */
    serverScheduleVisible: boolean;
  };
  notifications: {
    marketNews: boolean;
    priceAlerts: boolean;
    reportReady: boolean;
    digestMorning: boolean;
    /** Quiet hours — tắt push/webhook trong khung này (chuẩn trading platform) */
    quietHoursEnabled: boolean;
    quietStart: string; // HH:mm
    quietEnd: string; // HH:mm
    /** Chỉ khi tab nền cũng được phép đẩy Notification */
    backgroundPush: boolean;
  };
  ai: {
    depth: "concise" | "standard" | "deep";
    style: "analyst" | "technical" | "brief";
    language: "vi" | "en";
    riskDisclosure: "standard" | "detailed" | "off";
  };
  /** Nhóm Giao dịch & Phí — dùng chung cho Trade Journal / Portfolio PnL */
  trading: {
    stockFeePct: number; // phí GD CK VN, % mỗi chiều (mặc định 0.15)
    sellTaxPct: number; // thuế bán CK, % giá trị bán (mặc định 0.1)
    cryptoFeePct: number; // phí Binance spot/taker, % (mặc định 0.1)
    includeFeesInPnl: boolean; // cộng phí vào PnL khi tính (mặc định true)
  };
  /** Accessibility — tôn trọng prefers-reduced-motion + override thủ công */
  accessibility: {
    reducedMotion: boolean;
  };
  updatedAt: number;
}

export const DASHBOARD_WIDGETS: { id: string; label: string; hint: string }[] = [
  { id: "pulse", label: "Market Pulse", hint: "Narrative + risk gauge" },
  { id: "movers", label: "Crypto Movers", hint: "Top gainers/losers realtime" },
  { id: "indices", label: "Chỉ số VN", hint: "VN-Index · VN30 · HNX" },
  { id: "forex", label: "Forex", hint: "Cặp chính + USD note" },
  { id: "commodities", label: "Hàng hóa", hint: "Kim loại, năng lượng…" },
  { id: "news", label: "Dòng tin", hint: "RSS realtime multi-feed" },
  { id: "quicklinks", label: "Quick actions", hint: "Agent · Reports · Heatmap" },
];

export const DEFAULT_SETTINGS: UserSettings = {
  profile: {
    displayName: "",
    avatarStyle: "orca",
    avatarUrl: null,
    language: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    region: "vn",
  },
  appearance: { mode: "navy", density: "normal", fontSize: "md", numberFormat: "en-US", currency: "USD" },
  dashboard: {
    widgets: DASHBOARD_WIDGETS.map((w, i) => ({ id: w.id, visible: true, order: i })),
    defaultAsset: "BTCUSDT",
    defaultMarket: "crypto",
    defaultTimeframe: "1h",
  },
  realtime: {
    liveUpdates: true,
    lowDataMode: false,
    refreshSeconds: 15,
    autoReconnect: true,
    backgroundRefresh: true,
  },
  chart: {
    chartType: "candles",
    volume: true,
    grid: true,
    crosshairMagnet: true,
    logScale: false,
    indicators: { ema: true, ma10: false, ma20: false, ma50: false, ma100: false, ma200: false, bollinger: false, vwap: true, rsi: true, macd: true, srLevels: true },
    indicatorParams: {
      emaPeriods: [20, 50],
      rsiPeriod: 14,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      bollingerPeriod: 20,
      bollingerStdDev: 2,
    },
    drawingHorizontals: {},
  },
  reports: { serverScheduleVisible: true },
  notifications: {
    marketNews: true,
    priceAlerts: true,
    reportReady: true,
    digestMorning: true,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "07:00",
    backgroundPush: false,
  },
  ai: { depth: "standard", style: "analyst", language: "vi", riskDisclosure: "standard" },
  trading: {
    stockFeePct: 0.15,
    sellTaxPct: 0.1,
    cryptoFeePct: 0.1,
    includeFeesInPnl: true,
  },
  accessibility: { reducedMotion: false },
  updatedAt: 0,
};

const STORAGE_KEY = "orca.settings.v1";
let snapshot: UserSettings = structuredClone(DEFAULT_SETTINGS);

export function getSettingsSnapshot(): UserSettings {
  return snapshot;
}

type Ctx = {
  settings: UserSettings;
  update: (patch: Partial<UserSettings> | ((prev: UserSettings) => UserSettings)) => void;
  reset: () => void;
};

const SettingsContext = createContext<Ctx | null>(null);

function deepMerge<T extends object>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as object, v as object);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

function loadLocal(): UserSettings {
  if (typeof window === "undefined") return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return deepMerge(structuredClone(DEFAULT_SETTINGS), parsed);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function applyHtmlAttrs(s: UserSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = s.appearance.mode === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "navy" : "light") : s.appearance.mode;
  root.dataset.density = s.appearance.density;
  root.dataset.fontSize = s.appearance.fontSize;
  if (s.accessibility.reducedMotion) root.dataset.reducedMotion = "1";
  else delete root.dataset.reducedMotion;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(() => loadLocal());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    snapshot = settings;
    applyHtmlAttrs(settings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* quota */
    }
  }, [settings]);

  const update: Ctx["update"] = (patch) => {
    setSettings((prev) => {
      const next = typeof patch === "function" ? patch(prev) : deepMerge(prev, patch);
      return { ...next, updatedAt: Date.now() };
    });
  };

  const reset = () => setSettings({ ...structuredClone(DEFAULT_SETTINGS), updatedAt: Date.now() });

  return <SettingsContext.Provider value={{ settings, update, reset }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
