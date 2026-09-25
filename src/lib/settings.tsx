"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

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
    /** Data URL (jpeg/png) or https URL — max ~120KB recommended */
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
    indicators: { ema: boolean; bollinger: boolean; vwap: boolean; rsi: boolean; macd: boolean; srLevels: boolean };
    drawingHorizontals: Record<string, number[]>;
  };
  reports: {
    autoDaily: boolean;
    morningTime: string; // HH:mm Asia/Ho_Chi_Minh — Morning Brief (trước giờ mở cửa)
    summaryTime: string; // HH:mm — Market Summary (sau giờ đóng cửa)
    weeklyReview: boolean;
  };
  notifications: {
    marketNews: boolean;
    priceAlerts: boolean;
    reportReady: boolean;
    digestMorning: boolean;
  };
  ai: {
    depth: "concise" | "standard" | "deep";
    style: "analyst" | "technical" | "brief";
    language: "vi" | "en";
    riskDisclosure: "standard" | "detailed" | "off";
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
  profile: { displayName: "", avatarStyle: "orca", avatarUrl: null, language: "vi", timezone: "Asia/Ho_Chi_Minh", region: "vn" },
  appearance: { mode: "navy", density: "normal", fontSize: "md", numberFormat: "en-US", currency: "USD" },
  dashboard: {
    widgets: DASHBOARD_WIDGETS.map((w, i) => ({ id: w.id, visible: true, order: i })),
    defaultAsset: "BTCUSDT",
    defaultMarket: "crypto",
    defaultTimeframe: "1h",
  },
  realtime: { liveUpdates: true, lowDataMode: false, refreshSeconds: 15, autoReconnect: true, backgroundRefresh: true },
  chart: {
    chartType: "candles",
    volume: true,
    grid: true,
    crosshairMagnet: false,
    logScale: false,
    indicators: { ema: true, bollinger: false, vwap: true, rsi: true, macd: true, srLevels: true },
    drawingHorizontals: {},
  },
  reports: { autoDaily: true, morningTime: "08:15", summaryTime: "15:45", weeklyReview: false },
  notifications: { marketNews: true, priceAlerts: true, reportReady: true, digestMorning: false },
  ai: { depth: "standard", style: "analyst", language: "vi", riskDisclosure: "standard" },
  updatedAt: 0,
};

const KEY = "orca.settings.v1";
const FONT_MAP = { sm: "14px", md: "15px", lg: "16px" } as const;

/* ------------------------------ store core -------------------------------- */

let snapshot: UserSettings = DEFAULT_SETTINGS;
let loggedIn = false;
const listeners = new Set<() => void>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function mergeDeep(base: UserSettings, patch: Partial<UserSettings>): UserSettings {
  const out = { ...base } as UserSettings;
  for (const k of Object.keys(patch) as (keyof UserSettings)[]) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && k !== "updatedAt") {
      // @ts-expect-error structural merge
      out[k] = { ...(base[k] as object), ...(pv as object) };
    } else if (pv !== undefined) {
      // @ts-expect-error structural merge
      out[k] = pv;
    }
  }
  return out;
}

function persistLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode */
  }
}

function scheduleServerSync() {
  if (!loggedIn) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void fetch("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: snapshot }),
    }).catch(() => {});
  }, 700);
}

function notify() {
  for (const l of listeners) l();
}

function applyHtmlAttrs(s: UserSettings) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.theme = s.appearance.mode === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "navy") : s.appearance.mode;
  el.dataset.density = s.appearance.density;
  el.style.fontSize = FONT_MAP[s.appearance.fontSize];
  el.lang = s.profile.language;
}

export function getSettingsSnapshot() {
  return snapshot;
}

export function setLoggedInFlag(v: boolean) {
  loggedIn = v;
}

function hydrateFromLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    snapshot = mergeDeep(DEFAULT_SETTINGS, parsed);
  } catch {
    /* ignore */
  }
}

export function useSettings() {
  const [, setTick] = useState(0);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrateFromLocal();
      applyHtmlAttrs(snapshot);
      hydrated.current = true;
      setTick((t) => t + 1);
    }
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/auth/me");
        if (!res.ok) {
          setLoggedInFlag(false);
          return;
        }
        setLoggedInFlag(true);
        const setRes = await fetch("/api/v1/settings");
        if (!setRes.ok || cancelled) return;
        const json = (await setRes.json()) as { data?: { settings?: Partial<UserSettings> } };
        const remote = json?.data?.settings;
        if (remote && !cancelled) {
          snapshot = mergeDeep(snapshot, remote);
          persistLocal();
          applyHtmlAttrs(snapshot);
          notify();
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<UserSettings>) => {
    snapshot = mergeDeep(snapshot, { ...patch, updatedAt: Date.now() });
    persistLocal();
    applyHtmlAttrs(snapshot);
    scheduleServerSync();
    notify();
  };

  const reset = () => {
    snapshot = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
    persistLocal();
    applyHtmlAttrs(snapshot);
    scheduleServerSync();
    notify();
  };

  return { settings: snapshot, update, reset };
}

const SettingsCtx = createContext<ReturnType<typeof useSettings> | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useSettings();
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettingsContext() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettingsContext outside provider");
  return ctx;
}
