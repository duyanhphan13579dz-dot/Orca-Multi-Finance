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
    avatarStyle: "orca" | "initials-ocean" | "initials-slate" | "initials-amber";
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
  profile: { displayName: "", avatarStyle: "orca", language: "vi", timezone: "Asia/Ho_Chi_Minh", region: "vn" },
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
    // Use navigator.sendBeacon when possible during unload, else fetch
    void fetch("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: snapshot }),
      keepalive: true,
    }).catch(() => {});
  }, 1200);
}

function applyToDom() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const mode = snapshot.appearance.mode;
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "navy"
      : mode;
  el.dataset.theme = resolved;
  el.dataset.density = snapshot.appearance.density;
  el.dataset.lowdata = String(snapshot.realtime.lowDataMode);
  el.style.setProperty("--app-font", FONT_MAP[snapshot.appearance.fontSize]);
  el.lang = snapshot.profile.language;
}

function notify() {
  for (const fn of listeners) fn();
}

export function getSettingsSnapshot(): UserSettings {
  return snapshot;
}

export function updateSettings(patch: Partial<UserSettings>) {
  snapshot = { ...mergeDeep(snapshot, patch), updatedAt: Date.now() };
  persistLocal();
  applyToDom();
  notify();
  scheduleServerSync();
}

/* ------------------------------- provider --------------------------------- */

interface SettingsCtxValue {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => void;
  hydrated: boolean;
}

const SettingsCtx = createContext<SettingsCtxValue>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  hydrated: false,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [, force] = useState(0);
  const media = useRef<MediaQueryList | null>(null);

  useEffect(() => {
    // hydrate: localStorage first, then server (newer wins)
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as UserSettings;
        snapshot = mergeDeep(DEFAULT_SETTINGS, parsed);
      }
    } catch {
      /* corrupted storage */
    }
    applyToDom();
    setHydrated(true);

    void (async () => {
      try {
        const meRes = await fetch("/api/v1/auth/me");
        const meJson = (await meRes.json()) as { success: boolean };
        loggedIn = meJson.success;
        if (!loggedIn) return;
        const res = await fetch("/api/v1/settings");
        const json = (await res.json()) as { success: boolean; data?: { settings: UserSettings; updatedAt: number } };
        if (json.success && json.data) {
          const remote = json.data.settings;
          if ((json.data.updatedAt ?? 0) > (snapshot.updatedAt ?? 0)) {
            snapshot = mergeDeep(DEFAULT_SETTINGS, remote);
            persistLocal();
            applyToDom();
            notify();
          } else if ((snapshot.updatedAt ?? 0) > (json.data.updatedAt ?? 0)) {
            scheduleServerSync();
          }
        }
      } catch {
        /* offline-first */
      }
    })();

    const listener = () => force((x) => x + 1);
    listeners.add(listener);
    media.current = window.matchMedia("(prefers-color-scheme: light)");
    const onMedia = () => applyToDom();
    media.current.addEventListener("change", onMedia);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) {
        try {
          snapshot = mergeDeep(DEFAULT_SETTINGS, JSON.parse(e.newValue) as UserSettings);
          applyToDom();
          force((x) => x + 1);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      media.current?.removeEventListener("change", onMedia);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return <SettingsCtx.Provider value={{ settings: snapshot, update: updateSettings, hydrated }}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): SettingsCtxValue {
  return useContext(SettingsCtx);
}

/** realtime refresh interval resolved from user settings */
// Cached refresh multiplier to avoid recomputing on every useApi call
let refreshMul = 1;
let refreshLowMul = 4;
export function resolveRefresh(baseMs: number | undefined): number {
  const r = snapshot.realtime;
  if (!r.liveUpdates) return 0;
  if (baseMs === undefined || baseMs <= 0) return 0;
  // Update cache when settings change (called via notify)
  refreshMul = r.refreshSeconds / 15;
  refreshLowMul = 4;
  const scaled = baseMs * refreshMul;
  // Clamp: lowDataMode forces at least 60s to cut server load dramatically
  return r.lowDataMode ? Math.max(scaled * refreshLowMul, 60_000) : Math.max(Math.min(scaled, 90_000), 5_000);
}
