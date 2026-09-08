"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { safeGet, safeParse, safeSet } from "./safe-storage";

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

function mergeDeep(base: UserSettings, patch: Partial<UserSettings> | unknown): UserSettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const p = patch as Partial<UserSettings>;
  const out = { ...base } as UserSettings;
  for (const k of Object.keys(p) as (keyof UserSettings)[]) {
    const pv = p[k];
    if (pv === undefined) continue;
    // only merge plain objects, not arrays/null
    if (pv && typeof pv === "object" && !Array.isArray(pv) && k !== "updatedAt") {
      const baseVal = base[k];
      if (baseVal && typeof baseVal === "object" && !Array.isArray(baseVal)) {
        // @ts-expect-error structural merge
        out[k] = { ...(baseVal as object), ...(pv as object) };
      } else if (pv !== null) {
        // ignore malformed nested (e.g., appearance: null)
      }
    } else if (pv !== null) {
      // @ts-expect-error structural merge
      out[k] = pv;
    }
  }
  // validate critical enums — fallback if corrupted
  return sanitize(out);
}

function sanitize(s: UserSettings): UserSettings {
  const d = DEFAULT_SETTINGS;
  try {
    const o = { ...s } as UserSettings;
    // appearance
    if (!o.appearance || typeof o.appearance !== "object") o.appearance = { ...d.appearance };
    else {
      if (!["navy", "light", "system"].includes(o.appearance.mode)) o.appearance.mode = d.appearance.mode;
      if (!["compact", "normal", "comfortable"].includes(o.appearance.density)) o.appearance.density = d.appearance.density;
      if (!["sm", "md", "lg"].includes(o.appearance.fontSize)) o.appearance.fontSize = d.appearance.fontSize;
      if (!o.appearance.numberFormat) o.appearance.numberFormat = d.appearance.numberFormat;
      if (!o.appearance.currency) o.appearance.currency = d.appearance.currency;
    }
    // profile
    if (!o.profile || typeof o.profile !== "object") o.profile = { ...d.profile };
    else {
      if (typeof o.profile.timezone !== "string" || !o.profile.timezone) o.profile.timezone = d.profile.timezone;
      if (!["vi", "en"].includes(o.profile.language)) o.profile.language = d.profile.language;
      if (typeof o.profile.displayName !== "string") o.profile.displayName = "";
    }
    // realtime
    if (!o.realtime || typeof o.realtime !== "object") o.realtime = { ...d.realtime };
    else {
      if (typeof o.realtime.liveUpdates !== "boolean") o.realtime.liveUpdates = d.realtime.liveUpdates;
      if (typeof o.realtime.lowDataMode !== "boolean") o.realtime.lowDataMode = d.realtime.lowDataMode;
      if (![5, 10, 15, 30, 60].includes(o.realtime.refreshSeconds)) o.realtime.refreshSeconds = d.realtime.refreshSeconds;
      if (typeof o.realtime.autoReconnect !== "boolean") o.realtime.autoReconnect = d.realtime.autoReconnect;
      if (typeof o.realtime.backgroundRefresh !== "boolean") o.realtime.backgroundRefresh = d.realtime.backgroundRefresh;
    }
    // other sections — ensure objects exist to avoid `Cannot read properties of undefined`
    if (!o.dashboard || typeof o.dashboard !== "object") o.dashboard = { ...d.dashboard };
    if (!o.chart || typeof o.chart !== "object") o.chart = { ...d.chart } as UserSettings["chart"];
    if (!o.chart.indicators || typeof o.chart.indicators !== "object") o.chart.indicators = { ...d.chart.indicators };
    if (!o.reports || typeof o.reports !== "object") o.reports = { ...d.reports };
    if (!o.notifications || typeof o.notifications !== "object") o.notifications = { ...d.notifications };
    if (!o.ai || typeof o.ai !== "object") o.ai = { ...d.ai };
    if (typeof o.updatedAt !== "number") o.updatedAt = 0;
    return o;
  } catch {
    return d;
  }
}

function persistLocal() {
  try {
    const json = JSON.stringify(snapshot);
    safeSet(KEY, json);
  } catch {
    /* private mode — ignore */
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
  try {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const mode = snapshot?.appearance?.mode ?? "navy";
    let resolved = mode;
    if (mode === "system") {
      try {
        const mm = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
        resolved = mm?.matches ? "light" : "navy";
      } catch {
        resolved = "navy";
      }
    }
    el.dataset.theme = resolved as string;
    el.dataset.density = (snapshot?.appearance?.density ?? "normal") as string;
    el.dataset.lowdata = String(!!snapshot?.realtime?.lowDataMode);
    const fs = FONT_MAP[(snapshot?.appearance?.fontSize as keyof typeof FONT_MAP) ?? "md"] ?? FONT_MAP.md;
    el.style.setProperty("--app-font", fs);
    const lang = snapshot?.profile?.language;
    if (lang === "vi" || lang === "en") el.lang = lang;
  } catch {
    // never let dom apply crash the app
  }
}

function notify() {
  for (const fn of listeners) fn();
}

export function getSettingsSnapshot(): UserSettings {
  // always return sanitized copy — never let corrupted snapshot leak to render
  try {
    if (!snapshot || typeof snapshot !== "object") snapshot = { ...DEFAULT_SETTINGS };
    return sanitize(snapshot);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function updateSettings(patch: Partial<UserSettings>) {
  try {
    snapshot = { ...mergeDeep(snapshot, patch), updatedAt: Date.now() };
    snapshot = sanitize(snapshot);
  } catch {
    snapshot = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
  }
  persistLocal();
  try {
    applyToDom();
  } catch {}
  try {
    notify();
  } catch {}
  try {
    scheduleServerSync();
  } catch {}
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
  const mediaHandler = useRef<(() => void) | null>(null);

  useEffect(() => {
    // hydrate: localStorage first, then server (newer wins)
    // Defensive: corrupted JSON must not crash — reset to defaults and clear bad key
    let hadCorruption = false;
    try {
      const raw = safeGet(KEY);
      if (raw) {
        const parsed = safeParse<Partial<UserSettings>>(raw, null as unknown as Partial<UserSettings>);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const merged = mergeDeep(DEFAULT_SETTINGS, parsed);
          snapshot = sanitize(merged);
        } else if (raw.trim().length > 0) {
          // raw exists but not parsable as object (e.g., "undefined", "null", half-written)
          hadCorruption = true;
        }
      } else {
        snapshot = sanitize(snapshot);
      }
    } catch {
      hadCorruption = true;
      snapshot = { ...DEFAULT_SETTINGS };
    }
    if (hadCorruption) {
      try {
        const cur = safeGet(KEY);
        // only clear if it is truly invalid JSON, not empty
        if (cur) safeSet(KEY, JSON.stringify(sanitize(snapshot)));
      } catch {}
    }
    try {
      applyToDom();
    } catch {}
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

    const listener = () => {
      try {
        force((x) => x + 1);
      } catch {}
    };
    listeners.add(listener);
    try {
      if (typeof window !== "undefined" && window.matchMedia) {
        media.current = window.matchMedia("(prefers-color-scheme: light)");
        const onMedia = () => {
          try {
            applyToDom();
          } catch {}
        };
        mediaHandler.current = onMedia;
        media.current.addEventListener("change", onMedia);
      }
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) {
        try {
          const parsed = safeParse<Partial<UserSettings>>(e.newValue, null as unknown as Partial<UserSettings>);
          if (parsed && typeof parsed === "object") {
            snapshot = sanitize(mergeDeep(DEFAULT_SETTINGS, parsed));
            applyToDom();
            force((x) => x + 1);
          }
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      try {
        const m = media.current;
        const h = mediaHandler.current;
        if (m && h) m.removeEventListener("change", h);
      } catch {}
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
  try {
    const r = snapshot?.realtime ?? DEFAULT_SETTINGS.realtime;
    if (!r?.liveUpdates) return 0;
    if (baseMs === undefined || baseMs <= 0) return 0;
    // Update cache when settings change (called via notify)
    const rs = typeof r.refreshSeconds === "number" && [5, 10, 15, 30, 60].includes(r.refreshSeconds) ? r.refreshSeconds : 15;
    refreshMul = rs / 15;
    refreshLowMul = 4;
    const scaled = baseMs * refreshMul;
    // Clamp: lowDataMode forces at least 60s to cut server load dramatically
    return r.lowDataMode ? Math.max(scaled * refreshLowMul, 60_000) : Math.max(Math.min(scaled, 90_000), 5_000);
  } catch {
    return baseMs && baseMs > 0 ? Math.max(Math.min(baseMs, 90_000), 5_000) : 0;
  }
}
